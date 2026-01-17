/**
 * Reminder System
 * Handles H-4, H-3, H-1 reminders for orders based on event date
 * Implements PRD reminder requirements
 */

import { getAllOrders, getOrderById } from '../repos/orders.repo.js';
import { getAdminChatIds } from '../repos/users.repo.js';
import { getSheetsClient, getSpreadsheetId } from '../repos/sheets.client.js';

import { SHEET_NAMES, REMINDER_STATUS, ORDER_STATUS } from '../utils/constants.js';
import { THANK_YOU_ATTENTION } from '../utils/messages.js';

const REMINDERS_SHEET = SHEET_NAMES.REMINDERS;

/**
 * Ensure Reminders sheet exists with correct headers
 */
export async function ensureRemindersSheet() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Get spreadsheet to check if Reminders sheet exists
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
    
    if (!existingSheets.includes(REMINDERS_SHEET)) {
      // Create Reminders sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: REMINDERS_SHEET,
              },
            },
          }],
        },
      });

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${REMINDERS_SHEET}!A1:J1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            'Reminder ID',
            'Order ID',
            'Reminder Type',
            'Reminder Date',
            'Status',
            'Sent At',
            'Attempts',
            'Last Attempt At',
            'Created At',
            'Notes',
          ]],
        },
      });

    }
  } catch (error) {
    console.error('❌ Error ensuring Reminders sheet:', error.message);
    throw error;
  }
}

/**
 * Check if reminder already exists (by Order ID and Reminder Type)
 * @param {string} orderId - Order ID
 * @param {string} reminderType - Reminder type (H-4, H-3, H-1)
 * @returns {Promise<boolean>} True if reminder exists
 */
async function reminderExists(orderId, reminderType) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Import header mapping functions
    const { getSheetHeaderMap } = await import('../utils/sheets-helpers.js');
    
    // Get header map using alias-based mapping (Reminders doesn't need snake_case enforcement)
    const headerMap = await getSheetHeaderMap(REMINDERS_SHEET, { requireSnakeCase: false });
    const orderIdColIndex = headerMap.order_id;
    const reminderTypeColIndex = headerMap.reminder_type;
    
    if (orderIdColIndex === undefined || reminderTypeColIndex === undefined) {
      console.warn(`⚠️ [REMINDER_EXISTS] Required columns not found in ${REMINDERS_SHEET} sheet`);
      return false; // Assume doesn't exist if columns not found
    }
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${REMINDERS_SHEET}!A:${String.fromCharCode(65 + headerMap.__headersLength - 1)}`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      console.log(`⚠️ [REMINDER_EXISTS] No data rows in ${REMINDERS_SHEET} (only headers)`);
      return false; // No data rows (only header)
    }

    // Check if reminder with same Order ID and Type exists using header mapping
    for (let i = 1; i < rows.length; i++) {
      const rowOrderId = rows[i][orderIdColIndex];
      const rowReminderType = rows[i][reminderTypeColIndex];
      if (rowOrderId === orderId && rowReminderType === reminderType) {

        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('❌ [REMINDER_EXISTS] Error checking reminder existence:', error);
    if (error.stack) {
      console.error(`❌ [REMINDER_EXISTS] Stack:`, error.stack);
    }
    return false; // On error, assume doesn't exist (allow write)
  }
}

/**
 * Save reminder to Reminders sheet
 * Includes comprehensive logging and duplicate checking
 */
export async function saveReminder(reminderData) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();

    await ensureRemindersSheet();
    
    // Check for duplicate reminder (same Order ID + Reminder Type)
    const exists = await reminderExists(reminderData.orderId, reminderData.reminderType);
    if (exists) {

      return `${reminderData.orderId}_${reminderData.reminderType}_existing`;
    }
    
    const reminderId = reminderData.id || `${reminderData.orderId}_${reminderData.reminderType}_${Date.now()}`;
    
    // Import header mapping functions from sheets-helpers.js
    const { getSheetHeaderMap, buildRowFromMap, validateRequiredKeys } = await import('../utils/sheets-helpers.js');
    
    // Get header map using alias-based mapping (Reminders doesn't need snake_case enforcement)
    const headerMap = await getSheetHeaderMap(REMINDERS_SHEET, { requireSnakeCase: false });
    
    // Validate required columns exist
    const requiredKeys = ['reminder_id', 'order_id', 'reminder_type', 'reminder_date', 'status'];
    validateRequiredKeys(headerMap, requiredKeys, REMINDERS_SHEET);
    
    // Normalize reminder_date to YYYY-MM-DD format before saving
    let normalizedReminderDate = reminderData.reminderDate || '';
    if (normalizedReminderDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedReminderDate)) {
      try {
        const { normalizeEventDate } = await import('../utils/date-utils.js');
        normalizedReminderDate = normalizeEventDate(normalizedReminderDate);

      } catch (error) {
        console.error(`❌ [SAVE_REMINDER] Failed to normalize reminder_date "${reminderData.reminderDate}":`, error.message);
        throw new Error(`Invalid reminder_date format: ${reminderData.reminderDate}. ${error.message}`);
      }
    }
    
    // Prepare data object with snake_case keys
    const dataObject = {
      reminder_id: reminderId,
      order_id: reminderData.orderId || '',
      reminder_type: reminderData.reminderType || '', // H-4, H-3, H-1
      reminder_date: normalizedReminderDate, // YYYY-MM-DD format
      status: reminderData.status || 'pending',
      sent_at: reminderData.sentAt || '',
      attempts: reminderData.attempts || 0,
      last_attempt_at: reminderData.lastAttemptAt || '',
      created_at: reminderData.createdAt || new Date().toISOString(),
      notes: reminderData.notes || '',
    };
    
    // Build row using header map
    const row = buildRowFromMap(headerMap, dataObject);

    // Determine range dynamically based on header length
    const lastCol = String.fromCharCode(65 + headerMap.__headersLength - 1); // A=65
    const range = `${REMINDERS_SHEET}!A:${lastCol}`;

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [row],
      },
    });

    return reminderId;
  } catch (error) {
    console.error('❌ [SAVE_REMINDER] Error saving reminder:', error);
    console.error('❌ [SAVE_REMINDER] Stack:', error.stack);
    console.error('❌ [SAVE_REMINDER] Reminder data:', reminderData);
    throw error;
  }
}

/**
 * Get reminders for a specific date
 */
export async function getRemindersForDate(date) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    await ensureRemindersSheet();
    
    // Import header mapping functions
    const { getSheetHeaderMap } = await import('../utils/sheets-helpers.js');
    
    // Get header map using alias-based mapping (Reminders doesn't need snake_case enforcement)
    const headerMap = await getSheetHeaderMap(REMINDERS_SHEET, { requireSnakeCase: false });
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${REMINDERS_SHEET}!A:${String.fromCharCode(65 + headerMap.__headersLength - 1)}`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      console.log(`⚠️ [GET_REMINDERS] No data rows in ${REMINDERS_SHEET} (only headers)`);
      return [];
    }

    const targetDate = date instanceof Date ? date.toISOString().split('T')[0] : date;
    
    // Helper to get value from row by internal key
    const getValue = (row, internalKey, defaultValue = '') => {
      const colIndex = headerMap[internalKey];
      if (colIndex === undefined) return defaultValue;
      return row[colIndex] !== undefined && row[colIndex] !== '' ? row[colIndex] : defaultValue;
    };

    return rows.slice(1).map(row => ({
      id: getValue(row, 'reminder_id'),
      orderId: getValue(row, 'order_id'),
      reminderType: getValue(row, 'reminder_type'),
      reminderDate: getValue(row, 'reminder_date'),
      status: getValue(row, 'status', 'pending'),
      sentAt: getValue(row, 'sent_at'),
      attempts: parseInt(getValue(row, 'attempts', '0')) || 0,
      lastAttemptAt: getValue(row, 'last_attempt_at'),
      createdAt: getValue(row, 'created_at'),
      notes: getValue(row, 'notes'),
    })).filter(r => r.reminderDate === targetDate && r.status === REMINDER_STATUS.PENDING);
  } catch (error) {
    console.error('❌ [GET_REMINDERS] Error getting reminders:', error.message);
    console.error(`❌ [GET_REMINDERS] Stack:`, error.stack);
    return [];
  }
}

