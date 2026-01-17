/**
 * Waiting List Repository
 * Handles all waiting list-related Google Sheets operations
 */

import { getSheetsClient, getSpreadsheetId, retryWithBackoff } from './sheets.client.js';
import {
  getSheetHeaderMap,
  buildRowFromMap,
  validateRequiredKeys,
  columnIndexToLetter,
} from '../utils/sheets-helpers.js';
import { findRowByOrderId } from './orders.repo.js';
import { getPriceList } from './price-list.repo.js';

import { SHEET_NAMES } from '../utils/constants.js';

const WAITING_LIST_SHEET = SHEET_NAMES.WAITING_LIST;

// Temporary import for computeOrderTotals (will be moved to orders.repo.js or a shared service)
// TODO: Extract computeOrderTotals to a shared service
async function computeOrderTotals(orderData, priceList) {
  const { calculateOrderTotal } = await import('../services/price-calculator.js');
  const { calculateMinDP } = await import('../services/payment-tracker.js');
  
  const calculation = calculateOrderTotal(orderData.items || [], priceList);
  const productTotal = calculation.subtotal || 0;
  
  let packagingFee = 0;
  let packagingRequested = false;
  
  const packagingNotes = (orderData.notes || []).filter(note => {
    const noteLower = note.toLowerCase();
    return noteLower.includes('packaging') || noteLower.includes('styrofoam');
  });
  
  let styrofoamBoxesOverride = null;
  let usePlasticBag = false;
  
  for (const note of packagingNotes) {
    const noteLower = note.toLowerCase();
    
    const boxCountMatch = noteLower.match(/(\d+)\s*box/i);
    if (boxCountMatch) {
      styrofoamBoxesOverride = parseInt(boxCountMatch[1], 10);
    }
    
    if (noteLower.includes('plastic bag') || noteLower.includes('sisanya plastic')) {
      usePlasticBag = true;
    }
    
    if (noteLower.includes('ya') && !noteLower.includes('tidak')) {
      packagingRequested = true;
    }
    if (!noteLower.includes('tidak')) {
      packagingRequested = true;
    }
  }
  
  const packagingInItems = (orderData.items || []).some(item => 
    item.name.toLowerCase().includes('packaging') || 
    item.name.toLowerCase().includes('styrofoam')
  );
  
  if (packagingRequested || packagingInItems || styrofoamBoxesOverride !== null) {
    let totalCups = 0;
    (orderData.items || []).forEach(item => {
      const itemNameLower = (item.name || '').toLowerCase();
      if (itemNameLower.includes('packaging') || itemNameLower.includes('styrofoam')) {
        return;
      }
      
      if (itemNameLower.includes('dawet') && 
          (itemNameLower.includes('small') || 
           itemNameLower.includes('medium') || 
           itemNameLower.includes('large'))) {
        if (!itemNameLower.includes('botol')) {
          totalCups += parseInt(item.quantity || 0);
        }
      }
    });
    
    let boxes = 0;
    if (styrofoamBoxesOverride !== null) {
      boxes = styrofoamBoxesOverride;
    } else if (totalCups > 0) {
      boxes = Math.ceil(totalCups / 50);
    } else {
      boxes = 1;
    }
    
    packagingFee = boxes * 40000;
    
    const packagingPlan = {
      styrofoam_boxes: boxes,
      plastic_bags: usePlasticBag,
      total_cups: totalCups,
    };
    orderData.packaging_plan = JSON.stringify(packagingPlan);
  }
  
  const deliveryFee = orderData.delivery_fee !== null && orderData.delivery_fee !== undefined 
    ? (typeof orderData.delivery_fee === 'number' ? orderData.delivery_fee : parseFloat(orderData.delivery_fee) || 0)
    : 0;

  const totalAmount = productTotal + packagingFee + deliveryFee;
  const dpMinAmount = calculateMinDP(totalAmount);
  const paidAmount = parseFloat(orderData.paid_amount) || 0;
  
  const { calculatePaymentStatus } = await import('../services/payment-tracker.js');
  const paymentStatus = orderData.payment_status || calculatePaymentStatus(paidAmount, totalAmount);
  
  const { calculateRemainingBalance } = await import('../services/payment-tracker.js');
  const remainingBalance = calculateRemainingBalance(totalAmount, paidAmount);
  
  return {
    productTotal,
    packagingFee,
    deliveryFee,
    totalAmount,
    finalTotal: totalAmount,
    dpMinAmount,
    paidAmount,
    paymentStatus,
    remainingBalance,
  };
}

/**
 * Ensure WaitingList sheet has payment headers (snake_case only)
 */
