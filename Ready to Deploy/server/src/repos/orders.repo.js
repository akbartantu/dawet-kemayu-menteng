/**
 * Orders Repository
 * Handles all order-related Google Sheets operations
 */

import logger from '../utils/logger.js';
import { getSheetsClient, getSpreadsheetId, retryWithBackoff } from './sheets.client.js';
import {
  getSheetHeaderMap,
  buildRowFromMap,
  validateRequiredKeys,
  normalizeOrderId,
  columnIndexToLetter,
  invalidateHeaderCache,
} from '../utils/sheets-helpers.js';
import { SHEET_NAMES, ORDER_STATUS } from '../utils/constants.js';

import { getPriceList } from './price-list.repo.js';

const ORDERS_SHEET = SHEET_NAMES.ORDERS;

/**
 * Compute order totals (product total, packaging fee, delivery fee, final total, DP min, etc.)
 * @param {Object} orderData - Order data with items, notes, delivery_fee
 * @param {Object} priceList - Price list from PriceList sheet
 * @returns {Object} Calculated totals
 */
async function computeOrderTotals(orderData, priceList) {
  const { calculateOrderTotal } = await import('../services/price-calculator.js');
  const { calculateMinDP } = await import('../services/payment-tracker.js');
  
  // Calculate product total (sum of all items)
  const calculation = calculateOrderTotal(orderData.items || [], priceList);
  const productTotal = calculation.subtotal || 0;
  
  // Calculate packaging fee
  // Check if Packaging Styrofoam is in notes or items
  // Format: "Packaging Styrofoam: YA" or "Packaging Styrofoam (1 box Rp40.000 untuk 50 cup): YA"
  let packagingFee = 0;
  let packagingRequested = false;
  
  // Check notes for packaging request
  const packagingNotes = (orderData.notes || []).filter(note => {
    const noteLower = note.toLowerCase();
    return noteLower.includes('packaging') || noteLower.includes('styrofoam');
  });
  
  // Parse packaging override (e.g., "Packaging Styrofoam: 1 box" or "Styrofoam Boxes: 1")
  let styrofoamBoxesOverride = null;
  let usePlasticBag = false;
  
  for (const note of packagingNotes) {
    const noteLower = note.toLowerCase();
    
    // Check for explicit box count (e.g., "1 box", "2 box", "Packaging Styrofoam: 1 box")
    const boxCountMatch = noteLower.match(/(\d+)\s*box/i);
    if (boxCountMatch) {
      styrofoamBoxesOverride = parseInt(boxCountMatch[1], 10);
      console.log(`🔍 [COMPUTE_TOTALS] Packaging override detected: ${styrofoamBoxesOverride} box(es)`);
    }
    
    // Check for plastic bag mention (e.g., "sisanya plastic bag", "plastic bag: ya")
    if (noteLower.includes('plastic bag') || noteLower.includes('sisanya plastic')) {
      usePlasticBag = true;
    }
    
    // Check if packaging is explicitly requested (YA)
    if (noteLower.includes('ya') && !noteLower.includes('tidak')) {
      packagingRequested = true;
    }
    // If note contains packaging/styrofoam but no explicit TIDAK, assume yes
    if (!noteLower.includes('tidak')) {
      packagingRequested = true;
    }
  }
  
  // Also check items for packaging
  const packagingInItems = (orderData.items || []).some(item => 
    item.name.toLowerCase().includes('packaging') || 
    item.name.toLowerCase().includes('styrofoam')
  );
  
  if (packagingRequested || packagingInItems || styrofoamBoxesOverride !== null) {
    // Calculate total cups from items
    let totalCups = 0;
    (orderData.items || []).forEach(item => {
      // Skip packaging/styrofoam items themselves
      const itemNameLower = (item.name || '').toLowerCase();
      if (itemNameLower.includes('packaging') || itemNameLower.includes('styrofoam')) {
        return; // Skip packaging items
      }
      
      // Check if item is a cup-based product (Dawet Small/Medium/Large)
      // Handle items with toppings (e.g., "Dawet Medium + Nangka", "Dawet Medium Original")
      if (itemNameLower.includes('dawet') && 
          (itemNameLower.includes('small') || 
           itemNameLower.includes('medium') || 
           itemNameLower.includes('large'))) {
        // Exclude botol items (they're not cups)
        if (!itemNameLower.includes('botol')) {
          totalCups += parseInt(item.quantity || 0);
        }
      }
    });
    
    // Use override if provided, otherwise calculate default
    let boxes = 0;
    if (styrofoamBoxesOverride !== null) {
      boxes = styrofoamBoxesOverride;
    } else if (totalCups > 0) {
      boxes = Math.ceil(totalCups / 50);
    } else {
      // If no cups detected but packaging requested, assume 1 box
      boxes = 1;
    }
    
    // Calculate packaging fee (only styrofoam boxes, plastic bag is free)
    packagingFee = boxes * 40000;
    
    // Store packaging plan for transparency
    const packagingPlan = {
      styrofoam_boxes: boxes,
      plastic_bags: usePlasticBag,
      total_cups: totalCups,
    };
    // Store in orderData for later saving (will be stored in notes_json or a dedicated column)
    orderData.packaging_plan = JSON.stringify(packagingPlan);
    
    console.log(`🔍 [COMPUTE_TOTALS] Total cups: ${totalCups}, Boxes: ${boxes}${styrofoamBoxesOverride !== null ? ' (override)' : ''}, Plastic bag: ${usePlasticBag ? 'YES' : 'NO'}, Packaging fee: Rp ${packagingFee}`);
  }
  
  // Delivery fee (from orderData.delivery_fee, default 0)
  // Use the parsed delivery_fee directly from orderData
  const deliveryFee = orderData.delivery_fee !== null && orderData.delivery_fee !== undefined 
    ? (typeof orderData.delivery_fee === 'number' ? orderData.delivery_fee : parseFloat(orderData.delivery_fee) || 0)
    : 0;

  // Total amount (canonical - replaces final_total)
  const totalAmount = productTotal + packagingFee + deliveryFee;
  
  // DP minimum (50% of total amount)
  const dpMinAmount = calculateMinDP(totalAmount);
  
  // Paid amount (default 0 at creation)
  const paidAmount = parseFloat(orderData.paid_amount) || 0;
  
  // Payment status (default 'UNPAID' at creation)
  const { calculatePaymentStatus } = await import('../services/payment-tracker.js');
  const paymentStatus = orderData.payment_status || calculatePaymentStatus(paidAmount, totalAmount);
  
  // Remaining balance
  const { calculateRemainingBalance } = await import('../services/payment-tracker.js');
  const remainingBalance = calculateRemainingBalance(totalAmount, paidAmount);
  
  console.log(`🔍 [COMPUTE_TOTALS] Using total_amount column (canonical)`);
  
  return {
    productTotal,
    packagingFee,
    deliveryFee,
    totalAmount, // Canonical field (replaces finalTotal)
    finalTotal: totalAmount, // Keep for backward compatibility (deprecated)
    dpMinAmount,
    paidAmount,
    paymentStatus,
    remainingBalance,
  };
}