/**
 * Mark reminder as sent (optimized to minimize read requests)
 * Uses findRowByReminderId pattern instead of reading all rows
 */
export async function markReminderSent(reminderId) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    const { getSheetHeaderMap, columnIndexToLetter } = await import('../utils/sheets-helpers.js');
    
    // Get header map using alias-based mapping (Reminders doesn't need snake_case enforcement)
    const headerMap = await getSheetHeaderMap(REMINDERS_SHEET, { requireSnakeCase: false });
    const reminderIdColIndex = headerMap.reminder_id;
    
    if (reminderIdColIndex === undefined) {
      console.error(`❌ [MARK_REMINDER_SENT] Column "reminder_id" not found in ${REMINDERS_SHEET} sheet`);
      return false;
    }
    
    // OPTIMIZATION: Read only column with reminder_id to find the row (minimize read requests)
    const reminderIdCol = columnIndexToLetter(reminderIdColIndex);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${REMINDERS_SHEET}!${reminderIdCol}:${reminderIdCol}`, // Only read reminder_id column
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      console.log(`⚠️ [MARK_REMINDER_SENT] No data rows in ${REMINDERS_SHEET} (only headers)`);
      return false;
    }

    // Find row with matching reminder ID
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === reminderId) { // Column A (reminder_id column)
        rowIndex = i + 1; // +1 because Google Sheets is 1-indexed
        break;
      }
    }

    if (rowIndex === -1) {
      console.warn(`⚠️ [MARK_REMINDER_SENT] Reminder ID "${reminderId}" not found in ${REMINDERS_SHEET} sheet`);
      return false;
    }
    
    // Read only the specific row to get current values (minimize read requests)
    const lastColumn = columnIndexToLetter(headerMap.__headersLength - 1);
    const rowResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${REMINDERS_SHEET}!A${rowIndex}:${lastColumn}${rowIndex}`, // Read only this row
    });
    
    const reminderRow = rowResponse.data.values?.[0] || [];

    const now = new Date().toISOString();
    
    // Get current attempts using header mapping
    const attemptsColIndex = headerMap.attempts;
    const currentAttempts = attemptsColIndex !== undefined ? (parseInt(reminderRow[attemptsColIndex] || 0) + 1) : 1;

    // Build update data using header mapping
    const updateData = [];
    
    const updateColumn = (internalKey, value) => {
      const colIndex = headerMap[internalKey];
      if (colIndex !== undefined) {
        const col = String.fromCharCode(65 + colIndex); // A=65
        updateData.push({
          range: `${REMINDERS_SHEET}!${col}${rowIndex}`,
          values: [[value]],
        });
        return true;
      }
      console.warn(`⚠️ [MARK_REMINDER_SENT] Column "${internalKey}" not found in header map, skipping update`);
      return false;
    };
    
    // Update reminder fields using internal keys
    updateColumn('status', REMINDER_STATUS.SENT_UPPERCASE);
    updateColumn('sent_at', now);
    updateColumn('attempts', currentAttempts);
    updateColumn('last_attempt_at', now);

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: updateData,
        },
      });
    }

    return true;
  } catch (error) {
    console.error('❌ [MARK_REMINDER_SENT] Error marking reminder as sent:', error.message);
    console.error(`❌ [MARK_REMINDER_SENT] Stack:`, error.stack);
    return false;
  }
}

