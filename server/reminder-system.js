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
