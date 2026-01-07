/**
 * Reminder System
 * Handles H-4, H-3, H-1 reminders for orders based on event date
 * Implements PRD reminder requirements
 */

import { getAllOrders, getOrderById, getAdminChatIds } from './google-sheets.js';
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
      
    }
  } catch (error) {
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
      return false; // Assume doesn't exist if columns not found
    }
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${REMINDERS_SHEET}!A:${String.fromCharCode(65 + headerMap.__headersLength - 1)}`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
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
    if (error.stack) {
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
    
    await ensureRemindersSheet();
    
    // Check for duplicate reminder (same Order ID + Reminder Type)
    const exists = await reminderExists(reminderData.orderId, reminderData.reminderType);
    if (exists) {
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
      } catch (error) {
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
      return false;
    }
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${REMINDERS_SHEET}!A:${String.fromCharCode(65 + headerMap.__headersLength - 1)}`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
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
    
    return true;
  } catch (error) {
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
        return null;
      }
      
      return date;
    } else {
      // Try standard Date parsing as fallback
      const date = new Date(input);
      if (isNaN(date.getTime())) {
        return null;
      }
      date.setHours(0, 0, 0, 0);
      return date;
    }
  } catch (error) {
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
    
    
    // Check if event date is in the future
    if (date <= today) {
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
    return null;
  }
}

// Use shared normalizeDeliveryTime from price-calculator for consistency

/**
 * Create reminders for an order (H-4, H-3, H-1)
 * Includes comprehensive logging and error handling
 */