/**
 * Parse event date from DD/MM/YYYY format
 * Safe parser that handles DD/MM/YYYY format correctly
 * @param {string} input - Date string in DD/MM/YYYY format
 * @returns {Date|null} Parsed date or null if invalid
 */
function parseEventDate(input) {
  if (!input || typeof input !== 'string') {

    return null;
  }
  
  try {
    // Handle DD/MM/YYYY format
    if (input.includes('/')) {
      const parts = input.split('/');
      if (parts.length !== 3) {
        console.log(`⚠️ [PARSE_EVENT_DATE] Invalid format (expected DD/MM/YYYY): ${input}`);
        return null;
      }
      
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
      let year = parseInt(parts[2], 10);
      
      // Handle 2-digit years (assume 2000-2099)
      if (year < 100) {
        year += 2000;
      }
      
      // Validate parsed values
      if (isNaN(day) || isNaN(month) || isNaN(year)) {

        return null;
      }
      
      // Construct Date using local time (year, monthIndex, day)
      const date = new Date(year, month, day);
      
      // Normalize to start of day (00:00)
      date.setHours(0, 0, 0, 0);
      
      // Validate date
      if (isNaN(date.getTime())) {

        return null;
      }
      
      // Verify the date matches input (catch month/day overflow)
      if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) {
        console.log(`⚠️ [PARSE_EVENT_DATE] Date mismatch - input: ${input}, parsed: ${date.toISOString()}`);
        return null;
      }
      
      console.log(`✅ [PARSE_EVENT_DATE] Successfully parsed: ${input} → ${date.toISOString().split('T')[0]}`);
      return date;
    } else {
      // Try standard Date parsing as fallback
      const date = new Date(input);
      if (isNaN(date.getTime())) {

        return null;
      }
      date.setHours(0, 0, 0, 0);
      console.log(`✅ [PARSE_EVENT_DATE] Parsed (fallback): ${input} → ${date.toISOString().split('T')[0]}`);
      return date;
    }
  } catch (error) {
    console.error(`❌ [PARSE_EVENT_DATE] Error parsing date "${input}":`, error);
    return null;
  }
}

/**
 * Calculate reminder dates for an order (H-4, H-3, H-1)
 * Expects eventDate in YYYY-MM-DD format (normalized)
 * Uses safe date parsing and normalizes all dates to start of day
 */
export function calculateReminderDates(eventDate) {
  if (!eventDate) {

    return null;
  }

  try {
    let date;
    
    // If already in YYYY-MM-DD format, parse directly
    if (/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      date = new Date(eventDate + 'T00:00:00');
      if (isNaN(date.getTime())) {

        return null;
      }
    } else {
      // Legacy format - use parser (defensive)
      date = parseEventDate(eventDate);
      if (!date) {

        return null;
      }
    }
    
    // Normalize today to start of day for comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    console.log(`🔍 [CALC_REMINDER_DATES] Event date: ${date.toISOString().split('T')[0]}, Today: ${today.toISOString().split('T')[0]}`);
    
    // Check if event date is in the future
    if (date <= today) {
      console.log(`⚠️ [CALC_REMINDER_DATES] Event date is not in the future (${date.toISOString().split('T')[0]} <= ${today.toISOString().split('T')[0]})`);
      return null;
    }
    
    // Calculate reminder dates (H-4, H-3, H-1)
    const h4Date = new Date(date);
    h4Date.setDate(h4Date.getDate() - 4);
    h4Date.setHours(0, 0, 0, 0);
    
    const h3Date = new Date(date);
    h3Date.setDate(h3Date.getDate() - 3);
    h3Date.setHours(0, 0, 0, 0);
    
    const h1Date = new Date(date);
    h1Date.setDate(h1Date.getDate() - 1);
    h1Date.setHours(0, 0, 0, 0);
    
    const reminderDates = {
      'H-4': h4Date.toISOString().split('T')[0],
      'H-3': h3Date.toISOString().split('T')[0],
      'H-1': h1Date.toISOString().split('T')[0],
    };

    return reminderDates;
  } catch (error) {
    console.error('❌ [CALC_REMINDER_DATES] Error calculating reminder dates:', error);
    console.error('❌ [CALC_REMINDER_DATES] Stack:', error.stack);
    return null;
  }
}

// Use shared normalizeDeliveryTime from price-calculator for consistency