// Cache for order ID generation (per date) to minimize read requests
const orderIdCache = {
  date: null,
  maxOrderNumber: 0,
  lastFetchedAt: null,
  cacheTTL: 5 * 60 * 1000, // 5 minutes cache
};

/**
 * Generate order ID in format: DKM/YYYYMMDD/000005 (increments by date, resets each day)
 */
export async function generateOrderId() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Get today's date in YYYYMMDD format
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    
    // Check cache first (only if same date and cache is fresh)
    const now = Date.now();
    if (orderIdCache.date === dateStr && 
        orderIdCache.lastFetchedAt && 
        (now - orderIdCache.lastFetchedAt) < orderIdCache.cacheTTL) {
      // Use cached max order number
      orderIdCache.maxOrderNumber += 1;
      const orderNumberStr = String(orderIdCache.maxOrderNumber).padStart(6, '0');
      logger.debug(`[GENERATE_ORDER_ID] Using cached max order number: ${orderIdCache.maxOrderNumber}`);
      return `DKM/${dateStr}/${orderNumberStr}`;
    }
    
    // Reset cache if date changed
    if (orderIdCache.date !== dateStr) {
      orderIdCache.date = dateStr;
      orderIdCache.maxOrderNumber = 0;
    }
    
    // Get the next order number for today (minimize read: only read column A)
    let orderNumber = 1;
    
    try {
      // Only read column A (order_id) to minimize read requests
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ORDERS_SHEET}!A:A`,
      });
      
      const rows = response.data.values || [];
      if (rows.length > 1) {
        // Find orders from today (format: DKM/YYYYMMDD/000005)
        const todayOrders = rows.slice(1).filter(row => {
          const orderId = (row[0] || '').toString().trim();
          return orderId.startsWith(`DKM/${dateStr}/`);
        });
        
        if (todayOrders.length > 0) {
          // Get the highest order number from today
          const orderNumbers = todayOrders.map(row => {
            const orderId = (row[0] || '').toString().trim();
            // Match pattern: DKM/YYYYMMDD/000005 -> extract 000005
            const match = orderId.match(/\/\d{8}\/(\d{6})$/);
            if (match) {
              return parseInt(match[1], 10);
            }
            return 0;
          });
          orderNumber = Math.max(...orderNumbers) + 1;
        }
      }
      
      // Update cache
      orderIdCache.maxOrderNumber = orderNumber;
      orderIdCache.lastFetchedAt = now;
      logger.debug(`[GENERATE_ORDER_ID] Fetched max order number for date ${dateStr}: ${orderNumber}`);
    } catch (error) {
      // Orders sheet doesn't exist yet, start from 1
      orderNumber = 1;
      orderIdCache.maxOrderNumber = 1;
      orderIdCache.lastFetchedAt = now;
      logger.debug(`[GENERATE_ORDER_ID] Sheet doesn't exist or error, starting from 1`);
    }
    
    // Format order number with 6 digits
    const orderNumberStr = String(orderNumber).padStart(6, '0');
    
    return `DKM/${dateStr}/${orderNumberStr}`;
  } catch (error) {
    console.error('❌ Error generating order ID:', error.message);
    // Fallback to timestamp-based ID
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    return `DKM/${dateStr}/${Date.now().toString().slice(-6)}`;
  }
}

/**
 * Ensure Orders sheet has payment columns (idempotent, backward compatible)
 */
export async function ensureOrdersPaymentHeaders() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Get current headers (with retry for 429)
    const response = await retryWithBackoff(async () => {
      return await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ORDERS_SHEET}!A1:Z1`,
      });
    });

    const headers = response.data.values?.[0] || [];
    const headerMap = {};
    headers.forEach((h, i) => {
      if (h) headerMap[h.trim()] = i;
    });

    // Payment columns to add (snake_case ONLY - single source of truth)
    const paymentHeaders = [
      'product_total',
      'packaging_fee',
      'delivery_fee',
      'total_amount', // Canonical (replaces final_total)
      'dp_min_amount',
      'paid_amount',
      'payment_status',
      'remaining_balance',
    ];
    
    // Also ensure delivery_method column exists (shipping method)
    if (!headerMap['delivery_method']) {
      paymentHeaders.push('delivery_method');
    }

    const missingHeaders = paymentHeaders.filter(h => !headerMap[h]);
    
    if (missingHeaders.length > 0) {
      // Find the last column index
      const lastColIndex = headers.length;
      const startCol = columnIndexToLetter(lastColIndex);
      
      // Add missing headers (snake_case only)
      await retryWithBackoff(async () => {
        return await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${ORDERS_SHEET}!${startCol}1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [missingHeaders],
          },
        });
      });
      
      console.log(`✅ Added payment headers (snake_case) to Orders sheet: ${missingHeaders.join(', ')}`);
      
      // Invalidate header cache after adding columns
      invalidateHeaderCache(ORDERS_SHEET);
    }
  } catch (error) {
    console.error('⚠️ Error ensuring payment headers (non-critical):', error.message);
    // Non-critical, continue
  }
}

/**
 * Find row index by Order ID in a specific sheet
 * Uses header mapping to find order_id column (not hardcoded to column A)
 * Normalizes order_id for consistent comparison
 * @param {string} sheetName - Sheet name (e.g., 'Orders', 'Reminders')
 * @param {string} orderId - Order ID to search for
 * @returns {Promise<number|null>} Row index (1-based) or null if not found
 */
export async function findRowByOrderId(sheetName, orderId) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    if (!orderId) {
      logger.warn(`[FIND_ROW] Missing orderId for ${sheetName}`);
      return null;
    }
    
    // Get header map to find order_id column
    const headerMap = await getSheetHeaderMap(sheetName, { requireSnakeCase: false });
    const orderIdColumnIndex = headerMap.order_id;
    
    if (orderIdColumnIndex === undefined) {
      logger.error(`[FIND_ROW] Column "order_id" not found in ${sheetName} sheet`);
      return null;
    }
    
    // Normalize input order_id
    const normalizedInputId = normalizeOrderId(orderId);
    logger.debug(`[LOOKUP] Searching order_id: "${normalizedInputId}" (original: "${orderId}") in ${sheetName}`);
    
    // Read ALL data rows (not partial range) - use extended range to ensure we get all rows
    const lastColumn = columnIndexToLetter(headerMap.__headersLength - 1);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:${lastColumn}`, // Read all columns
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      logger.debug(`[FIND_ROW] No data rows in ${sheetName} (only headers)`);
      return null; // No data rows (only header)
    }

    // Track duplicates for logging
    const duplicateRows = [];
    let foundRow = null;

    // Find row with matching Order ID using normalized comparison
    // Scan ALL rows (don't stop at first empty row)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) {
        // Skip completely empty rows but continue scanning
        continue;
      }
      
      const sheetOrderIdRaw = row[orderIdColumnIndex];
      if (sheetOrderIdRaw === undefined || sheetOrderIdRaw === null || sheetOrderIdRaw === '') {
        // Skip rows where order_id column is empty, but continue scanning
        continue;
      }
      
      // Normalize sheet order_id for comparison
      const sheetOrderIdNormalized = normalizeOrderId(String(sheetOrderIdRaw));
      
      logger.debug(`[LOOKUP] Row ${i + 1} order_id raw="${sheetOrderIdRaw}" normalized="${sheetOrderIdNormalized}"`);
      
      // Compare normalized values
      if (sheetOrderIdNormalized === normalizedInputId) {
        if (foundRow === null) {
          foundRow = i + 1; // Return 1-based row index
          logger.debug(`[LOOKUP] FOUND at row ${i + 1}`);
        } else {
          // Duplicate found
          duplicateRows.push(i + 1);
          logger.warn(`[LOOKUP] Duplicate order_id found at row ${i + 1} (first match at row ${foundRow})`);
        }
      }
    }

    if (duplicateRows.length > 0) {
      logger.warn(`[LOOKUP] Duplicate order_id "${normalizedInputId}" found at rows: ${foundRow}, ${duplicateRows.join(', ')}`);
      logger.warn(`[LOOKUP] Using first occurrence at row ${foundRow}`);
    }

    if (foundRow) {
      console.log(`✅ [LOOKUP] Order ${normalizedInputId} found in ${sheetName} at row ${foundRow} (scanned ${rows.length - 1} rows)`);
      return foundRow;
    }

    return null;
  } catch (error) {
    console.error(`❌ [FIND_ROW] Error finding row by Order ID in ${sheetName}:`, error.message);
    console.error(`❌ [FIND_ROW] Stack:`, error.stack);
    return null;
  }
}