export async function createOrderReminders(orderId, eventDate, orderData = null) {
  
  try {
    // Normalize event_date to YYYY-MM-DD format if needed (defensive)
    let normalizedEventDate = eventDate;
    if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      try {
        const { normalizeEventDate } = await import('./date-utils.js');
        normalizedEventDate = normalizeEventDate(eventDate);
      } catch (error) {
        return [];
      }
    }
    
    // Normalize today for comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Calculate reminder dates (expects YYYY-MM-DD format)
    const reminderDates = calculateReminderDates(normalizedEventDate);
    if (!reminderDates) {
      return [];
    }


    // Get order data if not provided (for additional info like delivery time)
    let order = orderData;
    if (!order) {
      try {
        const { getOrderById } = await import('./google-sheets.js');
        order = await getOrderById(orderId);
        if (order) {
        } else {
        }
      } catch (error) {
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
        
      } catch (error) {
        // Continue with other reminders even if one fails
      }
    }

    return reminders;
  } catch (error) {
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
      return false;
    }

    const message = getReminderMessage(order, reminderType);
    
    // Send to all admins
    for (const adminId of adminIds) {
      try {
        await sendMessage(adminId, message);
      } catch (error) {
      }
    }
    
    return true;
  } catch (error) {
    return false;
  }
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
    const { getTodayJakarta, getDaysDiffJakarta } = await import('./date-utils.js');
    const { getAllOrders } = await import('./google-sheets.js');
    const { formatPrice } = await import('./price-calculator.js');
    
    // Get today's date in Asia/Jakarta
    const today = todayOverride ? getTodayJakarta(todayOverride) : getTodayJakarta();
    console.log(`🔄 [DAILY_REMINDERS] Starting daily job for ${today}`);
    
    // STEP 1: Read Orders ONCE (minimal reads)
    console.log(`📖 [DAILY_REMINDERS] Reading Orders sheet (once)...`);
    const allOrders = await getAllOrders(1000); // Read up to 1000 orders
    
    // Import normalizeEventDate for date normalization
    const { normalizeEventDate } = await import('./date-utils.js');
    
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
      console.log(`✅ [DAILY_REMINDERS] No reminders due today`);
      return;
    }
    
    // STEP 2: Read Reminders ONCE (anti-spam + idempotency sets)
    console.log(`📖 [DAILY_REMINDERS] Reading Reminders sheet (once) for anti-spam and idempotency...`);
    
    // Read ALL reminders (not just today's) to build global per-invoice lock
    const allReminders = await getAllReminders(); // Read all reminders
    
    // Build anti-spam set: invoices that have ANY SENT reminder (global lock)
    const sentInvoiceSet = new Set();
    for (const reminder of allReminders) {
      if (reminder.status === 'SENT' && reminder.orderId) {
        sentInvoiceSet.add(reminder.orderId);
      }
    }
    
    console.log(`✅ [DAILY_REMINDERS] Found ${sentInvoiceSet.size} invoice(s) with SENT reminders (anti-spam lock)`);
    
    // Build idempotency set for today: key = `${order_id}|${reminder_type}|${reminder_date}`
    const sentKeys = new Set();
    const todayReminders = allReminders.filter(r => r.reminderDate === today);
    for (const reminder of todayReminders) {
      if (reminder.status === 'SENT' || reminder.status === 'SKIPPED' || reminder.status === 'FAILED') {
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
        
        if (!reminderType) {
          continue; // Skip if no reminder type determined
        }
        
        // ANTI-SPAM CHECK: If invoice has ANY SENT reminder, skip ALL future reminders
        if (sentInvoiceSet.has(order.id)) {
          console.log(`[REMINDER_SKIP] invoice=${order.id} reason="already_sent_once"`);
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
    
    console.log(`✅ [DAILY_REMINDERS] Job completed: ${sentCount} sent, ${skippedCount} skipped, ${failedCount} failed`);
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
    await ensureRemindersSheet();
    
    const { getSheetHeaderMap } = await import('./google-sheets.js');
    const headerMap = await getSheetHeaderMap(REMINDERS_SHEET, { requireSnakeCase: false });
    
    // Retry wrapper for 429 errors (reuse from google-sheets.js pattern)
    const retryWithBackoff = async (fn, maxAttempts = 5) => {
      let attempt = 0;
      const baseDelay = 500;
      
      while (attempt < maxAttempts) {
        try {
          return await fn();
        } catch (error) {
          attempt++;
          const isRateLimit = error.code === 429 || 
                             error.message?.includes('rateLimitExceeded') ||
                             error.message?.includes('429') ||
                             (error.response?.status === 429);
          
          if (!isRateLimit || attempt >= maxAttempts) {
            if (isRateLimit && attempt >= maxAttempts) {
              const userError = new Error('⚠️ Sistem sedang kena limit Google Sheets (429). Coba lagi 1–2 menit ya.');
              userError.isRateLimit = true;
              throw userError;
            }
            throw error;
          }
          
          const delay = baseDelay * Math.pow(2, attempt - 1);
          const jitter = Math.random() * 250;
          const retryAfter = error.response?.headers?.['retry-after'];
          const finalDelay = retryAfter ? parseInt(retryAfter) * 1000 : delay + jitter;
          
          console.warn(`⚠️ [RETRY] Rate limit (429) on attempt ${attempt}/${maxAttempts}, waiting ${Math.round(finalDelay)}ms...`);
          await new Promise(resolve => setTimeout(resolve, finalDelay));
        }
      }
    };
    
    // Read ALL reminders (read entire sheet)
    const response = await retryWithBackoff(async () => {
      return await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${REMINDERS_SHEET}!A2:ZZ`, // Start from row 2 (skip header)
      });
    });
    
    const rows = response.data.values || [];
    
    if (rows.length === 0) {
      return [];
    }
    
    // Map rows to reminder objects
    const reminders = rows.map((row, index) => {
      const getValue = (key, defaultValue = '') => {
        const colIndex = headerMap[key];
        if (colIndex === undefined) {
          return defaultValue;
        }
        return row[colIndex] !== undefined && row[colIndex] !== '' ? row[colIndex] : defaultValue;
      };
      
      return {
        id: getValue('reminder_id', `temp_${index + 2}`),
        orderId: getValue('order_id', ''),
        reminderType: getValue('reminder_type', ''),
        reminderDate: getValue('reminder_date', ''),
        status: getValue('status', ''),
        sentAt: getValue('sent_at', ''),
        attempts: parseInt(getValue('attempts', '0')) || 0,
        lastAttemptAt: getValue('last_attempt_at', ''),
        createdAt: getValue('created_at', ''),
        notes: getValue('notes', ''),
      };
    });
    
    return reminders;
  } catch (error) {
    console.error('❌ [GET_ALL_REMINDERS] Error reading reminders:', error);
    return []; // Return empty array on error (fail gracefully)
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
      return;
    }
    
    
    for (const reminder of reminders) {
      try {
        const order = await getOrderById(reminder.orderId);
        
        if (!order) {
          continue;
        }
        
        // Check cooldown (min 6 hours between reminders of same type)
        if (reminder.lastAttemptAt) {
          const lastAttempt = new Date(reminder.lastAttemptAt);
          const now = new Date();
          const hoursSinceLastAttempt = (now - lastAttempt) / (1000 * 60 * 60);
          
          if (hoursSinceLastAttempt < 6) {
            continue;
          }
        }
        
        // Send reminder
        const sent = await sendReminderToAdmin(order, reminder.reminderType, sendMessage);
        
        if (sent) {
          await markReminderSent(reminder.id);
        } else {
          // Mark as failed but don't increment attempts too much
        }
      } catch (error) {
      }
    }
  } catch (error) {
  }
}