/**
 * Create reminders for an order (H-4, H-3, H-1)
 * 
 * @deprecated This function is DEPRECATED. Do NOT use it.
 * Reminders are now handled by the daily job (runDailyRemindersJob) which:
 * - Reads Orders and Reminders once per day (quota-friendly)
 * - Treats Reminders sheet as a send log (append-only)
 * - Does NOT pre-create reminder rows
 * 
 * This function is kept for backward compatibility but should not be called.
 * If you see this being called, remove the call and rely on the daily job instead.
 */
export async function createOrderReminders(orderId, eventDate, orderData = null) {
  console.warn(`⚠️ [DEPRECATED] createOrderReminders() called for order ${orderId}. This should not be called. Reminders are handled by daily job.`);
  // Return empty array to prevent errors, but do NOT create reminders
  return [];

  try {
    // Normalize event_date to YYYY-MM-DD format if needed (defensive)
    let normalizedEventDate = eventDate;
    if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      try {
        const { normalizeEventDate } = await import('../utils/date-utils.js');
        normalizedEventDate = normalizeEventDate(eventDate);

      } catch (error) {
        console.error(`❌ [CREATE_REMINDERS] Failed to normalize event_date "${eventDate}":`, error.message);
        return [];
      }
    }
    
    // Normalize today for comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    console.log(`🔍 [CREATE_REMINDERS] Today (normalized): ${today.toISOString().split('T')[0]}`);
    
    // Calculate reminder dates (expects YYYY-MM-DD format)
    const reminderDates = calculateReminderDates(normalizedEventDate);
    if (!reminderDates) {

      return [];
    }

    // Get order data if not provided (for additional info like delivery time)
    let order = orderData;
    if (!order) {
      try {
        const { getOrderById } = await import('../repos/orders.repo.js');
        order = await getOrderById(orderId);
        if (order) {

        } else {

        }
      } catch (error) {
        console.error(`⚠️ [CREATE_REMINDERS] Error retrieving order data:`, error);
        // Continue without order data
      }
    }

    // Format delivery time if available (use shared normalizeDeliveryTime)
    let deliveryTime = '';
    if (order?.delivery_time) {
      try {
        const { normalizeDeliveryTime } = await import('./price-calculator.js');
        deliveryTime = normalizeDeliveryTime(order.delivery_time);

      } catch (error) {
        console.warn(`⚠️ [CREATE_REMINDERS] Failed to normalize delivery_time "${order.delivery_time}":`, error.message);
        // Use original value if normalization fails
        deliveryTime = order.delivery_time;
      }
    }

    const reminders = [];
    for (const [type, date] of Object.entries(reminderDates)) {
      try {

        // Build reminder data
        const reminderData = {
          orderId,
          reminderType: type,
          reminderDate: date,
          status: 'pending',
          notes: order ? 
            `Customer: ${order.customer_name || 'N/A'}, Phone: ${order.phone_number || 'N/A'}, Event: ${order.event_name || 'N/A'}, Delivery Time: ${deliveryTime || 'TBD'}` :
            '',
        };
        
        const reminderId = await saveReminder(reminderData);
        reminders.push({ id: reminderId, type, date });
        
        console.log(`✅ [CREATE_REMINDERS] Created reminder ${reminderId} (${type}) for ${date}`);
      } catch (error) {
        console.error(`❌ [CREATE_REMINDERS] Error creating reminder ${type} for order ${orderId}:`, error);
        console.error(`❌ [CREATE_REMINDERS] Stack:`, error.stack);
        // Continue with other reminders even if one fails
      }
    }

    console.log(`✅ [CREATE_REMINDERS] Successfully created ${reminders.length} reminder(s) for order ${orderId}`);
    return reminders;
  } catch (error) {
    console.error(`❌ [CREATE_REMINDERS] Fatal error creating reminders for order ${orderId}:`, error);
    console.error(`❌ [CREATE_REMINDERS] Stack:`, error.stack);
    return [];
  }
}

/**
 * Format Rupiah currency
 */
// Import formatting utilities
import { formatRupiah, formatPrice } from '../utils/formatting.js';

/**
 * Get reminder message based on type (exact templates as specified)
 */