/**
 * Save order to Google Sheets
 * Uses header-based mapping to write payment columns correctly
 * Checks for duplicates before writing (idempotent)
 */
export async function saveOrder(orderData, options = {}) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // NOTE: skipDuplicateCheck option removed - saveOrder now always performs UPSERT
    // (update if exists, insert if new)
    
    // Generate order ID if not provided (MUST be done first)
    const orderId = orderData.id || await generateOrderId();
    if (!orderId) {
      throw new Error('Missing order_id: Failed to generate order ID before saving order');
    }
    orderData.id = orderId;

    // Normalize event_date to YYYY-MM-DD format before saving
    const { normalizeEventDate } = await import('../utils/date-utils.js');
    const originalEventDate = orderData.event_date;
    if (orderData.event_date) {
      try {
        orderData.event_date = normalizeEventDate(orderData.event_date);
      } catch (error) {
        console.error(`❌ [SAVE_ORDER] Failed to normalize event_date "${originalEventDate}":`, error.message);
        throw new Error(`Invalid event_date format: ${originalEventDate}. ${error.message}`);
      }
    }
    
    // Normalize delivery_time to HH:MM format before saving
    const { normalizeDeliveryTime } = await import('../services/price-calculator.js');
    const originalDeliveryTime = orderData.delivery_time;
    if (orderData.delivery_time) {
      try {
        orderData.delivery_time = normalizeDeliveryTime(orderData.delivery_time);
      } catch (error) {
        console.error(`❌ [SAVE_ORDER] Failed to normalize delivery_time "${originalDeliveryTime}":`, error.message);
        throw new Error(`Invalid delivery_time format: ${originalDeliveryTime}. ${error.message}`);
      }
    }
    
    // Check if Orders sheet exists, create if not
    const spreadsheet = await retryWithBackoff(async () => {
      return await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });
    });
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

    if (!existingSheets.includes(ORDERS_SHEET)) {
      // Create Orders sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: ORDERS_SHEET,
              },
            },
          }],
        },
      });

      // Add headers (original + payment columns)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ORDERS_SHEET}!A1:X1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            'Order ID',
            'Customer Name',
            'Phone Number',
            'Address',
            'Event Name',
            'Event Duration',
            'Event Date',
            'Delivery Time',
            'delivery_method',
            'Items (JSON)',
            'Notes (JSON)',
            'Status',
            'Total Items',
            'Created At',
            'Updated At',
            'Conversation ID',
            // Payment columns (snake_case only - single source of truth)
            'product_total',
            'packaging_fee',
            'delivery_fee',
            'total_amount', // Canonical (replaces final_total)
            'dp_min_amount',
            'paid_amount',
            'payment_status',
            'remaining_balance',
          ]],
        },
      });
    } else {
      // Ensure payment headers exist (for existing sheets)
      await ensureOrdersPaymentHeaders();
    }

    // Get header map using alias-based mapping (enforce snake_case for Orders)
    const headerMap = await getSheetHeaderMap(ORDERS_SHEET, { requireSnakeCase: true, sheetType: 'Orders' });
    
    // Validate required columns exist
    const requiredKeys = ['order_id', 'customer_name', 'phone_number', 'status'];
    validateRequiredKeys(headerMap, requiredKeys, ORDERS_SHEET);
    
    // CRITICAL: Validate delivery_fee column exists
    if (headerMap.delivery_fee === undefined) {
      const errorMsg = `CRITICAL: Orders sheet is missing required column "delivery_fee". Cannot save order. Please add "delivery_fee" column to Orders sheet.`;
      logger.error(`[SAVE_ORDER] ${errorMsg}`);
      throw new Error(errorMsg);
    }
    logger.debug(`[SAVE_ORDER] delivery_fee column found at index ${headerMap.delivery_fee}`);
    
    // Validate delivery_method column exists (with cache invalidation retry)
    if (headerMap.delivery_method === undefined) {
      logger.warn(`[SAVE_ORDER] delivery_method column not found in header map. Invalidating cache and retrying...`);
      
      // Invalidate cache and retry ONCE
      invalidateHeaderCache(ORDERS_SHEET);
      
      // Re-fetch header map (bypass cache)
      const retryHeaderMap = await getSheetHeaderMap(ORDERS_SHEET, { requireSnakeCase: true, sheetType: 'Orders' });
      
      if (retryHeaderMap.delivery_method === undefined) {
        // Still missing after retry - log diagnostic info
        logger.error(`[SAVE_ORDER] delivery_method column still not found after cache invalidation`);
        logger.error(`[SAVE_ORDER] Header map keys: ${Object.keys(retryHeaderMap).filter(k => !k.startsWith('__')).join(', ')}`);
        logger.error(`[SAVE_ORDER] Headers length: ${retryHeaderMap.__headersLength || 'unknown'}`);
        
        const errorMsg = `CRITICAL: Orders sheet is missing required column "delivery_method". Cannot save order. Please add "delivery_method" column to Orders sheet.`;
        throw new Error(errorMsg);
      }
      
      // Found after retry - use the retry header map
      logger.debug(`[SAVE_ORDER] delivery_method column found at index ${retryHeaderMap.delivery_method} (after cache invalidation)`);
      // Update headerMap for rest of function
      Object.assign(headerMap, retryHeaderMap);
    } else {
      logger.debug(`[SAVE_ORDER] delivery_method column found at index ${headerMap.delivery_method}`);
    }
    
    logger.debug(`[TRACE save] delivery_method="${orderData.delivery_method || orderData.shipping_method || '-'}"`);

    // Get price list for calculations
    const priceList = await getPriceList();
    
    // Compute order totals
    const totals = await computeOrderTotals(orderData, priceList);
    
    // Prepare data object with snake_case keys
    const itemsJson = JSON.stringify(orderData.items || []);
    const notesJson = JSON.stringify(orderData.notes || []);
    const totalItems = (orderData.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
    
    // CRITICAL: Log items being saved for debugging
    logger.debug(`[SAVE_ORDER] Items being saved:`, JSON.stringify(orderData.items, null, 2));
    logger.debug(`[SAVE_ORDER] Items JSON string:`, itemsJson);
    logger.debug(`[SAVE_ORDER] Total items count:`, totalItems);
    
    const dataObject = {
      order_id: orderId,
      customer_name: orderData.customer_name || '',
      phone_number: orderData.phone_number || '',
      address: orderData.address || '',
      event_name: orderData.event_name || '',
      event_duration: orderData.event_duration || '',
      event_date: orderData.event_date || '',
      delivery_time: orderData.delivery_time || '', // Already normalized above
      delivery_method: orderData.delivery_method || orderData.shipping_method || '-', // Metode pengiriman (stored in Orders.delivery_method)
      items_json: itemsJson,
      notes_json: notesJson,
      status: orderData.status || 'pending',
      total_items: totalItems,
      created_at: orderData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      conversation_id: orderData.conversation_id || '',
      // Payment columns (calculated values)
      product_total: totals.productTotal,
      packaging_fee: totals.packagingFee,
      delivery_fee: totals.deliveryFee, // Use parsed delivery_fee from orderData (computed in computeOrderTotals)
      total_amount: totals.totalAmount, // Canonical field (WRITE)
      final_total: totals.finalTotal, // Deprecated, kept for backward compatibility
      dp_min_amount: totals.dpMinAmount,
      paid_amount: totals.paidAmount,
      payment_status: totals.paymentStatus,
      remaining_balance: totals.remainingBalance,
    };
    
    // Build row using header map
    const row = buildRowFromMap(headerMap, dataObject);
    
    logger.debug(`[SAVE_ORDER] Row prepared with ${row.filter(v => v !== '').length} non-empty values`);

    // UPSERT: Check if order exists and update, otherwise append
    const existingRowIndex = await findRowByOrderId(ORDERS_SHEET, orderId);
    
    // Log the existing row index for debugging
    if (existingRowIndex) {
      logger.debug(`[SAVE_ORDER] Found existing order ${orderId} at row ${existingRowIndex}`);
    } else {
      logger.debug(`[SAVE_ORDER] Order ${orderId} not found, will append new row`);
    }
    
    if (existingRowIndex) {
      // UPDATE existing row
      logger.debug(`[SAVE_ORDER] Order ${orderId} exists at row ${existingRowIndex}, updating instead of appending`);
      
      // Build update data for ALL columns in dataObject
      // CRITICAL: Update ALL fields including computed totals (product_total, packaging_fee, etc.)
      // This ensures /edit updates persist correctly
      const updateData = [];
      for (const [internalKey, columnIndex] of Object.entries(headerMap)) {
        if (internalKey.startsWith('__')) continue; // Skip metadata keys
        
        const value = dataObject[internalKey];
        // Update if value is explicitly provided (including null, empty string, 0, false)
        // Only skip if value is truly undefined (field not in dataObject)
        if (value !== undefined) {
          const col = columnIndexToLetter(columnIndex);
          // Convert value appropriately
          let cellValue = value;
          if (cellValue === null) {
            cellValue = '';
          } else if (typeof cellValue === 'object' && cellValue !== null && !Array.isArray(cellValue)) {
            // For objects, stringify (though we shouldn't have objects here)
            cellValue = JSON.stringify(cellValue);
          }
          // Arrays (items_json, notes_json) are already stringified in dataObject
          updateData.push({
            range: `${ORDERS_SHEET}!${col}${existingRowIndex}`,
            values: [[cellValue]],
          });
        }
      }
      
      logger.debug(`[SAVE_ORDER] Prepared ${updateData.length} fields for update:`, 
        Object.keys(dataObject).filter(k => !k.startsWith('__')).join(', '));
      
      // CRITICAL: Log items_json value being sent to Google Sheets
      const itemsJsonColumnIndex = headerMap.items_json;
      if (itemsJsonColumnIndex !== undefined) {
        const itemsJsonCol = columnIndexToLetter(itemsJsonColumnIndex);
        const itemsJsonUpdate = updateData.find(u => u.range.includes(itemsJsonCol));
        if (itemsJsonUpdate) {
          logger.debug(`[SAVE_ORDER] items_json update - Column: ${itemsJsonCol}, Value:`, itemsJsonUpdate.values[0][0]);
          logger.debug(`[SAVE_ORDER] items_json update - Value length:`, itemsJsonUpdate.values[0][0]?.length || 0);
        } else {
          logger.warn(`[SAVE_ORDER] items_json not found in updateData! Column index: ${itemsJsonColumnIndex}, Column letter: ${itemsJsonCol}`);
          // Manually add items_json to updateData if missing
          logger.debug(`[SAVE_ORDER] Adding items_json manually to updateData...`);
          updateData.push({
            range: `${ORDERS_SHEET}!${itemsJsonCol}${existingRowIndex}`,
            values: [[itemsJson]],
          });
          logger.debug(`[SAVE_ORDER] items_json manually added:`, itemsJson);
        }
      } else {
        logger.error(`[SAVE_ORDER] items_json column not found in header map!`);
      }
      
      if (updateData.length > 0) {
        // CRITICAL: Use retryWithBackoff to handle rate limits
        await retryWithBackoff(async () => {
          const result = await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
              valueInputOption: 'RAW',
              data: updateData,
            },
          });
          logger.debug(`[SAVE_ORDER] batchUpdate result:`, result.data);
          return result;
        });
        logger.debug(`✅ [SAVE_ORDER] Updated existing order ${orderId} at row ${existingRowIndex} with ${updateData.length} fields`);
        
        // Verify update by re-reading items_json column (critical for debugging)
        try {
          const itemsJsonColumnIndex = headerMap.items_json;
          if (itemsJsonColumnIndex !== undefined) {
            const itemsJsonCol = columnIndexToLetter(itemsJsonColumnIndex);
            const verifyResponse = await sheets.spreadsheets.values.get({
              spreadsheetId: SPREADSHEET_ID,
              range: `${ORDERS_SHEET}!${itemsJsonCol}${existingRowIndex}`,
            });
            const verifyItemsJson = verifyResponse.data.values?.[0]?.[0] || '';
            logger.debug(`[SAVE_ORDER] Verification - items_json in sheet:`, verifyItemsJson);
            logger.debug(`[SAVE_ORDER] Verification - items_json we sent:`, itemsJson);
            if (verifyItemsJson !== itemsJson) {
              logger.warn(`⚠️ [SAVE_ORDER] items_json mismatch! Sheet has: "${verifyItemsJson}", we sent: "${itemsJson}"`);
            } else {
              logger.debug(`✅ [SAVE_ORDER] Verified: items_json matches in Google Sheets`);
            }
          }
        } catch (verifyError) {
          logger.warn(`⚠️ [SAVE_ORDER] Could not verify items_json update (non-critical):`, verifyError.message);
        }
      } else {
        logger.warn(`⚠️ [SAVE_ORDER] No fields to update for order ${orderId}`);
      }
    } else {
      // APPEND new row (only if doesn't exist)
      const lastCol = columnIndexToLetter(headerMap.__headersLength - 1);
      const range = `${ORDERS_SHEET}!A:${lastCol}`;

      await retryWithBackoff(async () => {
        return await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: range,
          valueInputOption: 'RAW',
          requestBody: {
            values: [row],
          },
        });
      });
      logger.debug(`[SAVE_ORDER] saved invoice ${orderId} with delivery_fee=${totals.deliveryFee}`);
    }

    // Post-write validation: Check for duplicates (safety net)
    // Get final row index after write (for append case, existingRowIndex was null)
    const finalRowIndex = existingRowIndex || await findRowByOrderId(ORDERS_SHEET, orderId);
    
    // Double-check for duplicates (should not happen with proper upsert)
    if (finalRowIndex) {
      const duplicateCheck = await findRowByOrderId(ORDERS_SHEET, orderId);
      if (duplicateCheck && duplicateCheck !== finalRowIndex) {
        // This should never happen with upsert, but log if it does
        logger.error(`[SAVE_ORDER] CRITICAL: Duplicate detected for order ${orderId}! Expected at row ${finalRowIndex}, but found at row ${duplicateCheck}`);
        // Don't throw - the upsert should have prevented this
      } else if (duplicateCheck === finalRowIndex) {
        logger.debug(`[SAVE_ORDER] Verified: Order ${orderId} exists at row ${finalRowIndex} (no duplicates)`);
      }
    }
    
    logger.debug('Order saved to Google Sheets with totals:', {
      orderId,
      productTotal: totals.productTotal,
      packagingFee: totals.packagingFee,
      deliveryFee: totals.deliveryFee,
      totalAmount: totals.totalAmount,
      paymentStatus: totals.paymentStatus,
      operation: existingRowIndex ? 'UPDATED' : 'APPENDED',
      rowIndex: existingRowIndex || 'NEW',
    });
    
    // Return order data with calculated totals
    // CRITICAL: Include all computed totals so caller can use them
    return {
      ...orderData,
      id: orderId,
      productTotal: totals.productTotal,
      packagingFee: totals.packagingFee,
      deliveryFee: totals.deliveryFee,
      totalAmount: totals.totalAmount,
      finalTotal: totals.finalTotal,
      dpMinAmount: totals.dpMinAmount,
      paidAmount: totals.paidAmount,
      paymentStatus: totals.paymentStatus,
      remainingBalance: totals.remainingBalance,
    };
  } catch (error) {
    logger.error('[SAVE_ORDER] Error saving order to Google Sheets:', error);
    throw error;
  }
}