export async function ensureWaitingListPaymentHeaders() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Get current headers
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${WAITING_LIST_SHEET}!A1:Z1`,
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

    const missingHeaders = paymentHeaders.filter(h => !headerMap[h]);
    
    if (missingHeaders.length > 0) {
      // Find the last column index
      const lastColIndex = headers.length;
      const startCol = columnIndexToLetter(lastColIndex);
      
      // Add missing headers (snake_case only)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${WAITING_LIST_SHEET}!${startCol}1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [missingHeaders],
        },
      });
      
      console.log(`✅ Added payment headers (snake_case) to WaitingList sheet: ${missingHeaders.join(', ')}`);
    }
  } catch (error) {
    console.error('⚠️ Error ensuring WaitingList payment headers (non-critical):', error.message);
    // Non-critical, continue
  }
}

/**
 * Initialize waiting list sheet
 */
export async function initializeWaitingList() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

    if (!existingSheets.includes(WAITING_LIST_SHEET)) {
      // Create WaitingList sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: WAITING_LIST_SHEET,
              },
            },
          }],
        },
      });

      // Add headers (snake_case only - single source of truth)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${WAITING_LIST_SHEET}!A1:W1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            'order_id',
            'customer_name',
            'phone_number',
            'address',
            'event_name',
            'event_duration',
            'event_date',
            'delivery_time',
            'items_json',
            'notes_json',
            'status',
            'total_items',
            'created_at',
            'updated_at',
            'conversation_id',
            'reminder_sent',
            'calendar_event_id',
            // Payment columns (snake_case only)
            'product_total',
            'packaging_fee',
            'delivery_fee',
            'final_total',
            'dp_min_amount',
            'paid_amount',
            'payment_status',
            'remaining_balance',
          ]],
        },
      });

      console.log('✅ WaitingList sheet initialized with headers (snake_case)');
    } else {
      // Ensure payment headers exist (for existing sheets)
      await ensureWaitingListPaymentHeaders();
    }
  } catch (error) {
    console.error('❌ Error initializing waiting list:', error.message);
    throw error;
  }
}

/**
 * Save order to waiting list (for future-dated orders)
 * Checks for duplicates before writing (idempotent)
 */
export async function saveToWaitingList(orderData, options = {}) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    const { skipDuplicateCheck = false } = options;
    
    // Generate order ID if not provided (MUST be done first)
    const orderId = orderData.id || `ORD-${Date.now()}`;
    if (!orderId) {
      throw new Error('Missing order_id: Failed to generate order ID before saving to WaitingList');
    }
    orderData.id = orderId;

    // Normalize event_date to YYYY-MM-DD format before saving
    const { normalizeEventDate } = await import('../utils/date-utils.js');
    const originalEventDate = orderData.event_date;
    if (orderData.event_date) {
      try {
        orderData.event_date = normalizeEventDate(orderData.event_date);
      } catch (error) {
        console.error(`❌ [SAVE_WAITING_LIST] Failed to normalize event_date "${originalEventDate}":`, error.message);
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
        console.error(`❌ [SAVE_WAITING_LIST] Failed to normalize delivery_time "${originalDeliveryTime}":`, error.message);
        throw new Error(`Invalid delivery_time format: ${originalDeliveryTime}. ${error.message}`);
      }
    }
    
    // Check for duplicate Order ID (unless explicitly skipped)
    if (!skipDuplicateCheck) {
      const existingRow = await findRowByOrderId(WAITING_LIST_SHEET, orderId);
      if (existingRow) {
        console.log(`⚠️ [SAVE_WAITING_LIST] Order ${orderId} already exists in WaitingList sheet (row ${existingRow}), skipping duplicate write`);
        // Return existing order data instead of creating duplicate
        // TODO: Import getOrderById from orders.repo.js
        const { getOrderById } = await import('../../google-sheets.js');
        const existingOrder = await getOrderById(orderId);
        return existingOrder || orderData;
      }
    }
    
    // Prepare order row (same format as Orders sheet + calendar_event_id)
    const itemsJson = JSON.stringify(orderData.items || []);
    const notesJson = JSON.stringify(orderData.notes || []);
    const totalItems = (orderData.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);

    // NOTE: Calendar events are now created only when orders are confirmed (in finalizeOrder)
    let calendarEventId = null;

    // Ensure payment headers exist before mapping
    await ensureWaitingListPaymentHeaders();
    
    // Get header map using alias-based mapping
    const headerMap = await getSheetHeaderMap(WAITING_LIST_SHEET, { requireSnakeCase: true, sheetType: 'WaitingList' });
    
    // Validate required columns exist
    const requiredKeys = ['order_id', 'customer_name', 'phone_number', 'status'];
    validateRequiredKeys(headerMap, requiredKeys, WAITING_LIST_SHEET);

    // Compute order totals (same as Orders sheet)
    const priceList = await getPriceList();
    const totals = await computeOrderTotals(orderData, priceList);

    // Prepare data object with snake_case keys
    const dataObject = {
      order_id: orderId,
      customer_name: orderData.customer_name || '',
      phone_number: orderData.phone_number || '',
      address: orderData.address || '',
      event_name: orderData.event_name || '',
      event_duration: orderData.event_duration || '',
      event_date: orderData.event_date || '',
      delivery_time: orderData.delivery_time || '', // Already normalized above
      items_json: itemsJson,
      notes_json: notesJson,
      status: orderData.status || 'waiting',
      total_items: totalItems,
      created_at: orderData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      conversation_id: orderData.conversation_id || '',
      reminder_sent: 'false',
      calendar_event_id: calendarEventId || '',
      // Payment columns (calculated values - snake_case only)
      product_total: totals.productTotal,
      packaging_fee: totals.packagingFee,
      delivery_fee: totals.deliveryFee,
      total_amount: totals.totalAmount, // Canonical field (WRITE)
      final_total: totals.finalTotal, // Deprecated, kept for backward compatibility
      dp_min_amount: totals.dpMinAmount,
      paid_amount: totals.paidAmount,
      payment_status: totals.paymentStatus,
      remaining_balance: totals.remainingBalance,
    };
    
    // Build row using header map
    const row = buildRowFromMap(headerMap, dataObject);
    
    console.log(`🔍 [SAVE_WAITING_LIST] Row prepared with ${row.filter(v => v !== '').length} non-empty values`);

    // UPSERT: Check if order exists and update, otherwise append
    const existingRowIndex = await findRowByOrderId(WAITING_LIST_SHEET, orderId);
    
    if (existingRowIndex) {
      // UPDATE existing row
      // Build update data for all columns
      const updateData = [];
      for (const [internalKey, columnIndex] of Object.entries(headerMap)) {
        if (internalKey.startsWith('__')) continue; // Skip metadata keys
        
        const value = dataObject[internalKey];
        if (value !== undefined && value !== null) {
          const col = columnIndexToLetter(columnIndex);
          updateData.push({
            range: `${WAITING_LIST_SHEET}!${col}${existingRowIndex}`,
            values: [[value]],
          });
        }
      }
      
      if (updateData.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            valueInputOption: 'RAW',
            data: updateData,
          },
        });
      }
    } else {
      // APPEND new row (only if doesn't exist)
      const lastCol = columnIndexToLetter(headerMap.__headersLength - 1);
      const range = `${WAITING_LIST_SHEET}!A:${lastCol}`;

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: range,
        valueInputOption: 'RAW',
        requestBody: {
          values: [row],
        },
      });
    }

    console.log(`✅ [SAVE_WAITING_LIST] Order ${orderId} saved to WaitingList successfully (upserted)`);
    return { ...orderData, calendar_event_id: calendarEventId };
  } catch (error) {
    console.error('❌ Error saving to waiting list:', error.message);
    throw error;
  }
}

/**
 * Get all orders from waiting list
 */
export async function getWaitingListOrders() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Ensure payment headers exist before mapping
    await ensureWaitingListPaymentHeaders();
    
    // Get header map using alias-based mapping
    const headerMap = await getSheetHeaderMap(WAITING_LIST_SHEET, { requireSnakeCase: true, sheetType: 'WaitingList' });
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${WAITING_LIST_SHEET}!A:${columnIndexToLetter(headerMap.__headersLength - 1)}`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      console.log(`⚠️ [GET_WAITING_LIST] No data rows in ${WAITING_LIST_SHEET} (only headers)`);
      return [];
    }

    // Import normalizers for defensive normalization
    const { normalizeEventDate } = await import('../utils/date-utils.js');
    const { normalizeDeliveryTime } = await import('../services/price-calculator.js');
    
    const orders = [];
    // Skip header row
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Helper to get value from row by internal key
      const getValue = (internalKey, defaultValue = '') => {
        const colIndex = headerMap[internalKey];
        if (colIndex === undefined) return defaultValue;
        return row[colIndex] !== undefined && row[colIndex] !== '' ? row[colIndex] : defaultValue;
      };
      
      try {
        // Parse items and notes JSON
        let items = [];
        let notes = [];
        try {
          const itemsJson = getValue('items_json', '[]');
          const notesJson = getValue('notes_json', '[]');
          items = JSON.parse(itemsJson);
          notes = JSON.parse(notesJson);
        } catch (e) {
          console.warn(`⚠️ [GET_WAITING_LIST] Error parsing items/notes JSON for row ${i}:`, e.message);
        }
        
        // Defensive normalization for event_date and delivery_time (handle legacy formats)
        let eventDate = getValue('event_date');
        let deliveryTime = getValue('delivery_time');
        
        // Normalize event_date if not already in YYYY-MM-DD format
        if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
          try {
            eventDate = normalizeEventDate(eventDate);
          } catch (error) {
            // Keep original value if normalization fails
          }
        }
        
        // Normalize delivery_time if not already in HH:MM format
        if (deliveryTime && !/^\d{2}:\d{2}$/.test(deliveryTime)) {
          try {
            deliveryTime = normalizeDeliveryTime(deliveryTime);
          } catch (error) {
            // Keep original value if normalization fails
          }
        }
        
        orders.push({
          id: getValue('order_id'),
          customer_name: getValue('customer_name'),
          phone_number: getValue('phone_number'),
          address: getValue('address'),
          event_name: getValue('event_name'),
          event_duration: getValue('event_duration'),
          event_date: eventDate,
          delivery_time: deliveryTime,
          items: items,
          notes: notes,
          status: getValue('status', 'waiting'),
          total_items: parseInt(getValue('total_items', '0')) || 0,
          created_at: getValue('created_at'),
          updated_at: getValue('updated_at'),
          conversation_id: getValue('conversation_id'),
          reminder_sent: getValue('reminder_sent') === 'true',
          calendar_event_id: getValue('calendar_event_id'),
        });
      } catch (error) {
        console.error(`❌ [GET_WAITING_LIST] Error parsing waiting list row ${i}:`, error);
      }
    }

    console.log(`✅ [GET_WAITING_LIST] Retrieved ${orders.length} order(s) from waiting list`);
    return orders;
  } catch (error) {
    console.error('❌ [GET_WAITING_LIST] Error getting waiting list orders:', error.message);
    return [];
  }
}