function getReminderMessage(order, reminderType) {
  const orderId = order.id || 'N/A';
  const customerName = order.customer_name || 'N/A';
  const eventDate = order.event_date || 'N/A';
  const deliveryTime = order.delivery_time || 'TBD';
  const totalAmount = order.total_amount || order.final_total || 0;
  const paidAmount = order.paid_amount || 0;
  const paymentStatus = order.payment_status || 'UNPAID';
  const remainingBalance = totalAmount - paidAmount;
  const shippingMethod = order.shipping_method || order.delivery_method || '-';
  
  // Format items list
  let itemsList = '';
  const items = order.items || [];
  if (items.length > 0) {
    itemsList = items.map(item => `${item.quantity}x ${item.name}`).join('\n');
  } else {
    itemsList = '-';
  }
  
  // Calculate total cups
  const totalCups = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  
  // Check packaging
  const packagingStatus = order.packaging_fee > 0 ? 'YA' : 'TIDAK';
  
  let message = '';
  
  switch (reminderType) {
    case 'H4_PAYMENT':
      // REMINDER H-4 (Customer: Pelunasan – WAJIB) with FULL PAYMENT confirmation
      message = `Halo ${customerName} 👋\n\n`;
      message += `Kami dari Dawet Kemayu Menteng ingin mengingatkan bahwa\n`;
      message += `jadwal pengiriman pesanan Anda tinggal H-4.\n\n`;
      message += `Detail pesanan:\n`;
      message += `Invoice: \`${orderId}\`\n`;
      message += `Total Pesanan: Rp${formatRupiah(totalAmount)}\n`;
      message += `Sisa Pembayaran: Rp${formatRupiah(remainingBalance)}\n\n`;
      message += `⚠️ **PENTING: PELUNASAN PENUH WAJIB**\n\n`;
      message += `Mohon melakukan **pelunasan pembayaran penuh**\n`;
      message += `paling lambat H-3 sebelum pengiriman.\n`;
      message += `Jika pembayaran tidak diterima hingga H-3, pesanan akan **dibatalkan secara otomatis**.\n\n`;
      message += `--------------------------------\n`;
      message += `🏦 PEMBAYARAN TRANSFER BANK\n`;
      message += `Bank Jago\n`;
      message += `No. Rekening: 102730840011\n`;
      message += `a.n. Septina Eka Kartika Dewi\n`;
      message += `--------------------------------\n\n`;
      message += THANK_YOU_ATTENTION;
      break;
      
    case 'H3_ORDER_BAHAN':
      // REMINDER H-3 – ORDER BAHAN (INTERNAL)
      message = `⏰ REMINDER H-3 – ORDER BAHAN\n\n`;
      message += `Pesanan:\n`;
      message += `Invoice: \`${orderId}\`\n`;
      message += `Nama Pemesan: ${customerName}\n`;
      message += `Tanggal Event: ${eventDate}\n`;
      message += `Waktu Kirim: ${deliveryTime}\n\n`;
      message += `Detail Pesanan:\n${itemsList}\n\n`;
      message += `Catatan:\n`;
      message += `• Pastikan semua bahan sudah dipesan hari ini\n`;
      message += `• Cek ketersediaan bahan utama & topping\n`;
      message += `• Konfirmasi ulang jumlah cup & packaging\n\n`;
      message += `Status Pembayaran: ${paymentStatus}\n\n`;
      message += `Harap segera lakukan order bahan.`;
      break;
      
    case 'H1_PREPARATION':
      // REMINDER H-1 – PREPARATION (OUTLET)
      message = `⏰ REMINDER H-1 – PREPARATION\n`;
      message += `Dawet Kemayu Menteng\n\n`;
      message += `Pesanan:\n`;
      message += `Invoice: \`${orderId}\`\n`;
      message += `Nama Pemesan: ${customerName}\n`;
      message += `Tanggal Event: ${eventDate}\n`;
      message += `Waktu Kirim: ${deliveryTime}\n`;
      message += `--------------------------------\n\n`;
      message += `📦 DETAIL PESANAN\n${itemsList}\n`;
      message += `Total Cup: ${totalCups} cup\n`;
      message += `Packaging Styrofoam: ${packagingStatus}\n`;
      message += `Metode Pengiriman: ${shippingMethod}\n`;
      message += `--------------------------------\n\n`;
      message += `🛠️ CHECKLIST PREPARATION\n`;
      message += `• Bahan utama siap & sesuai jumlah\n`;
      message += `• Topping lengkap\n`;
      message += `• Cup, sedotan, tutup tersedia\n`;
      message += `• Packaging styrofoam siap (jika ada)\n`;
      message += `• Label / penanda pesanan jelas\n`;
      message += `• Alamat & PIC pengiriman sudah dicek\n`;
      message += `--------------------------------\n\n`;
      message += `Status Pembayaran: ${paymentStatus}\n\n`;
      message += `Harap pastikan semua persiapan selesai hari ini.`;
      break;
      
    default:
      message = `🔔 **REMINDER**\n\nOrder ID: \`${orderId}\``;
  }

  return message;
}

/**
 * Send reminder to all active admin Telegram users
 * Reads admin chat IDs from Users sheet (platform=telegram, role=admin, is_active=true)
 * Sends to all admins and returns success/failure summary
 * 
 * @param {string} messageText - Message text to send
 * @param {Function} sendMessage - Function to send Telegram message (chatId, text)
 * @returns {Promise<{success: boolean, successCount: number, failCount: number, errorMessage?: string}>}
 */
export async function sendReminderToAdmins(messageText, sendMessage) {
  try {
    // Get admin chat IDs from Users sheet (with caching)
    const chatIds = await getAdminChatIds();
    
    if (chatIds.length === 0) {
      const errorMsg = 'No admin recipients found in Users (platform=telegram, role=admin, is_active=true)';
      console.warn(`⚠️ [SEND_REMINDER_ADMINS] ${errorMsg}`);
      return {
        success: false,
        successCount: 0,
        failCount: 0,
        errorMessage: errorMsg,
      };
    }
    
    console.log(`📤 [SEND_REMINDER_ADMINS] Sending to ${chatIds.length} admin(s)...`);
    
    let successCount = 0;
    let failCount = 0;
    let firstError = null;
    
    // Send to each admin
    for (const chatId of chatIds) {
      try {
        await sendMessage(chatId, messageText);
        successCount++;

      } catch (error) {
        failCount++;
        if (!firstError) {
          firstError = error.message || String(error);
        }
        console.error(`❌ [SEND_REMINDER_ADMINS] Failed to send to admin chat ${chatId}:`, error.message);
      }
    }
    
    if (successCount > 0) {
      console.log(`✅ [SEND_REMINDER_ADMINS] Successfully sent to ${successCount}/${chatIds.length} admin(s)`);
      return {
        success: true,
        successCount,
        failCount,
      };
    } else {
      // All sends failed
      const errorMsg = `Telegram send failed for all admins: ${firstError || 'Unknown error'}`;
      console.error(`❌ [SEND_REMINDER_ADMINS] ${errorMsg}`);
      return {
        success: false,
        successCount: 0,
        failCount,
        errorMessage: errorMsg,
      };
    }
  } catch (error) {
    const errorMsg = `Error getting admin recipients: ${error.message || String(error)}`;
    console.error(`❌ [SEND_REMINDER_ADMINS] ${errorMsg}`);
    return {
      success: false,
      successCount: 0,
      failCount: 0,
      errorMessage: errorMsg,
    };
  }
}