/**
 * Get all orders from Google Sheets
 */
export async function getAllOrders(limit = 100) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Get header map using alias-based mapping (enforce snake_case for Orders)
    const headerMap = await getSheetHeaderMap(ORDERS_SHEET, { requireSnakeCase: true, sheetType: 'Orders' });
    
    const range = `${ORDERS_SHEET}!A:${columnIndexToLetter(headerMap.__headersLength - 1)}`;

    // Read extended range to include all columns
    const response = await retryWithBackoff(async () => {
      return await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: range,
      });
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      console.log(`⚠️ [GET_ALL_ORDERS] No data rows found (only headers)`);
      return [];
    }
    
    const orders = rows.slice(1, limit + 1).map(row => {
      // Helper to get value by internal key
      const getValue = (internalKey, defaultValue = '') => {
        const colIndex = headerMap[internalKey];
        if (colIndex === undefined) {
          return defaultValue;
        }
        return row[colIndex] !== undefined && row[colIndex] !== '' ? row[colIndex] : defaultValue;
      };
      
      // Parse items and notes JSON
      let items = [];
      let notes = [];
      try {
        const itemsJson = getValue('items_json', '[]');
        const notesJson = getValue('notes_json', '[]');
        items = JSON.parse(itemsJson);
        notes = JSON.parse(notesJson);
      } catch (e) {
        console.warn(`⚠️ [GET_ALL_ORDERS] Error parsing items/notes JSON:`, e.message);
        // Invalid JSON, keep empty arrays
      }

      return {
        id: getValue('order_id', ''),
        customer_name: getValue('customer_name', ''),
        phone_number: getValue('phone_number', ''),
        address: getValue('address', ''),
        event_name: getValue('event_name', ''),
        event_duration: getValue('event_duration', ''),
        event_date: getValue('event_date', ''),
        delivery_time: getValue('delivery_time', ''),
        items: items,
        notes: notes,
        status: getValue('status', 'pending'),
        total_items: parseInt(getValue('total_items', '0')) || 0,
        created_at: getValue('created_at', ''),
        updated_at: getValue('updated_at', ''),
        conversation_id: getValue('conversation_id', ''),
        // Payment fields (with defaults for backward compatibility)
        product_total: (() => {
          const val = getValue('product_total', '0');
          return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
        })(),
        packaging_fee: (() => {
          const val = getValue('packaging_fee', '0');
          return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
        })(),
        delivery_fee: (() => {
          const val = getValue('delivery_fee', '0');
          return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
        })(),
        // total_amount is canonical (replaces final_total)
        total_amount: (() => {
          const totalAmountVal = getValue('total_amount', null);
          if (totalAmountVal !== null && totalAmountVal !== '') {
            const parsed = typeof totalAmountVal === 'string' ? parseFloat(totalAmountVal.replace(/[.,]/g, '')) || 0 : parseFloat(totalAmountVal) || 0;
            if (parsed > 0) {
              return parsed;
            }
          }
          // Fallback to final_total for legacy data
          const finalTotalVal = getValue('final_total', '0');
          const parsed = typeof finalTotalVal === 'string' ? parseFloat(finalTotalVal.replace(/[.,]/g, '')) || 0 : parseFloat(finalTotalVal) || 0;
          return parsed;
        })(),
        final_total: (() => {
          const val = getValue('final_total', '0');
          return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
        })(),
        dp_min_amount: (() => {
          const val = getValue('dp_min_amount', '0');
          return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
        })(),
        paid_amount: (() => {
          const val = getValue('paid_amount', '0');
          if (typeof val === 'string') {
            const cleaned = val.replace(/^rp\s*/i, '').replace(/\s+/g, '').replace(/[.,]/g, '');
            return parseFloat(cleaned) || 0;
          }
          return parseFloat(val) || 0;
        })(),
        delivery_method: getValue('delivery_method', '') || getValue('shipping_method', '') || '-',
        shipping_method: getValue('delivery_method', '') || getValue('shipping_method', '') || '-',
        payment_status: getValue('payment_status', 'UNPAID'),
        remaining_balance: (() => {
          const val = getValue('remaining_balance', '0');
          return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
        })(),
      };
    });

    const sortedOrders = orders.sort((a, b) => 
      new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
    
    logger.debug(`[GET_ALL_ORDERS] Retrieved ${sortedOrders.length} order(s)`);
    return sortedOrders;
  } catch (error) {
    logger.error('[GET_ALL_ORDERS] Error getting orders:', error);
    logger.error('[GET_ALL_ORDERS] Error message:', error?.message || 'Unknown error');
    logger.error('[GET_ALL_ORDERS] Error stack:', error?.stack || 'No stack trace');
    throw error;
  }
}

