/**
 * Reminder System
 * Handles H-4, H-3, H-1 reminders for orders based on event date
 * Implements PRD reminder requirements
 */

import { getAllOrders, getOrderById } from './google-sheets.js';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

// Google Sheets API setup
let auth;
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  auth = new google.auth.GoogleAuth({
    credentials: serviceAccountKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
} else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
  auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
} else {
  throw new Error('Either GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY_FILE must be set');
}

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

const REMINDERS_SHEET = 'Reminders';

/**
 * Ensure Reminders sheet exists with correct headers
 */
export async function ensureRemindersSheet() {
  try {
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
      
      console.log('✅ Reminders sheet created');
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
    // Import header mapping functions
    const { getSheetHeaderMap } = await import('./google-sheets.js');
    
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
        console.log(`✅ [REMINDER_EXISTS] Found existing reminder for Order ${orderId}, Type ${reminderType}`);
        return true;
      }
    }

    console.log(`⚠️ [REMINDER_EXISTS] No existing reminder found for Order ${orderId}, Type ${reminderType}`);
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
    console.log(`🔍 [SAVE_REMINDER] Saving reminder - Order ID: ${reminderData.orderId}, Type: ${reminderData.reminderType}, Date: ${reminderData.reminderDate}`);
    
    await ensureRemindersSheet();
    
    // Check for duplicate reminder (same Order ID + Reminder Type)
    const exists = await reminderExists(reminderData.orderId, reminderData.reminderType);
    if (exists) {
      console.log(`⚠️ [SAVE_REMINDER] Reminder already exists for Order ${reminderData.orderId}, Type ${reminderData.reminderType}, skipping duplicate write`);
      return `${reminderData.orderId}_${reminderData.reminderType}_existing`;
    }
    
    const reminderId = reminderData.id || `${reminderData.orderId}_${reminderData.reminderType}_${Date.now()}`;
    
    // Import header mapping functions from google-sheets.js
    const { getSheetHeaderMap, buildRowFromMap, validateRequiredKeys } = await import('./google-sheets.js');
    
    // Get header map using alias-based mapping (Reminders doesn't need snake_case enforcement)
    const headerMap = await getSheetHeaderMap(REMINDERS_SHEET, { requireSnakeCase: false });
    
    // Validate required columns exist
    const requiredKeys = ['reminder_id', 'order_id', 'reminder_type', 'reminder_date', 'status'];
    validateRequiredKeys(headerMap, requiredKeys, REMINDERS_SHEET);
    
    // Normalize reminder_date to YYYY-MM-DD format before saving
    let normalizedReminderDate = reminderData.reminderDate || '';
    if (normalizedReminderDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedReminderDate)) {
      try {
        const { normalizeEventDate } = await import('./date-utils.js');
        normalizedReminderDate = normalizeEventDate(normalizedReminderDate);
        console.log(`🔍 [SAVE_REMINDER] Reminder date normalized: "${reminderData.reminderDate}" → "${normalizedReminderDate}"`);
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
    
    console.log(`🔍 [SAVE_REMINDER] Reminder row payload:`, row);

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
    
    console.log(`✅ [SAVE_REMINDER] Successfully saved reminder ${reminderId} to Reminders sheet`);
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
    await ensureRemindersSheet();
    
    // Import header mapping functions
    const { getSheetHeaderMap } = await import('./google-sheets.js');
    
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
    })).filter(r => r.reminderDate === targetDate && r.status === 'pending');
  } catch (error) {
    console.error('❌ [GET_REMINDERS] Error getting reminders:', error.message);
    console.error(`❌ [GET_REMINDERS] Stack:`, error.stack);
    return [];
  }
}

/**
 * Mark reminder as sent
 */