/**
 * Send reminder to admin (DEPRECATED - use sendReminderToAdmins instead)
 * @deprecated Use sendReminderToAdmins() which reads from Users sheet
 */
export async function sendReminderToAdmin(order, reminderType, sendMessage) {
  console.warn('⚠️ [DEPRECATED] sendReminderToAdmin() is deprecated. Use sendReminderToAdmins() instead.');
  const message = getReminderMessage(order, reminderType);
  const result = await sendReminderToAdmins(message, sendMessage);
  return result.success;
}

/**
 * Run daily reminders job (quota-friendly, reads Orders and Reminders once)
 * Algorithm:
 * 1. Get today's date in Asia/Jakarta
 * 2. Read Orders ONCE (filter orders with event_date in [today+1 .. today+4])
 * 3. Read Reminders ONCE (build idempotency set)
 * 4. For each eligible order, determine reminder type and send if not already sent
 * 5. Append reminder log row only when sending (treat Reminders as send log)
 * 
 * @param {Function} sendMessage - Function to send Telegram message
 * @param {Date} todayOverride - Optional date override for testing
 */
export async function runDailyRemindersJob(sendMessage, todayOverride = null) {
  try {
    const { getTodayJakarta, getDaysDiffJakarta } = await import('../utils/date-utils.js');
    const { getAllOrders } = await import('../repos/orders.repo.js');
    
    // Get today's date in Asia/Jakarta
    const today = todayOverride ? getTodayJakarta(todayOverride) : getTodayJakarta();

    // STEP 1: Read Orders ONCE (minimal reads)
    console.log(`📖 [DAILY_REMINDERS] Reading Orders sheet (once)...`);
    const allOrders = await getAllOrders(1000); // Read up to 1000 orders
    
    // Import normalizeEventDate for date normalization
    const { normalizeEventDate } = await import('../utils/date-utils.js');
    
    // Filter orders whose event_date is within [today+1 .. today+4] window
    const eligibleOrders = [];
    for (const order of allOrders) {
      if (!order.event_date) continue;
      
      // Parse event_date (should be YYYY-MM-DD)
      let eventDateStr = order.event_date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDateStr)) {
        // Try to normalize if not in YYYY-MM-DD format
        try {
          const normalized = normalizeEventDate(eventDateStr);
          eventDateStr = normalized;
          order.event_date = normalized; // Update in-place
        } catch (e) {
          continue; // Skip invalid dates
        }
      }
      
      const daysDiff = getDaysDiffJakarta(eventDateStr, todayOverride || new Date());
      // Only include orders where reminder is due today (days_diff = 1, 3, or 4)
      if (daysDiff !== null && (daysDiff === 1 || daysDiff === 3 || daysDiff === 4)) {
        eligibleOrders.push(order);
      }
    }
    
    console.log(`✅ [DAILY_REMINDERS] Found ${eligibleOrders.length} eligible order(s) for today`);
    
    if (eligibleOrders.length === 0) {

      return;
    }
    
    // STEP 2: Read Reminders ONCE (anti-spam + idempotency sets)
    console.log(`📖 [DAILY_REMINDERS] Reading Reminders sheet (once) for anti-spam and idempotency...`);
    
    // Read ALL reminders (not just today's) to build global per-invoice lock
    const allReminders = await getAllReminders(); // Read all reminders
    
    // Build anti-spam set: invoices that have ANY SENT reminder (global lock)
    const sentInvoiceSet = new Set();
    for (const reminder of allReminders) {
      if (reminder.status === REMINDER_STATUS.SENT_UPPERCASE && reminder.orderId) {
        sentInvoiceSet.add(reminder.orderId);
      }
    }
    
    console.log(`✅ [DAILY_REMINDERS] Found ${sentInvoiceSet.size} invoice(s) with SENT reminders (anti-spam lock)`);
    
    // Build idempotency set for today: key = `${order_id}|${reminder_type}|${reminder_date}`
    const sentKeys = new Set();
    const todayReminders = allReminders.filter(r => r.reminderDate === today);
    for (const reminder of todayReminders) {
      if (reminder.status === REMINDER_STATUS.SENT_UPPERCASE || reminder.status === REMINDER_STATUS.SKIPPED || reminder.status === REMINDER_STATUS.FAILED) {
        const key = `${reminder.orderId}|${reminder.reminderType}|${reminder.reminderDate}`;
        sentKeys.add(key);
      }
    }
    
    console.log(`✅ [DAILY_REMINDERS] Found ${sentKeys.size} already-processed reminder(s) for today in idempotency set`);
    
    // STEP 3: Process each eligible order
    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    
    for (const order of eligibleOrders) {
      try {
        const eventDateStr = order.event_date;
        const daysDiff = getDaysDiffJakarta(eventDateStr, todayOverride || new Date());
        
        // Determine reminder type based on days_diff
        let reminderType = null;
        if (daysDiff === 4) {
          reminderType = 'H4_PAYMENT';
        } else if (daysDiff === 3) {
          reminderType = 'H3_ORDER_BAHAN';
        } else if (daysDiff === 1) {
          reminderType = 'H1_PREPARATION';
        }
        
        // H-3 Auto-cancel logic: If order is not PAID by H-3, cancel it
        if (daysDiff === 3) {
          const paymentStatus = (order.payment_status || 'UNPAID').toUpperCase();
          const isPaid = paymentStatus === 'FULL PAID' || paymentStatus === 'FULLPAID' || paymentStatus === 'PAID';
          
          if (!isPaid) {
            // Auto-cancel order
            try {
              const { updateOrderStatus } = await import('../repos/orders.repo.js');
              const { getTelegramChatIdFromOrder } = await import('./order-status-notifications.js');
              await updateOrderStatus(order.id, 'cancelled');
              
              console.log(`🚫 [DAILY_REMINDERS] Auto-cancelled order ${order.id} (not paid by H-3)`);
              
              // Notify customer via sendMessage function (passed as parameter)
              try {
                const customerChatId = await getTelegramChatIdFromOrder(order.id);
                if (customerChatId) {
                  await sendMessage(
                    customerChatId,
                    `❌ **Pesanan Dibatalkan**\n\n` +
                    `Order ID: \`${order.id}\`\n` +
                    `Alasan: Pembayaran tidak diterima hingga H-3\n\n` +
                    `Jika Anda ingin memesan ulang, silakan gunakan perintah /pesan.`
                  );
                }
              } catch (notifyError) {
                console.warn(`⚠️ [DAILY_REMINDERS] Could not notify customer of cancellation:`, notifyError.message);
              }
              
              // Skip reminder sending for cancelled orders
              skippedCount++;
              continue;
            } catch (cancelError) {
              console.error(`❌ [DAILY_REMINDERS] Error auto-cancelling order ${order.id}:`, cancelError);
              // Continue with reminder even if cancellation fails
            }
          }
        }
        
        if (!reminderType) {
          continue; // Skip if no reminder type determined
        }
        
        // Skip cancelled/completed orders
        const orderStatus = (order.status || '').toLowerCase();
        if (orderStatus === ORDER_STATUS.CANCELLED || orderStatus === ORDER_STATUS.COMPLETED) {
          console.log(`⏭️ [DAILY_REMINDERS] Skipping ${order.id} ${reminderType} (status: ${orderStatus})`);
          skippedCount++;
          continue;
        }
        
        // ANTI-SPAM CHECK: If invoice has ANY SENT reminder, skip ALL future reminders
        if (sentInvoiceSet.has(order.id)) {

          console.log(`⏭️ [DAILY_REMINDERS] Skipping ${order.id} ${reminderType} (invoice already has SENT reminder - anti-spam lock)`);
          continue; // Skip without writing to Reminders sheet (quota-friendly)
        }
        
        // Build idempotency key
        const key = `${order.id}|${reminderType}|${today}`;
        
        // Check if already processed today
        if (sentKeys.has(key)) {
          console.log(`⏭️ [DAILY_REMINDERS] Skipping ${order.id} ${reminderType} (already processed today)`);
          continue;
        }
        
        // Special handling for H4_PAYMENT: skip if FULL PAID
        if (reminderType === 'H4_PAYMENT') {
          const paymentStatus = (order.payment_status || 'UNPAID').toUpperCase();
          if (paymentStatus === 'FULL PAID' || paymentStatus === 'FULLPAID' || paymentStatus === 'PAID') {
            console.log(`⏭️ [DAILY_REMINDERS] Skipping ${order.id} ${reminderType} (payment_status: ${paymentStatus})`);
            
            // Append SKIPPED log row
            await saveReminder({
              orderId: order.id,
              reminderType: reminderType,
              reminderDate: today,
              status: 'SKIPPED',
              attempts: 0,
              notes: 'Skipped because FULL PAID',
            });
            
            sentKeys.add(key); // Mark as processed
            skippedCount++;
            continue;
          }
        }
        
        // Render message by template
        const message = getReminderMessage(order, reminderType);
        
        // ALL reminder types go to ALL active admins (from Users sheet)
        // Send to all admins and get result summary
        const sendResult = await sendReminderToAdmins(message, sendMessage);
        
        if (sendResult.success) {
          // At least one admin received the message
          const notes = sendResult.failCount > 0
            ? `Sent to ${sendResult.successCount} admin(s), failed ${sendResult.failCount}`
            : `Sent to ${sendResult.successCount} admin(s)`;
          
          // Create Google Calendar event for this reminder
          try {
            const { createReminderCalendarEvent } = await import('./google-calendar.js');
            const calendarEventId = await createReminderCalendarEvent(order, reminderType);
            if (calendarEventId) {
              console.log(`✅ [DAILY_REMINDERS] Calendar event created for reminder ${order.id} (${reminderType}): ${calendarEventId}`);
            }
          } catch (calendarError) {
            // Log error but don't fail the reminder sending
            console.error(`⚠️ [DAILY_REMINDERS] Failed to create calendar event for reminder ${order.id}:`, calendarError.message);
          }
          
          // Append ONE SENT log row (not per admin)
          await saveReminder({
            orderId: order.id,
            reminderType: reminderType,
            reminderDate: today,
            status: 'SENT',
            sentAt: new Date().toISOString(),
            attempts: 1,
            lastAttemptAt: new Date().toISOString(),
            notes: notes,
          });
          
          sentKeys.add(key); // Mark as processed
          sentCount++;
        } else {
          // No admins found or all sends failed
          const errorMessage = sendResult.errorMessage || 'Unknown error';
          
          // Append ONE FAILED log row with specific error message
          await saveReminder({
            orderId: order.id,
            reminderType: reminderType,
            reminderDate: today,
            status: 'FAILED',
            attempts: 1,
            lastAttemptAt: new Date().toISOString(),
            notes: errorMessage.substring(0, 200), // Truncate if too long
          });
          
          failedCount++;
        }
      } catch (error) {
        console.error(`❌ [DAILY_REMINDERS] Error processing order ${order.id}:`, error);
        failedCount++;
      }
    }

  } catch (error) {
    console.error('❌ [DAILY_REMINDERS] Fatal error in daily job:', error);
    console.error('❌ [DAILY_REMINDERS] Stack:', error.stack);
  }
}