/**
 * Get order by ID (optimized to minimize read requests)
 * Uses findRowByOrderId to locate the row, then reads only that row
 */
export async function getOrderById(orderId) {
  try {
    if (!orderId) {
      logger.warn(`⚠️ [GET_ORDER] Missing orderId`);
      return null;
    }
    
    // Normalize order_id for comparison
    const normalizedInputId = normalizeOrderId(orderId);
    logger.debug(`[GET_ORDER] Looking up order_id: "${normalizedInputId}" (original: "${orderId}")`);
    
    // OPTIMIZATION: Use findRowByOrderId to locate the row first (minimizes read requests)
    // Then read only that specific row instead of reading all orders
    const rowIndex = await findRowByOrderId(ORDERS_SHEET, orderId);
    
    if (rowIndex) {
      // Row found, read only that row (more efficient than reading all orders)
      const sheets = getSheetsClient();
      const SPREADSHEET_ID = getSpreadsheetId();
      
      // Get header map to determine column range
      const headerMap = await getSheetHeaderMap(ORDERS_SHEET, { requireSnakeCase: true, sheetType: 'Orders' });
      const lastColumn = columnIndexToLetter(headerMap.__headersLength - 1);
      
      // Read only the specific row
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ORDERS_SHEET}!A${rowIndex}:${lastColumn}${rowIndex}`,
      });
      
      const row = response.data.values?.[0] || [];
      if (row.length > 0) {
        // Helper to get value by internal key (same pattern as getAllOrders)
        const getValue = (internalKey, defaultValue = '') => {
          const colIndex = headerMap[internalKey];
          if (colIndex === undefined) {
            return defaultValue;
          }
          return row[colIndex] !== undefined && row[colIndex] !== '' ? row[colIndex] : defaultValue;
        };
        
        // Parse items and notes JSON
        let items = [];
        let notes = [];
        try {
          const itemsJson = getValue('items_json', '[]');
          const notesJson = getValue('notes_json', '[]');
          items = JSON.parse(itemsJson);
          notes = JSON.parse(notesJson);
        } catch (e) {
          logger.warn(`⚠️ [GET_ORDER] Error parsing items/notes JSON:`, e.message);
          // Invalid JSON, keep empty arrays
        }
        
        // Build order object (same structure as getAllOrders)
        const order = {
          id: getValue('order_id', ''),
          customer_name: getValue('customer_name', ''),
          phone_number: getValue('phone_number', ''),
          address: getValue('address', ''),
          event_name: getValue('event_name', ''),
          event_duration: getValue('event_duration', ''),
          event_date: getValue('event_date', ''),
          delivery_time: getValue('delivery_time', ''),
          delivery_method: getValue('delivery_method', ''),
          items: items,
          notes: notes,
          status: getValue('status', 'pending'),
          total_items: parseInt(getValue('total_items', '0')) || 0,
          created_at: getValue('created_at', ''),
          updated_at: getValue('updated_at', ''),
          conversation_id: getValue('conversation_id', ''),
          // Payment fields (with defaults for backward compatibility)
          product_total: (() => {
            const val = getValue('product_total', '0');
            return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
          })(),
          packaging_fee: (() => {
            const val = getValue('packaging_fee', '0');
            return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
          })(),
          delivery_fee: (() => {
            const val = getValue('delivery_fee', '0');
            return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
          })(),
          // total_amount is canonical (replaces final_total)
          total_amount: (() => {
            const totalAmountVal = getValue('total_amount', null);
            if (totalAmountVal !== null && totalAmountVal !== '') {
              const parsed = typeof totalAmountVal === 'string' ? parseFloat(totalAmountVal.replace(/[.,]/g, '')) || 0 : parseFloat(totalAmountVal) || 0;
              if (parsed > 0) return parsed;
            }
            // Fallback to final_total if total_amount is empty
            const finalTotalVal = getValue('final_total', null);
            if (finalTotalVal !== null && finalTotalVal !== '') {
              return typeof finalTotalVal === 'string' ? parseFloat(finalTotalVal.replace(/[.,]/g, '')) || 0 : parseFloat(finalTotalVal) || 0;
            }
            return 0;
          })(),
          final_total: (() => {
            const val = getValue('final_total', '0');
            return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
          })(),
          dp_min_amount: (() => {
            const val = getValue('dp_min_amount', '0');
            return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
          })(),
          paid_amount: (() => {
            const val = getValue('paid_amount', '0');
            return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
          })(),
          payment_status: getValue('payment_status', 'UNPAID'),
          remaining_balance: (() => {
            const val = getValue('remaining_balance', '0');
            return typeof val === 'string' ? parseFloat(val.replace(/[.,]/g, '')) || 0 : parseFloat(val) || 0;
          })(),
        };
        
        logger.debug(`✅ [GET_ORDER] Found order in Orders sheet at row ${rowIndex}`);
        return order;
      }
    }
    
    logger.debug(`⚠️ [GET_ORDER] Order ${normalizedInputId} not found in Orders`);
    return null;
  } catch (error) {
    logger.error('[GET_ORDER] Error getting order by ID:', error);
    logger.error('[GET_ORDER] Error message:', error?.message || 'Unknown error');
    logger.error('[GET_ORDER] Error stack:', error?.stack || 'No stack trace');
    return null;
  }
}

/**
 * Update order status
 */
export async function updateOrderStatus(orderId, newStatus) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Get header map to find status and updated_at columns
    const headerMap = await getSheetHeaderMap(ORDERS_SHEET, { requireSnakeCase: true, sheetType: 'Orders' });
    
    // Find row index using header mapping
    const rowIndex = await findRowByOrderId(ORDERS_SHEET, orderId);
    if (!rowIndex) {
      throw new Error(`Order ${orderId} not found`);
    }
    
    // Update status using header mapping
    const statusColIndex = headerMap.status;
    const updatedAtColIndex = headerMap.updated_at;
    
    if (statusColIndex === undefined) {
      throw new Error('Status column not found in Orders sheet');
    }
    
    const statusCol = columnIndexToLetter(statusColIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ORDERS_SHEET}!${statusCol}${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[newStatus]],
      },
    });

    // Update Updated At if column exists
    if (updatedAtColIndex !== undefined) {
      const updatedAtCol = columnIndexToLetter(updatedAtColIndex);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ORDERS_SHEET}!${updatedAtCol}${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[new Date().toISOString()]],
        },
      });
    }

    return true;
  } catch (error) {
    console.error(`❌ [UPDATE_ORDER_STATUS] Error updating order status:`, error.message);
    console.error(`❌ [UPDATE_ORDER_STATUS] Stack:`, error.stack);
    throw error;
  }
}

/**
 * Update order payment (paid amount and payment status)
 * ACCUMULATES payments instead of overwriting
 * Uses header-based mapping for column updates
 */
export async function updateOrderPayment(orderId, newPaymentAmount) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    if (!orderId) {
      throw new Error('Missing order_id: Cannot update payment without order ID');
    }
    
    const { calculatePaymentStatus, calculateRemainingBalance, parseIDRAmount } = await import('../services/payment-tracker.js');
    
    // Normalize order_id for lookup
    const normalizedOrderId = normalizeOrderId(orderId);
    console.log(`🔍 [UPDATE_PAYMENT] Looking up order_id: "${normalizedOrderId}" (original: "${orderId}")`);
    
    // Get order to calculate totals and get existing paid amount
    const order = await getOrderById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} tidak ditemukan.`);
    }
    
    // Use total_amount (canonical) with fallback to final_total (legacy)
    const totalAmount = order.total_amount || order.final_total || 0;

    // Validate total_amount exists and is > 0
    if (!totalAmount || totalAmount <= 0) {
      throw new Error('Order total is not set. Please calculate order total first.');
    }

    // Get existing paid amount (may be string with formatting, need to clean it)
    let existingPaidAmount = 0;
    if (order.paid_amount) {
      // If it's a string (formatted), parse it
      if (typeof order.paid_amount === 'string') {
        const parsed = parseIDRAmount(order.paid_amount);
        existingPaidAmount = parsed !== null ? parsed : parseFloat(order.paid_amount) || 0;
      } else {
        existingPaidAmount = parseFloat(order.paid_amount) || 0;
      }
    }
    
    // ACCUMULATE: New total paid = existing + new payment
    const newTotalPaid = existingPaidAmount + newPaymentAmount;

    // Calculate remaining balance and payment status
    const remainingBalance = calculateRemainingBalance(totalAmount, newTotalPaid);
    const paymentStatus = calculatePaymentStatus(newTotalPaid, totalAmount);
    
    // Calculate or preserve dp_min_amount (50% of total_amount, only if empty or 0)
    let dpMinAmount = order.dp_min_amount || 0;
    if (!dpMinAmount || dpMinAmount <= 0) {
      const { calculateMinDP } = await import('../services/payment-tracker.js');
      dpMinAmount = calculateMinDP(totalAmount);
      console.log(`🔍 [UPDATE_PAYMENT] Calculated dp_min_amount: ${dpMinAmount} (50% of ${totalAmount})`);
    }

    // Find row index using header mapping
    const rowIndex = await findRowByOrderId(ORDERS_SHEET, orderId);
    if (!rowIndex) {
      throw new Error(`Order ${orderId} not found`);
    }
    
    // Get header map using alias-based mapping (enforce snake_case for Orders)
    const headerMap = await getSheetHeaderMap(ORDERS_SHEET, { requireSnakeCase: true, sheetType: 'Orders' });
    
    // Build update data using header-based column mapping (with alias support)
    const updateData = [];
    
    const updateColumn = (internalKey, value) => {
      const colIndex = headerMap[internalKey];
      if (colIndex !== undefined) {
        const col = columnIndexToLetter(colIndex);
        updateData.push({
          range: `${ORDERS_SHEET}!${col}${rowIndex}`,
          values: [[value]],
        });
        console.log(`🔍 [UPDATE_PAYMENT] Updating column "${internalKey}" (${col}${rowIndex}) = ${value}`);
        return true;
      }
      console.warn(`⚠️ [UPDATE_PAYMENT] Column "${internalKey}" not found in header map, skipping update`);
      return false;
    };
    
    // Update payment fields using internal keys (snake_case only)
    updateColumn('paid_amount', newTotalPaid); // Use accumulated total, not just new payment
    updateColumn('payment_status', paymentStatus);
    updateColumn('remaining_balance', remainingBalance);
    
    // Update dp_min_amount only if it was calculated (was empty/0)
    if (!order.dp_min_amount || order.dp_min_amount <= 0) {
      updateColumn('dp_min_amount', dpMinAmount);
    }
    
    updateColumn('updated_at', new Date().toISOString());
    
    console.log(`🔍 [UPDATE_PAYMENT] Prepared ${updateData.length} column update(s)`);

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: updateData,
        },
      });
    }

    console.log(`✅ [UPDATE_PAYMENT] Order ${orderId} payment updated: +${newPaymentAmount} (Total Paid: ${newTotalPaid}, Status: ${paymentStatus}, Remaining: ${remainingBalance})`);
    return {
      orderId,
      paidAmount: newTotalPaid, // Return accumulated total
      paymentStatus,
      remainingBalance,
      totalAmount, // Canonical field
      finalTotal: totalAmount, // Keep for backward compatibility
    };
  } catch (error) {
    console.error(`❌ [UPDATE_PAYMENT] Error updating order payment:`, error.message);
    console.error(`❌ [UPDATE_PAYMENT] Stack:`, error.stack);
    throw error;
  }
}