/**
 * Check and process waiting list orders that are due today
 */
export async function checkWaitingList() {
  try {
    const waitingOrders = await getWaitingListOrders();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const dueOrders = [];
    
    for (const order of waitingOrders) {
      if (order.reminder_sent) continue; // Already sent reminder
      
      if (!order.event_date) continue;
      
      // Parse date (format: YYYY-MM-DD or DD/MM/YYYY)
      let orderDate;
      if (order.event_date.includes('/')) {
        // Legacy format: DD/MM/YYYY
        const dateParts = order.event_date.split('/');
        if (dateParts.length !== 3) continue;
        orderDate = new Date(
          parseInt(dateParts[2]), // Year
          parseInt(dateParts[1]) - 1, // Month (0-indexed)
          parseInt(dateParts[0]) // Day
        );
      } else {
        // New format: YYYY-MM-DD
        orderDate = new Date(order.event_date);
      }
      orderDate.setHours(0, 0, 0, 0);
      
      // Check if order date is today or in the past
      if (orderDate <= today) {
        dueOrders.push(order);
      }
    }
    
    return dueOrders;
  } catch (error) {
    console.error('❌ Error checking waiting list:', error.message);
    return [];
  }
}

/**
 * Update waiting list order status
 */
export async function updateWaitingListOrderStatus(orderId, newStatus) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Find row index using header mapping
    const rowIndex = await findRowByOrderId(WAITING_LIST_SHEET, orderId);
    if (!rowIndex) {
      throw new Error(`Order ${orderId} not found in WaitingList`);
    }
    
    // Get header map to find status column
    const headerMap = await getSheetHeaderMap(WAITING_LIST_SHEET, { requireSnakeCase: true, sheetType: 'WaitingList' });
    const statusColIndex = headerMap.status;
    
    if (statusColIndex === undefined) {
      throw new Error('Status column not found in WaitingList sheet');
    }
    
    const statusCol = columnIndexToLetter(statusColIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${WAITING_LIST_SHEET}!${statusCol}${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[newStatus]],
      },
    });

    // Update updated_at if column exists
    const updatedAtColIndex = headerMap.updated_at;
    if (updatedAtColIndex !== undefined) {
      const updatedAtCol = columnIndexToLetter(updatedAtColIndex);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${WAITING_LIST_SHEET}!${updatedAtCol}${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[new Date().toISOString()]],
        },
      });
    }

    return true;
  } catch (error) {
    console.error(`❌ [UPDATE_WAITING_LIST_STATUS] Error updating waiting list order status:`, error.message);
    throw error;
  }
}