/**
 * Get ALL reminders from Reminders sheet (for anti-spam check)
 * Reads entire Reminders sheet once
 * @returns {Promise<Array>} Array of all reminder objects
 */
async function getAllReminders() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    const { retryWithBackoff } = await import('./src/repos/sheets.client.js');
    
    await ensureRemindersSheet();
    
    const { getSheetHeaderMap } = await import('../utils/sheets-helpers.js');
    const headerMap = await getSheetHeaderMap(REMINDERS_SHEET, { requireSnakeCase: false });
    
    // Read ALL reminders (read entire sheet)
    const response = await retryWithBackoff(async () => {
      return await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${REMINDERS_SHEET}!A:${String.fromCharCode(65 + headerMap.__headersLength - 1)}`,
      });
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return [];
    }

    const getValue = (row, internalKey, defaultValue = '') => {
      const colIndex = headerMap[internalKey];
      if (colIndex === undefined) return defaultValue;
      return row[colIndex] !== undefined && row[colIndex] !== '' ? row[colIndex] : defaultValue;
    };

    return rows.slice(1).map(row => ({
      id: getValue(row, 'reminder_id'),
      orderId: getValue(row, 'order_id'),
      reminderType: getValue(row, 'reminder_type'),
      reminderDate: getValue(row, 'reminder_date'),
      status: getValue(row, 'status', 'pending'),
      sentAt: getValue(row, 'sent_at'),
      attempts: parseInt(getValue(row, 'attempts', '0')) || 0,
      lastAttemptAt: getValue(row, 'last_attempt_at'),
      createdAt: getValue(row, 'created_at'),
      notes: getValue(row, 'notes'),
    }));
  } catch (error) {
    console.error('❌ [GET_ALL_REMINDERS] Error getting all reminders:', error.message);
    return [];
  }
}

/**
 * Get reminders for a date range (for idempotency check)
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of reminder objects
 */
async function getRemindersForDateRange(startDate, endDate) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    const { retryWithBackoff } = await import('./src/repos/sheets.client.js');
    
    await ensureRemindersSheet();
    
    const { getSheetHeaderMap } = await import('../utils/sheets-helpers.js');
    const headerMap = await getSheetHeaderMap(REMINDERS_SHEET, { requireSnakeCase: false });
    
    // Read reminders with retry/backoff
    const response = await retryWithBackoff(async () => {
      return await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${REMINDERS_SHEET}!A:${String.fromCharCode(65 + headerMap.__headersLength - 1)}`,
      });
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return [];
    }

    const getValue = (row, internalKey, defaultValue = '') => {
      const colIndex = headerMap[internalKey];
      if (colIndex === undefined) return defaultValue;
      return row[colIndex] !== undefined && row[colIndex] !== '' ? row[colIndex] : defaultValue;
    };

    return rows.slice(1).map(row => ({
      id: getValue(row, 'reminder_id'),
      orderId: getValue(row, 'order_id'),
      reminderType: getValue(row, 'reminder_type'),
      reminderDate: getValue(row, 'reminder_date'),
      status: getValue(row, 'status', 'pending'),
      sentAt: getValue(row, 'sent_at'),
      attempts: parseInt(getValue(row, 'attempts', '0')) || 0,
      lastAttemptAt: getValue(row, 'last_attempt_at'),
      createdAt: getValue(row, 'created_at'),
      notes: getValue(row, 'notes'),
    })).filter(r => {
      // Filter by date range
      if (r.reminderDate < startDate || r.reminderDate > endDate) {
        return false;
      }
      return true;
    });
  } catch (error) {
    console.error('❌ [GET_REMINDERS_RANGE] Error getting reminders:', error.message);
    return [];
  }
}

/**
 * Check and send reminders for today (DEPRECATED - use runDailyRemindersJob instead)
 * @deprecated Use runDailyRemindersJob() for quota-friendly reminder processing
 */
export async function checkAndSendRemindersForToday(sendMessage) {
  console.warn('⚠️ [DEPRECATED] checkAndSendRemindersForToday is deprecated. Use runDailyRemindersJob() instead.');
  return runDailyRemindersJob(sendMessage);
}