/**
 * Update order payment with evidence (photo/document)
 * Similar to updateOrderPayment but stores evidence file_id
 */
export async function updateOrderPaymentWithEvidence(orderId, paymentAmount, evidenceFileId, evidenceType, telegramMessageId) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // First update payment (same as regular updateOrderPayment)
    const paymentResult = await updateOrderPayment(orderId, paymentAmount);
    
    // Store evidence reference (in notes_json or a dedicated column if available)
    // For now, append to notes_json as JSON
    const order = await getOrderById(orderId);
    if (order) {
      const rowIndex = await findRowByOrderId(ORDERS_SHEET, orderId);
      if (rowIndex) {
        const headerMap = await getSheetHeaderMap(ORDERS_SHEET, { requireSnakeCase: true, sheetType: 'Orders' });
        
        // Get existing notes
        let notes = [];
        try {
          const notesJson = order.notes_json || order.notes;
          if (typeof notesJson === 'string') {
            notes = JSON.parse(notesJson);
          } else if (Array.isArray(notesJson)) {
            notes = notesJson;
          }
        } catch (e) {
          // If parsing fails, start with empty array
          notes = [];
        }
        
        // Add evidence note
        const evidenceNote = {
          type: 'payment_evidence',
          file_id: evidenceFileId,
          evidence_type: evidenceType,
          telegram_message_id: telegramMessageId,
          timestamp: new Date().toISOString(),
        };
        notes.push(evidenceNote);
        
        // Update notes_json column
        const notesColIndex = headerMap.notes_json;
        if (notesColIndex !== undefined) {
          const col = columnIndexToLetter(notesColIndex);
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${ORDERS_SHEET}!${col}${rowIndex}`,
            valueInputOption: 'RAW',
            requestBody: {
              values: [[JSON.stringify(notes)]],
            },
          });
        }
      }
    }
    
    return paymentResult;
  } catch (error) {
    console.error(`❌ [UPDATE_PAYMENT_EVIDENCE] Error updating payment with evidence:`, error.message);
    console.error(`❌ [UPDATE_PAYMENT_EVIDENCE] Stack:`, error.stack);
    throw error;
  }
}

/**
 * Recalculate order payment summary from Payment_History (source of truth)
 * This function reads Payment_History and updates Orders totals deterministically
 * @param {string} orderId - Order ID
 * @returns {Promise<Object>} Updated payment summary
 */
export async function recalculateOrderPaymentSummary(orderId) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Get order to read total_amount
    const order = await getOrderById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} tidak ditemukan.`);
    }
    
    // Normalize total_amount
    let totalAmount = order.total_amount || order.final_total || 0;
    if (typeof totalAmount === 'string') {
      const { parseIDRAmount } = await import('../services/payment-tracker.js');
      const parsed = parseIDRAmount(totalAmount);
      totalAmount = parsed !== null ? parsed : parseFloat(totalAmount.replace(/[.,]/g, '')) || 0;
    }
    totalAmount = parseFloat(totalAmount) || 0;
    
    logger.info(`[PAY_SUMMARY] Order total_amount=${totalAmount}`);
    
    logger.info(`[PAY_SUMMARY] Start recalculation for order_id=${orderId}`);
    
    // Get all payments from Payment_History
    const { getPaymentsByOrderId } = await import('./payment-history.repo.js');
    const payments = await getPaymentsByOrderId(orderId);
    
    logger.info(`[PAY_SUMMARY] Found ${payments.length} payment record(s) for order ${orderId}`);
    
    // Calculate totals from Payment_History (source of truth)
    let totalPaid = 0;
    let totalPaidPending = 0;
    let lastPaymentAt = null;
    let lastPaymentMethod = null;
    
    // Normalize IDR amounts helper
    const normalizeIDR = (value) => {
      if (value === null || value === undefined || value === '') return 0;
      let str = String(value);
      // Remove "Rp", spaces, thousand separators
      str = str.replace(/Rp/gi, '').replace(/\s+/g, '').replace(/\./g, '').replace(/,/g, '');
      const parsed = parseInt(str, 10);
      if (isNaN(parsed)) {
        logger.warn(`[PAY_SUMMARY] Warning: Could not parse amount "${value}", using 0`);
        return 0;
      }
      return parsed;
    };
    
    for (const payment of payments) {
      const paymentStatus = String(payment.status || '').toLowerCase().trim();
      
      if (paymentStatus === 'confirmed' || paymentStatus === 'approved') {
        // Use amount_confirmed if available, fallback to amount_input
        let confirmedAmount = normalizeIDR(payment.amount_confirmed);
        if (confirmedAmount <= 0) {
          confirmedAmount = normalizeIDR(payment.amount_input);
          if (confirmedAmount > 0) {
            logger.warn(`[PAY_SUMMARY] Payment ${payment.payment_id}: amount_confirmed is empty, using amount_input=${confirmedAmount}`);
          }
        }
        totalPaid += confirmedAmount;
        
        // Track latest payment
        if (!lastPaymentAt || payment.payment_date > lastPaymentAt) {
          lastPaymentAt = payment.payment_date;
          lastPaymentMethod = payment.payment_method || 'transfer';
        }
        
        logger.info(`[PAY_SUMMARY] Approved payment: ${payment.payment_id}, amount_confirmed=${confirmedAmount}, total_paid now=${totalPaid}`);
      } else if (paymentStatus === 'pending_review') {
        const pendingAmount = normalizeIDR(payment.amount_input);
        totalPaidPending += pendingAmount;
        logger.info(`[PAY_SUMMARY] Pending payment: ${payment.payment_id}, amount_input=${pendingAmount}, total_paid_pending now=${totalPaidPending}`);
      } else {
        logger.info(`[PAY_SUMMARY] Ignoring payment ${payment.payment_id} with status="${payment.status}"`);
      }
    }
    
    // Calculate remaining balance (do NOT subtract pending)
    const { calculateRemainingBalance } = await import('../services/payment-tracker.js');
    const remainingBalance = calculateRemainingBalance(totalAmount, totalPaid);
    
    // Calculate payment status (unpaid/partial/paid/overpaid)
    let paymentStatus;
    if (totalPaid <= 0) {
      paymentStatus = 'unpaid';
    } else if (totalPaid < totalAmount) {
      paymentStatus = 'partial';
    } else if (totalPaid === totalAmount) {
      paymentStatus = 'paid';
    } else {
      paymentStatus = 'overpaid';
    }
    
    // Find row index
    const rowIndex = await findRowByOrderId(ORDERS_SHEET, orderId);
    if (!rowIndex) {
      logger.error(`[PAY_SUMMARY] Order ${orderId} not found in sheet`);
      throw new Error(`Order ${orderId} not found`);
    }
    
    logger.info(`[PAY_SUMMARY] Found order row: rowIndex=${rowIndex}`);
    
    // Get header map
    const headerMap = await getSheetHeaderMap(ORDERS_SHEET, { requireSnakeCase: true, sheetType: 'Orders' });
    
    // Build update data
    const updateData = [];
    const updatedColumns = [];
    
    const updateColumn = (internalKey, value) => {
      const colIndex = headerMap[internalKey];
      if (colIndex !== undefined) {
        const col = columnIndexToLetter(colIndex);
        updateData.push({
          range: `${ORDERS_SHEET}!${col}${rowIndex}`,
          values: [[value]],
        });
        updatedColumns.push(`${internalKey}(${col}${rowIndex})=${value}`);
        return true;
      }
      logger.warn(`[PAY_SUMMARY] Column "${internalKey}" not found in header map, skipping update`);
      return false;
    };
    
    // Update all payment fields
    updateColumn('total_paid', totalPaid);
    updateColumn('total_paid_pending', totalPaidPending);
    updateColumn('paid_amount', totalPaid); // Mirror of total_paid for compatibility
    updateColumn('remaining_balance', remainingBalance);
    updateColumn('payment_status', paymentStatus);
    
    if (lastPaymentAt) {
      updateColumn('last_payment_at', lastPaymentAt);
    }
    if (lastPaymentMethod) {
      updateColumn('last_payment_method', lastPaymentMethod);
    }
    
    updateColumn('updated_at', new Date().toISOString());
    
    logger.info(`[PAY_SUMMARY] Computed totals: total_paid=${totalPaid}, total_paid_pending=${totalPaidPending}, remaining_balance=${remainingBalance}, payment_status=${paymentStatus}`);
    logger.info(`[PAY_SUMMARY] Prepared ${updateData.length} column update(s): ${updatedColumns.join(', ')}`);
    
    // Write updates in one batch
    if (updateData.length > 0) {
      await retryWithBackoff(async () => {
        return await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            valueInputOption: 'RAW',
            data: updateData,
          },
        });
      });
      logger.info(`[PAY_SUMMARY] Orders update success: Updated ${updateData.length} column(s) at row ${rowIndex}`);
    } else {
      logger.warn(`[PAY_SUMMARY] No columns to update (all columns missing from header map?)`);
    }
    
    logger.info(`✅ [PAY_SUMMARY] Updated Orders for ${orderId} at row ${rowIndex}: total_amount=${totalAmount}, total_paid=${totalPaid}, remaining_balance=${remainingBalance}, status=${paymentStatus}`);
    
    return {
      orderId,
      totalAmount,
      totalPaid,
      totalPaidPending,
      paidAmount: totalPaid, // Mirror for compatibility
      remainingBalance,
      paymentStatus,
      lastPaymentAt,
      lastPaymentMethod,
    };
  } catch (error) {
    logger.error(`❌ [RECALCULATE_PAYMENT] Error recalculating payment summary for ${orderId}:`, error.message);
    throw error;
  }
}