export async function markReminderSent(reminderId) {
  try {
    const { getSheetHeaderMap } = await import('./google-sheets.js');
    
    // Get header map using alias-based mapping (Reminders doesn't need snake_case enforcement)
    const headerMap = await getSheetHeaderMap(REMINDERS_SHEET, { requireSnakeCase: false });
    const reminderIdColIndex = headerMap.reminder_id;
    
    if (reminderIdColIndex === undefined) {
      console.error(`❌ [MARK_REMINDER_SENT] Column "reminder_id" not found in ${REMINDERS_SHEET} sheet`);
      return false;
    }
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${REMINDERS_SHEET}!A:${String.fromCharCode(65 + headerMap.__headersLength - 1)}`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      console.log(`⚠️ [MARK_REMINDER_SENT] No data rows in ${REMINDERS_SHEET} (only headers)`);
      return false;
    }

    // Find row with matching reminder ID using header mapping
    let rowIndex = -1;
    let reminderRow = null;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][reminderIdColIndex] === reminderId) {
        rowIndex = i + 1; // +1 because Google Sheets is 1-indexed
        reminderRow = rows[i];
        break;
      }
    }

    if (rowIndex === -1) {
      console.log(`⚠️ [MARK_REMINDER_SENT] Reminder ${reminderId} not found`);
      return false;
    }

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
    updateColumn('status', 'sent');
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
    
    console.log(`✅ [MARK_REMINDER_SENT] Reminder ${reminderId} marked as sent`);
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
    console.log(`⚠️ [PARSE_EVENT_DATE] Invalid input: ${input}`);
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
        console.log(`⚠️ [PARSE_EVENT_DATE] Invalid date parts - day: ${day}, month: ${month}, year: ${year}`);
        return null;
      }
      
      // Construct Date using local time (year, monthIndex, day)
      const date = new Date(year, month, day);
      
      // Normalize to start of day (00:00)
      date.setHours(0, 0, 0, 0);
      
      // Validate date
      if (isNaN(date.getTime())) {
        console.log(`⚠️ [PARSE_EVENT_DATE] Invalid date object created from: ${input}`);
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
        console.log(`⚠️ [PARSE_EVENT_DATE] Failed to parse: ${input}`);
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
    console.log('⚠️ [CALC_REMINDER_DATES] No event date provided');
    return null;
  }
  
  console.log(`🔍 [CALC_REMINDER_DATES] Calculating reminders for event date: ${eventDate}`);
  
  try {
    let date;
    
    // If already in YYYY-MM-DD format, parse directly
    if (/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      date = new Date(eventDate + 'T00:00:00');
      if (isNaN(date.getTime())) {
        console.log(`❌ [CALC_REMINDER_DATES] Invalid YYYY-MM-DD date: ${eventDate}`);
        return null;
      }
    } else {
      // Legacy format - use parser (defensive)
      date = parseEventDate(eventDate);
      if (!date) {
        console.log(`❌ [CALC_REMINDER_DATES] Failed to parse event date: ${eventDate}`);
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
    
    console.log(`✅ [CALC_REMINDER_DATES] Calculated reminder dates:`, reminderDates);
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
 * Includes comprehensive logging and error handling
 */
export async function createOrderReminders(orderId, eventDate, orderData = null) {
  console.log(`🔍 [CREATE_REMINDERS] Starting reminder creation - Order ID: ${orderId}, Event Date: ${eventDate}`);
  
  try {
    // Normalize event_date to YYYY-MM-DD format if needed (defensive)
    let normalizedEventDate = eventDate;
    if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      try {
        const { normalizeEventDate } = await import('./date-utils.js');
        normalizedEventDate = normalizeEventDate(eventDate);
        console.log(`🔍 [CREATE_REMINDERS] Event date normalized: "${eventDate}" → "${normalizedEventDate}"`);
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
      console.log(`⚠️ [CREATE_REMINDERS] No reminder dates calculated for order ${orderId}`);
      return [];
    }

    console.log(`✅ [CREATE_REMINDERS] Reminder dates calculated:`, reminderDates);

    // Get order data if not provided (for additional info like delivery time)
    let order = orderData;
    if (!order) {
      try {
        const { getOrderById } = await import('./google-sheets.js');
        order = await getOrderById(orderId);
        if (order) {
          console.log(`✅ [CREATE_REMINDERS] Retrieved order data for ${orderId}`);
        } else {
          console.log(`⚠️ [CREATE_REMINDERS] Order ${orderId} not found, proceeding with basic reminder data`);
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
        console.log(`🔍 [CREATE_REMINDERS] Delivery time normalized: ${order.delivery_time} → ${deliveryTime}`);
      } catch (error) {
        console.warn(`⚠️ [CREATE_REMINDERS] Failed to normalize delivery_time "${order.delivery_time}":`, error.message);
        // Use original value if normalization fails
        deliveryTime = order.delivery_time;
      }
    }

    const reminders = [];
    for (const [type, date] of Object.entries(reminderDates)) {
      try {
        console.log(`🔍 [CREATE_REMINDERS] Creating reminder: ${type} for date ${date}`);
        
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
 * Get reminder message based on type
 */
function getReminderMessage(order, reminderType) {
  const orderId = order.id || 'N/A';
  const customerName = order.customer_name || 'N/A';
  const eventDate = order.event_date || 'N/A';
  // Use total_amount (canonical) with fallback to final_total (legacy)
  const totalAmount = order.total_amount || order.final_total || 0;
  const paidAmount = order.paid_amount || 0;
  const paymentStatus = order.payment_status || 'UNPAID';
  const remainingBalance = totalAmount - paidAmount;

  let message = '';
  
  switch (reminderType) {
    case 'H-4':
      message = `🔔 **REMINDER H-4: PENGINGAT PEMBAYARAN**\n\n`;
      message += `📋 Order ID: ${orderId}\n`;
      message += `👤 Customer: ${customerName}\n`;
      message += `📅 Event Date: ${eventDate}\n\n`;
      if (paymentStatus !== 'FULL PAID') {
        message += `💰 **Status Pembayaran:**\n`;
        message += `Total: Rp ${formatRupiah(totalAmount)}\n`;
        message += `Dibayar: Rp ${formatRupiah(paidAmount)}\n`;
        message += `Sisa: Rp ${formatRupiah(remainingBalance)}\n\n`;
        message += `⚠️ Mohon ingatkan customer untuk melakukan pembayaran!`;
      } else {
        message += `✅ Pembayaran sudah lunas.`;
      }
      break;
      
    case 'H-3':
      message = `🔔 **REMINDER H-3: PESANAN BAHAN BAKU**\n\n`;
      message += `📋 Order ID: ${orderId}\n`;
      message += `👤 Customer: ${customerName}\n`;
      message += `📅 Event Date: ${eventDate}\n\n`;
      message += `⚠️ **Action Required:**\n`;
      message += `Silakan pesan bahan baku untuk order ini!`;
      break;
      
    case 'H-1':
      message = `🔔 **REMINDER H-1: PERSIAPAN OUTLET**\n\n`;
      message += `📋 Order ID: ${orderId}\n`;
      message += `👤 Customer: ${customerName}\n`;
      message += `📅 Event Date: ${eventDate}\n`;
      message += `🕐 Delivery Time: ${order.delivery_time || 'TBD'}\n\n`;
      message += `⚠️ **Action Required:**\n`;
      message += `Silakan persiapkan outlet untuk order ini!`;
      break;
      
    default:
      message = `🔔 **REMINDER**\n\nOrder ID: ${orderId}`;
  }

  return message;
}

/**
 * Format Rupiah currency
 */
function formatRupiah(amount) {
  return new Intl.NumberFormat('id-ID').format(amount);
}

/**
 * Send reminder to admin
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function sendReminderToAdmin(order, reminderType, sendMessage) {
  try {
    const adminIds = process.env.ADMIN_TELEGRAM_USER_IDS 
      ? process.env.ADMIN_TELEGRAM_USER_IDS.split(',').map(id => parseInt(id.trim()))
      : [];
    
    if (adminIds.length === 0) {
      console.log('⚠️ No admin Telegram IDs configured. Reminder logged only.');
      return false;
    }

    const message = getReminderMessage(order, reminderType);
    
    // Send to all admins
    for (const adminId of adminIds) {
      try {
        await sendMessage(adminId, message);
        console.log(`✅ Reminder sent to admin ${adminId}`);
      } catch (error) {
        console.error(`❌ Error sending reminder to admin ${adminId}:`, error);
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error sending reminder to admin:', error);
    return false;
  }
}

/**
 * Check and send reminders for today
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function checkAndSendRemindersForToday(sendMessage) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const reminders = await getRemindersForDate(today);
    
    if (reminders.length === 0) {
      console.log('✅ No reminders scheduled for today');
      return;
    }
    
    console.log(`📬 Found ${reminders.length} reminder(s) for today`);
    
    for (const reminder of reminders) {
      try {
        const order = await getOrderById(reminder.orderId);
        
        if (!order) {
          console.log(`⚠️ Order ${reminder.orderId} not found, skipping reminder`);
          continue;
        }
        
        // Check cooldown (min 6 hours between reminders of same type)
        if (reminder.lastAttemptAt) {
          const lastAttempt = new Date(reminder.lastAttemptAt);
          const now = new Date();
          const hoursSinceLastAttempt = (now - lastAttempt) / (1000 * 60 * 60);
          
          if (hoursSinceLastAttempt < 6) {
            console.log(`⏸️ Reminder ${reminder.id} skipped (cooldown: ${Math.round(hoursSinceLastAttempt)}h)`);
            continue;
          }
        }
        
        // Send reminder
        const sent = await sendReminderToAdmin(order, reminder.reminderType, sendMessage);
        
        if (sent) {
          await markReminderSent(reminder.id);
          console.log(`✅ Reminder ${reminder.id} sent successfully`);
        } else {
          // Mark as failed but don't increment attempts too much
          console.log(`⚠️ Reminder ${reminder.id} failed to send`);
        }
      } catch (error) {
        console.error(`❌ Error processing reminder ${reminder.id}:`, error);
      }
    }
  } catch (error) {
    console.error('❌ Error checking reminders:', error);
  }
}
