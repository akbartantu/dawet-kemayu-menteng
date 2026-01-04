/**
 * Google Sheets Storage
 * Stores messages and conversations in Google Spreadsheet
 */

import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

// Google Sheets API setup
// Support both file-based (local) and environment variable-based (Render) authentication
let auth;
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  // Render deployment: Read from environment variable (JSON string)
  const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  auth = new google.auth.GoogleAuth({
    credentials: serviceAccountKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
} else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
  // Local development: Read from file
  auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
} else {
  throw new Error('Either GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY_FILE must be set');
}

const sheets = google.sheets({ version: 'v4', auth });

// Spreadsheet ID from .env
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

// Validate Google Sheets configuration on module load
if (!SPREADSHEET_ID) {
}

/**
 * Normalize order ID for consistent comparison
 * Handles whitespace, zero-width characters, and formatting issues
 * @param {string} orderId - Order ID to normalize
 * @returns {string} Normalized order ID
 */
export function normalizeOrderId(orderId) {
  if (!orderId || typeof orderId !== 'string') {
    return '';
  }
  
  return orderId
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
    .replace(/\s+/g, '') // Remove all whitespace
    .toUpperCase(); // Normalize case (order IDs are case-insensitive)
}

/**
 * Convert column index to Google Sheets column letter (A, B, ..., Z, AA, AB, etc.)
 * @param {number} index - Zero-based column index (0 = A, 1 = B, etc.)
 * @returns {string} Column letter(s) (A, B, ..., Z, AA, AB, etc.)
 */
export function columnIndexToLetter(index) {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode(65 + (index % 26)) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

/**
 * Normalize column name to snake_case format
 * Standard format: lowercase, underscore-separated, no spaces
 * @param {string} columnName - Raw column name (may contain spaces, mixed case)
 * @returns {string} Normalized column name in snake_case
 */
export function normalizeColumnName(columnName) {
  if (!columnName || typeof columnName !== 'string') {
    return '';
  }
  
  let normalized = columnName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')  // Replace spaces with underscores
    .replace(/\(/g, '_')   // Replace ( with _
    .replace(/\)/g, '')    // Remove )
    .replace(/[^a-z0-9_]/g, '')  // Remove special characters (keep only letters, numbers, underscores)
    .replace(/_+/g, '_')  // Replace multiple underscores with single underscore
    .replace(/^_|_$/g, '');  // Remove leading/trailing underscores
  
  // Special handling: preserve "json" in readable format
  if (normalized.includes('json')) {
    normalized = normalized.replace(/_json/g, '_json').replace(/json_/g, 'json_');
  }
  
  return normalized;
}

/**
 * Alias dictionary: Maps internal snake_case keys to possible sheet header names
 * This allows code to use snake_case internally while working with existing sheet headers
 */
const HEADER_ALIASES = {
  order_id: ['Order ID', 'order_id', 'orderid'],
  customer_name: ['Customer Name', 'customer_name', 'customername'],
  phone_number: ['Phone Number', 'phone_number', 'phonenumber'],
  address: ['Address', 'address'],
  event_name: ['Event Name', 'event_name', 'eventname'],
  event_duration: ['Event Duration', 'event_duration', 'eventduration'],
  event_date: ['Event Date', 'event_date', 'eventdate'],
  delivery_time: ['Delivery Time', 'delivery_time', 'deliverytime'],
  items_json: ['Items (JSON)', 'Items JSON', 'items_json', 'itemsjson'],
  notes_json: ['Notes (JSON)', 'Notes JSON', 'notes_json', 'notesjson'],
  status: ['Status', 'status'],
  total_items: ['Total Items', 'total_items', 'totalitems'],
  created_at: ['Created At', 'created_at', 'createdat'],
  updated_at: ['Updated At', 'updated_at', 'updatedat'],
  conversation_id: ['Conversation ID', 'conversation_id', 'conversationid'],
  // Pricing/payment fields: SNAKE_CASE ONLY (no Title Case fallback)
  product_total: ['product_total', 'producttotal'],
  packaging_fee: ['packaging_fee', 'packagingfee'],
  delivery_fee: ['delivery_fee', 'deliveryfee'],
  total_amount: ['total_amount', 'totalamount'],
  // Legacy support: final_total (READ fallback only, WRITE must use total_amount)
  final_total: ['final_total', 'finaltotal'],
  dp_min_amount: ['dp_min_amount', 'dpminamount'],
  paid_amount: ['paid_amount', 'paidamount'],
  payment_status: ['payment_status', 'paymentstatus'],
  remaining_balance: ['remaining_balance', 'remainingbalance'],
  // Reminders sheet fields
  reminder_date: ['Reminder Date', 'reminder_date', 'reminderdate'],
  reminder_type: ['Reminder Type', 'reminder_type', 'remindertype'],
  reminder_sent: ['Reminder Sent', 'reminder_sent', 'remindersent'],
  // WaitingList fields
  calendar_event_id: ['Calendar Event ID', 'calendar_event_id', 'calendareventid'],
  // Reminder ID (for Reminders sheet)
  reminder_id: ['Reminder ID', 'reminder_id', 'reminderid'],
  sent_at: ['Sent At', 'sent_at', 'sentat'],
  attempts: ['Attempts', 'attempts'],
  last_attempt_at: ['Last Attempt At', 'last_attempt_at', 'lastattemptat'],
  notes: ['Notes', 'notes'],
};

/**
 * Required snake_case columns for pricing/payment fields (MUST exist, no fallback)
 * These fields are the single source of truth and must NOT use Title Case columns
 */
const REQUIRED_SNAKE_CASE_COLUMNS = [
  'product_total',
  'packaging_fee',
  'delivery_fee',
  'total_amount', // Canonical column name (replaces final_total)
  'dp_min_amount',
  'paid_amount',
  'payment_status',
  'remaining_balance',
];

/**
 * Check if a column name is a Title Case pricing/payment column (legacy, should be ignored)
 * @param {string} columnName - Column name to check
 * @returns {boolean} True if it's a legacy Title Case pricing/payment column
 */
function isLegacyTitleCaseColumn(columnName) {
  const legacyColumns = [
    'Product Total',
    'Packaging Fee',
    'Delivery Fee',
    'Final Total',
    'DP Min Amount',
    'Paid Amount',
    'Payment Status',
    'Remaining Balance',
  ];
  return legacyColumns.includes(columnName);
}

/**
 * Get sheet header map with alias support
 * Enforces snake_case-only for pricing/payment fields
 * Reads row 1 of the sheet and maps internal snake_case keys to column indices
 * @param {string} sheetName - Name of the sheet
 * @param {Object} options - Options: { requireSnakeCase: boolean, sheetType: 'Orders' | 'WaitingList' | 'Reminders' }
 * @returns {Object} Map of { internal_key: columnIndex, __headersLength: number }
 * @throws {Error} If required snake_case columns are missing
 */
export async function getSheetHeaderMap(sheetName, options = {}) {
  try {
    const { requireSnakeCase = true, sheetType = null } = options;
    
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!1:1`,
    });
    
    const headers = headerResponse.data.values?.[0] || [];
    const headerTextMap = {}; // headerText -> index
    const legacyColumns = []; // Track legacy Title Case columns
    
    // Build lookup: header text -> column index
    headers.forEach((header, index) => {
      if (header && typeof header === 'string') {
        const trimmed = header.trim();
        headerTextMap[trimmed] = index;
        
        // Track legacy Title Case columns
        if (isLegacyTitleCaseColumn(trimmed)) {
          legacyColumns.push({ name: trimmed, index, letter: columnIndexToLetter(index) });
        }
      }
    });
    
    // Log legacy columns if found
    if (legacyColumns.length > 0) {
        legacyColumns.map(c => `${c.letter}: "${c.name}"`).join(', '));
    }
    
    // Map internal keys to column indices using aliases
    const headerMap = {};
    const missingKeys = [];
    const missingSnakeCaseKeys = []; // Track missing snake_case columns specifically
    
    for (const [internalKey, aliases] of Object.entries(HEADER_ALIASES)) {
      let found = false;
      let foundColumnName = null;
      
      for (const alias of aliases) {
        if (headerTextMap[alias] !== undefined) {
          // Check if this is a legacy Title Case column for pricing/payment fields
          if (isLegacyTitleCaseColumn(alias)) {
            // This should never happen now since we removed Title Case from aliases,
            // but add a safety check
            throw new Error(`Cannot use legacy Title Case column "${alias}" for ${internalKey}. Use snake_case column instead.`);
          }
          
          headerMap[internalKey] = headerTextMap[alias];
          foundColumnName = alias;
          found = true;
          break;
        }
      }
      
      if (!found) {
        missingKeys.push(internalKey);
        
        // Check if this is a required snake_case column
        if (REQUIRED_SNAKE_CASE_COLUMNS.includes(internalKey)) {
          missingSnakeCaseKeys.push(internalKey);
        }
      } else {
        // Log successful mapping for pricing/payment fields
        if (REQUIRED_SNAKE_CASE_COLUMNS.includes(internalKey)) {
        }
      }
    }
    
    // Log detected headers
    
    // Enforce snake_case requirement for pricing/payment fields
    if (requireSnakeCase && missingSnakeCaseKeys.length > 0) {
      const errorMsg = `Missing required snake_case columns in ${sheetName}: ${missingSnakeCaseKeys.join(', ')}. ` +
        `These columns are mandatory and must use snake_case format (e.g., "product_total", not "Product Total"). ` +
        `Available headers: ${Object.keys(headerTextMap).join(', ')}`;
      throw new Error(errorMsg);
    }
    
    if (missingKeys.length > 0 && missingSnakeCaseKeys.length === 0) {
      // Only warn about non-critical missing keys
    }
    
    // Log schema enforcement message once per sheet
    if (requireSnakeCase && sheetType === 'Orders') {
    }
    
    return {
      ...headerMap,
      __headersLength: headers.length,
      __rawHeaders: headers,
      __headerTextMap: headerTextMap,
      __legacyColumns: legacyColumns,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Build row array from data object using header map
 * @param {Object} headerMap - Header map from getSheetHeaderMap()
 * @param {Object} dataObject - Data object with snake_case keys
 * @returns {Array} Row array aligned to sheet length
 */
export function buildRowFromMap(headerMap, dataObject) {
  const headersLength = headerMap.__headersLength || 0;
  const row = new Array(headersLength).fill('');
  
  // Map each internal key to its column position
  for (const [internalKey, columnIndex] of Object.entries(headerMap)) {
    if (internalKey.startsWith('__')) continue; // Skip metadata keys
    
    const value = dataObject[internalKey];
    if (value !== undefined && value !== null) {
      row[columnIndex] = value;
    }
  }
  
  return row;
}

/**
 * Validate required keys exist in header map
 * @param {Object} headerMap - Header map from getSheetHeaderMap()
 * @param {Array<string>} requiredKeys - Array of required internal keys
 * @param {string} sheetName - Sheet name for error message
 * @throws {Error} If any required key is missing
 */
export function validateRequiredKeys(headerMap, requiredKeys, sheetName) {
  const missingKeys = requiredKeys.filter(key => headerMap[key] === undefined);
  
  if (missingKeys.length > 0) {
    const availableHeaders = headerMap.__rawHeaders || [];
    throw new Error(
      `Missing required columns in ${sheetName} sheet: ${missingKeys.join(', ')}\n` +
      `Available headers: ${availableHeaders.join(', ')}`
    );
  }
}

// Sheet names
const MESSAGES_SHEET = 'Messages';
const CONVERSATIONS_SHEET = 'Conversations';
const PRICE_LIST_SHEET = 'PriceList';
const WAITING_LIST_SHEET = 'WaitingList';
const USERS_SHEET = 'Users';

// Conversations sheet schema - ENFORCED COLUMN ORDER (MANDATORY)
// This schema prevents column drifting and ensures consistent data placement
// Column A: conversation_id
// Column B: external_user_id
// Column C: platform_reference
// Column D: customer_name
// Column E: status
// Column F: first_seen_at
// Column G: last_message_at
const CONVERSATIONS_SCHEMA = [
  'conversation_id',
  'external_user_id',
  'platform_reference',
  'customer_name',
  'status',
  'first_seen_at',
  'last_message_at'
];

// Allowed platform reference values (validation)
const ALLOWED_PLATFORMS = ['telegram', 'whatsapp'];

// Messages sheet schema - ENFORCED COLUMN ORDER (MANDATORY)
// This schema prevents column drifting and ensures consistent data placement
// Column A: message_id
// Column B: conversation_id
// Column C: external_user_id
// Column D: platform
// Column E: direction
// Column F: message_text
// Column G: status
// Column H: created_at
const MESSAGES_SCHEMA = [
  'message_id',
  'conversation_id',
  'external_user_id',
  'platform',
  'direction',
  'message_text',
  'status',
  'created_at'
];

// Users sheet schema - REQUIRED COLUMNS (in logical order)
// Column A: user_id
// Column B: platform
// Column C: display_name
// Column D: role
// Column E: is_active
// Column F: created_at
// Column G: updated_at
const USERS_SCHEMA = [
  'user_id',
  'platform',
  'display_name',
  'role',
  'is_active',
  'created_at',
  'updated_at'
];

/**
 * Initialize Google Sheets (create headers if sheets don't exist)
 */
export async function initializeStorage() {
  try {
    // Validate configuration first
    if (!SPREADSHEET_ID) {
      throw new Error('GOOGLE_SPREADSHEET_ID is not set in environment variables');
    }
    
    
    // Check if spreadsheet exists and create sheets if needed
    // Add timeout wrapper to prevent hanging
    const getSpreadsheetPromise = sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Google Sheets API call timed out after 30 seconds')), 30000);
    });
    
    const spreadsheet = await Promise.race([getSpreadsheetPromise, timeoutPromise]);

    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

    // Track which sheets were just created
    let messagesSheetCreated = false;
    let conversationsSheetCreated = false;

    // Create Messages sheet if it doesn't exist
    if (!existingSheets.includes(MESSAGES_SHEET)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: MESSAGES_SHEET,
              },
            },
          }],
        },
      });
      messagesSheetCreated = true;
    }

    // Initialize Messages sheet headers (idempotent - safe to call multiple times)
    await ensureMessagesHeaders();

    // Create Conversations sheet if it doesn't exist
    if (!existingSheets.includes(CONVERSATIONS_SHEET)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: CONVERSATIONS_SHEET,
              },
            },
          }],
        },
      });
      conversationsSheetCreated = true;
    }

    // Initialize Conversations sheet headers (idempotent - safe to call multiple times)
    await ensureConversationsHeaders();

    // Initialize price list
    try {
      await initializePriceList();
    } catch (error) {
      // Don't throw - continue without price list
    }

    // Initialize waiting list
    try {
      await initializeWaitingList();
    } catch (error) {
      // Don't throw - continue without waiting list
    }

    // Initialize Users sheet
    try {
      await ensureUsersSheet();
    } catch (error) {
      // Don't throw - continue without Users sheet
    }

  } catch (error) {
    
    // Provide helpful error messages
    if (error.message.includes('timed out')) {
    } else if (error.message.includes('not set')) {
    } else if (error.message.includes('404') || error.message.includes('not found')) {
    } else if (error.message.includes('403') || error.message.includes('permission')) {
    }
    
    throw error;
  }
}

/**
 * Ensure Messages sheet has correct headers in row 1
 * This function is idempotent and safe to call multiple times
 * If headers are missing or incorrect, it will:
 * 1. Insert correct headers into row 1
 * 2. Shift existing data down by 1 row (if needed)
 * 3. Preserve all existing message data
 */
async function ensureMessagesHeaders() {
  try {
    // Check if sheet exists
    let sheetExists = false;
    try {
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${MESSAGES_SHEET}!A1:H1`,
      });
      sheetExists = true;
    } catch (error) {
      // Sheet doesn't exist yet, will be created by initializeStorage
      return;
    }

    if (!sheetExists) return;

    // Read row 1 to check headers
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MESSAGES_SHEET}!A1:H1`,
    });

    const existingHeaders = headerResponse.data.values?.[0] || [];
    
    // Check if headers match expected schema exactly
    const headersMatch = 
      existingHeaders.length === MESSAGES_SCHEMA.length &&
      existingHeaders.every((header, index) => 
        String(header).toLowerCase().trim() === MESSAGES_SCHEMA[index].toLowerCase()
      );

    if (headersMatch) {
      // Headers are correct, nothing to do
      return;
    }

    // Headers are missing or incorrect - need to fix

    // Get all existing data (if any)
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MESSAGES_SHEET}!A:H`,
    });

    const allRows = allDataResponse.data.values || [];
    const hasData = allRows.length > 0;
    const firstRowLooksLikeData = hasData && allRows.length > 0 && 
      (allRows[0].length === 0 || 
       !MESSAGES_SCHEMA.some(header => 
         String(allRows[0][0] || '').toLowerCase().includes(header.toLowerCase())
       ));

    if (hasData && firstRowLooksLikeData) {
      // Row 1 contains data (no headers) - insert new row for headers
      // This shifts all existing data down by 1 row, preserving it
      const sheetId = await getSheetId(MESSAGES_SHEET);
      if (sheetId) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: [{
              insertDimension: {
                range: {
                  sheetId: sheetId,
                  dimension: 'ROWS',
                  startIndex: 0, // Insert at row 0 (becomes row 1 after insert)
                  endIndex: 1,   // Insert 1 row
                },
              },
            }],
          },
        });
      }
    }
    // If row 1 has incorrect headers, we'll just overwrite it below

    // Write correct headers to row 1 (overwrites incorrect headers or fills new row)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MESSAGES_SHEET}!A1:H1`, // Locked range - always column A
      valueInputOption: 'RAW',
      requestBody: {
        values: [MESSAGES_SCHEMA], // Exactly 8 headers matching schema
      },
    });

  } catch (error) {
    // Don't throw - allow system to continue
  }
}

/**
 * Validate message data before writing
 * Throws error if validation fails
 */
function validateMessageData(data) {
  // Validate array length
  if (!Array.isArray(data) || data.length !== 8) {
    throw new Error(`Invalid message data: must be array of exactly 8 values, got ${data.length}`);
  }

  // Validate message_id (column A)
  if (!data[0] || String(data[0]).trim() === '') {
    throw new Error('Invalid message data: message_id is required');
  }

  // Validate conversation_id (column B)
  if (!data[1] || String(data[1]).trim() === '') {
    throw new Error('Invalid message data: conversation_id is required');
  }

  return true;
}

/**
 * Save message to Google Sheets with strict schema enforcement
 * Schema: [message_id, conversation_id, external_user_id, platform, direction, message_text, status, created_at]
 */
export async function saveMessage(messageData) {
  try {
    // Ensure headers exist before any write operation
    // This is MANDATORY to prevent column drifting
    await ensureMessagesHeaders();

    // Build row array matching EXACT schema order (8 columns, starting from A)
    // Support both camelCase and snake_case field names for backward compatibility
    const row = [
      messageData.id || '',                    // Column A: message_id
      messageData.conversation_id || messageData.conversationId || '', // Column B: conversation_id (supports both naming conventions)
      messageData.telegram_chat_id || messageData.telegramChatId || messageData.from || '', // Column C: external_user_id
      messageData.source || 'telegram',        // Column D: platform
      messageData.direction || 'inbound',       // Column E: direction
      messageData.text || '',                   // Column F: message_text
      messageData.status || 'sent',             // Column G: status
      messageData.created_at || messageData.createdAt || new Date().toISOString(), // Column H: created_at (supports both naming conventions)
    ];

    // Validate before writing - prevents bad data from being written
    validateMessageData(row);

    // Append using locked range A:H - ensures data starts from column A
    // insertDataOption: 'INSERT_ROWS' ensures new row is inserted after headers
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MESSAGES_SHEET}!A:H`, // Locked range - prevents column drift
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [row], // Exactly 8 values matching schema
      },
    });

    return messageData;
  } catch (error) {
    throw error;
  }
}

/**
 * Generate order ID in format: DKM/YYYYMMDD/000119
 */
export async function generateOrderId() {
  try {
    // Get today's date in YYYYMMDD format
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    
    // Get the next order number for today
    let orderNumber = 1;
    
    try {
      // Check if Orders sheet exists
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Orders!A:A',
      });
      
      const rows = response.data.values || [];
      if (rows.length > 1) {
        // Find orders from today
        const todayOrders = rows.slice(1).filter(row => {
          const orderId = row[0] || '';
          return orderId.startsWith(`DKM/${dateStr}/`);
        });
        
        if (todayOrders.length > 0) {
          // Get the highest order number from today
          const orderNumbers = todayOrders.map(row => {
            const orderId = row[0] || '';
            const match = orderId.match(/\/\d{6}$/);
            if (match) {
              return parseInt(match[0].substring(1));
            }
            return 0;
          });
          orderNumber = Math.max(...orderNumbers) + 1;
        }
      }
    } catch (error) {
      // Orders sheet doesn't exist yet, start from 1
      orderNumber = 1;
    }
    
    // Format order number with 6 digits
    const orderNumberStr = String(orderNumber).padStart(6, '0');
    
    return `DKM/${dateStr}/${orderNumberStr}`;
  } catch (error) {
    // Fallback to timestamp-based ID
    return `DKM/${new Date().toISOString().split('T')[0].replace(/-/g, '')}/${Date.now().toString().slice(-6)}`;
  }
}

/**
 * Ensure Orders sheet has payment columns (idempotent, backward compatible)
 */
export async function ensureOrdersPaymentHeaders() {
  try {
    // Get current headers
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Orders!A1:Z1',
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
        range: `Orders!${startCol}1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [missingHeaders],
        },
      });
      
    }
  } catch (error) {
    // Non-critical, continue
  }
}

/**
 * Ensure WaitingList sheet has payment headers (snake_case only)
 * Adds missing payment columns to the right of existing columns
 */
export async function ensureWaitingListPaymentHeaders() {
  try {
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
      
    }
  } catch (error) {
    // Non-critical, continue
  }
}

/**
 * Compute order totals (product total, packaging fee, delivery fee, final total, DP min, etc.)
 * @param {Object} orderData - Order data with items, notes, delivery_fee
 * @param {Object} priceList - Price list from PriceList sheet
 * @returns {Object} Calculated totals
 */
async function computeOrderTotals(orderData, priceList) {
  const { calculateOrderTotal } = await import('./price-calculator.js');
  const { calculateMinDP } = await import('./payment-tracker.js');
  
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
  
  // Check if packaging is explicitly requested (YA)
  for (const note of packagingNotes) {
    const noteLower = note.toLowerCase();
    // Check for "YA" (yes) - could be "Packaging Styrofoam: YA" or "YA" on its own
    if (noteLower.includes('ya') && !noteLower.includes('tidak')) {
      packagingRequested = true;
      break;
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
  
  if (packagingRequested || packagingInItems) {
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
    
    // 1 box = 50 cups, Rp 40,000 per box
    if (totalCups > 0) {
      const boxes = Math.ceil(totalCups / 50);
      packagingFee = boxes * 40000;
    } else {
      // If no cups detected but packaging requested, assume 1 box
      packagingFee = 40000;
    }
  }
  
  // Delivery fee (from orderData.delivery_fee, default 0)
  const deliveryFee = parseFloat(orderData.delivery_fee) || 0;
  
  // Total amount (canonical - replaces final_total)
  const totalAmount = productTotal + packagingFee + deliveryFee;
  
  // DP minimum (50% of total amount)
  const dpMinAmount = calculateMinDP(totalAmount);
  
  // Paid amount (default 0 at creation)
  const paidAmount = parseFloat(orderData.paid_amount) || 0;
  
  // Payment status (default 'UNPAID' at creation)
  const { calculatePaymentStatus } = await import('./payment-tracker.js');
  const paymentStatus = orderData.payment_status || calculatePaymentStatus(paidAmount, totalAmount);
  
  // Remaining balance
  const { calculateRemainingBalance } = await import('./payment-tracker.js');
  const remainingBalance = calculateRemainingBalance(totalAmount, paidAmount);
  
  
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

/**
 * Save order to Google Sheets
 * Uses header-based mapping to write payment columns correctly
 * Checks for duplicates before writing (idempotent)
 */
export async function saveOrder(orderData, options = {}) {
  try {
    const { skipDuplicateCheck = false } = options;
    
    // Generate order ID if not provided (MUST be done first)
    const orderId = orderData.id || await generateOrderId();
    if (!orderId) {
      throw new Error('Missing order_id: Failed to generate order ID before saving order');
    }
    orderData.id = orderId;
    
    
    // Normalize event_date to YYYY-MM-DD format before saving
    const { normalizeEventDate } = await import('./date-utils.js');
    const originalEventDate = orderData.event_date;
    if (orderData.event_date) {
      try {
        orderData.event_date = normalizeEventDate(orderData.event_date);
        if (orderData.event_date !== originalEventDate) {
        }
      } catch (error) {
        throw new Error(`Invalid event_date format: ${originalEventDate}. ${error.message}`);
      }
    }
    
    // Normalize delivery_time to HH:MM format before saving
    const { normalizeDeliveryTime } = await import('./price-calculator.js');
    const originalDeliveryTime = orderData.delivery_time;
    if (orderData.delivery_time) {
      try {
        orderData.delivery_time = normalizeDeliveryTime(orderData.delivery_time);
        if (orderData.delivery_time !== originalDeliveryTime) {
        }
      } catch (error) {
        throw new Error(`Invalid delivery_time format: ${originalDeliveryTime}. ${error.message}`);
      }
    }
    
    // Check for duplicate Order ID (unless explicitly skipped)
    if (!skipDuplicateCheck) {
      const existingRow = await findRowByOrderId('Orders', orderId);
      if (existingRow) {
        // Return existing order data instead of creating duplicate
        const existingOrder = await getOrderById(orderId);
        return existingOrder || orderData;
      }
    }
    
    // Check if Orders sheet exists, create if not
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

    if (!existingSheets.includes('Orders')) {
      // Create Orders sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: 'Orders',
              },
            },
          }],
        },
      });

      // Add headers (original + payment columns)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Orders!A1:W1',
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
    const headerMap = await getSheetHeaderMap('Orders', { requireSnakeCase: true, sheetType: 'Orders' });
    
    // Validate required columns exist
    const requiredKeys = ['order_id', 'customer_name', 'phone_number', 'status'];
    validateRequiredKeys(headerMap, requiredKeys, 'Orders');

    // Get price list for calculations
    const priceList = await getPriceList();
    
    // Compute order totals
    const totals = await computeOrderTotals(orderData, priceList);
    
    // Prepare data object with snake_case keys
    const itemsJson = JSON.stringify(orderData.items || []);
    const notesJson = JSON.stringify(orderData.notes || []);
    const totalItems = (orderData.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
    
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
      status: orderData.status || 'pending',
      total_items: totalItems,
      created_at: orderData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      conversation_id: orderData.conversation_id || '',
      // Payment columns (calculated values)
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
    

    // UPSERT: Check if order exists and update, otherwise append
    const existingRowIndex = await findRowByOrderId('Orders', orderId);
    
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
            range: `Orders!${col}${existingRowIndex}`,
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
      const range = `Orders!A:${lastCol}`;

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: range,
        valueInputOption: 'RAW',
        requestBody: {
          values: [row],
        },
      });
    }

    // Post-write validation: Check for duplicates (safety net)
    const duplicateCheck = await findRowByOrderId('Orders', orderId);
    if (duplicateCheck && duplicateCheck !== existingRowIndex) {
      // This should never happen with upsert, but log if it does
      // Don't throw - the upsert should have prevented this
    }
    
      orderId,
      productTotal: totals.productTotal,
      packagingFee: totals.packagingFee,
      deliveryFee: totals.deliveryFee,
      finalTotal: totals.finalTotal,
      paymentStatus: totals.paymentStatus,
      operation: existingRowIndex ? 'UPDATED' : 'APPENDED',
    });
    
    // Return order data with calculated totals
    return {
      ...orderData,
      id: orderId,
      ...totals,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Get price list from Google Sheets
 * Supports both old format (A=Item Name, B=Price) and new format (A=item_code, B=item_name, D=unit_price)
 */
export async function getPriceList() {
  try {
    // Check if sheet exists
    try {
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${PRICE_LIST_SHEET}!A1:F1`,
      });
    } catch (error) {
      // Sheet doesn't exist, return empty object
      return {};
    }

    // Read extended range to support new schema (A-F columns)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${PRICE_LIST_SHEET}!A:F`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return {};
    }

    // Detect schema by checking header row
    const headerRow = rows[0] || [];
    const hasNewSchema = headerRow[0]?.toLowerCase().includes('item_code') || 
                         headerRow[3]?.toLowerCase().includes('unit_price');
    
    const priceList = {};
    let activeCount = 0;
    let skippedCount = 0;
    
    // Skip header row
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      if (hasNewSchema) {
        // New schema: A=item_code, B=item_name, C=category, D=unit_price, E=unit_type, F=is_active
        const itemCode = row[0]?.trim();
        const itemName = row[1]?.trim();
        const unitPriceRaw = row[3]?.toString().trim();
        const isActive = row[5]?.toString().toUpperCase().trim();
        
        if (!itemName || !unitPriceRaw) {
          skippedCount++;
          continue;
        }
        
        // Filter by is_active if column exists
        if (isActive && isActive !== 'TRUE' && isActive !== '1') {
          skippedCount++;
          continue;
        }
        
        // Parse price (remove thousand separators)
        const price = parseInt(unitPriceRaw.replace(/[.,]/g, '')) || 0;
        
        if (price <= 0) {
          skippedCount++;
          continue;
        }
        
        // Use item_name as primary key (for backward compatibility)
        priceList[itemName] = price;
        
        // Also add item_code as alias for lookup flexibility
        if (itemCode && itemCode !== itemName) {
          priceList[itemCode] = price;
        }
        
        activeCount++;
      } else {
        // Old schema: A=Item Name, B=Price
        const itemName = row[0]?.trim();
        const priceRaw = row[1]?.toString().trim();
        
        if (!itemName || !priceRaw) {
          skippedCount++;
          continue;
        }
        
        // Parse price (remove thousand separators)
        const price = parseInt(priceRaw.replace(/[.,]/g, '')) || 0;
        
        if (price <= 0) {
          skippedCount++;
          continue;
        }
        
        priceList[itemName] = price;
        activeCount++;
      }
    }
    
    
    return priceList;
  } catch (error) {
    return {};
  }
}

/**
 * Initialize price list sheet with default prices
 */
export async function initializePriceList() {
  try {
    if (!SPREADSHEET_ID) {
      throw new Error('GOOGLE_SPREADSHEET_ID not set in .env file');
    }

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

    if (!existingSheets.includes(PRICE_LIST_SHEET)) {
      
      // Create PriceList sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: PRICE_LIST_SHEET,
              },
            },
          }],
        },
      });


      // Add headers and default prices
      const defaultPrices = [
        ['Pesanan', 'Harga'],
        ['Dawet Kemayu Small', '13000'],
        ['Dawet Kemayu Medium', '15000'],
        ['Dawet Kemayu Large', '20000'],
        ['Topping Durian', '5000'],
        ['Topping Nangka', '3000'],
        ['Dawet Kemayu Botol 250ml', '20000'],
        ['Dawet Kemayu Botol 1L', '80000'],
        ['Hampers Packaging', '10000'],
        ['Mini Pack', '45000'],
        ['Family Pack', '80000'],
        ['Extra Family Pack', '90000'],
        ['Teh Kemayu', '5000'],
        ['Air Mineral', '5000'],
        ['Molen Original', '3000'],
        ['Molen Keju', '3000'],
        ['Molen Coklat', '3000'],
        ['Roti Srikaya Original', '5000'],
        ['Roti Srikaya Pandan', '5000'],
        ['Packaging Styrofoam', '40000'],
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${PRICE_LIST_SHEET}!A1:B${defaultPrices.length}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: defaultPrices,
        },
      });

    } else {
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Initialize waiting list sheet
 */
export async function initializeWaitingList() {
  try {
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

    } else {
      // Ensure payment headers exist (for existing sheets)
      await ensureWaitingListPaymentHeaders();
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Save order to waiting list (for future-dated orders)
 * Checks for duplicates before writing (idempotent)
 */
export async function saveToWaitingList(orderData, options = {}) {
  try {
    const { skipDuplicateCheck = false } = options;
    
    // Generate order ID if not provided (MUST be done first)
    const orderId = orderData.id || `ORD-${Date.now()}`;
    if (!orderId) {
      throw new Error('Missing order_id: Failed to generate order ID before saving to WaitingList');
    }
    orderData.id = orderId;
    
    
    // Normalize event_date to YYYY-MM-DD format before saving
    const { normalizeEventDate } = await import('./date-utils.js');
    const originalEventDate = orderData.event_date;
    if (orderData.event_date) {
      try {
        orderData.event_date = normalizeEventDate(orderData.event_date);
        if (orderData.event_date !== originalEventDate) {
        }
      } catch (error) {
        throw new Error(`Invalid event_date format: ${originalEventDate}. ${error.message}`);
      }
    }
    
    // Normalize delivery_time to HH:MM format before saving
    const { normalizeDeliveryTime } = await import('./price-calculator.js');
    const originalDeliveryTime = orderData.delivery_time;
    if (orderData.delivery_time) {
      try {
        orderData.delivery_time = normalizeDeliveryTime(orderData.delivery_time);
        if (orderData.delivery_time !== originalDeliveryTime) {
        }
      } catch (error) {
        throw new Error(`Invalid delivery_time format: ${originalDeliveryTime}. ${error.message}`);
      }
    }
    
    // Check for duplicate Order ID (unless explicitly skipped)
    if (!skipDuplicateCheck) {
      const existingRow = await findRowByOrderId(WAITING_LIST_SHEET, orderId);
      if (existingRow) {
        // Return existing order data instead of creating duplicate
        const existingOrder = await getOrderById(orderId);
        return existingOrder || orderData;
      }
    }
    
    // Import calendar functions dynamically to avoid circular dependency
    const { createCalendarEvent } = await import('./google-calendar.js');
    
    // Prepare order row (same format as Orders sheet + calendar_event_id)
    const itemsJson = JSON.stringify(orderData.items || []);
    const notesJson = JSON.stringify(orderData.notes || []);
    const totalItems = (orderData.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);

    // Create calendar event for this order (OPTIONAL - failure does NOT block order saving)
    let calendarEventId = null;
    try {
      if (orderData.event_date) {
        calendarEventId = await createCalendarEvent(orderData);
        if (calendarEventId) {
        }
      }
    } catch (error) {
      // Continue saving order even if calendar creation fails (calendar is optional)
      calendarEventId = null;
    }

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

    return { ...orderData, calendar_event_id: calendarEventId };
  } catch (error) {
    throw error;
  }
}

/**
 * Get all orders from waiting list
 */
export async function getWaitingListOrders() {
  try {
    
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
      return [];
    }

    // Import normalizers for defensive normalization
    const { normalizeEventDate } = await import('./date-utils.js');
    const { normalizeDeliveryTime } = await import('./price-calculator.js');
    
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
      }
    }

    return orders;
  } catch (error) {
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
      
      // Parse date (format: DD/MM/YYYY)
      const dateParts = order.event_date.split('/');
      if (dateParts.length !== 3) continue;
      
      const orderDate = new Date(
        parseInt(dateParts[2]), // Year
        parseInt(dateParts[1]) - 1, // Month (0-indexed)
        parseInt(dateParts[0]) // Day
      );
      orderDate.setHours(0, 0, 0, 0);
      
      // Check if order date is today or in the past
      if (orderDate <= today) {
        dueOrders.push(order);
      }
    }
    
    return dueOrders;
  } catch (error) {
    return [];
  }
}

/**
 * Mark reminder as sent in waiting list
 */
export async function markReminderSent(orderId) {
  try {
    if (!orderId) {
      return false;
    }
    
    // Find row index using header mapping
    const rowIndex = await findRowByOrderId(WAITING_LIST_SHEET, orderId);
    if (!rowIndex) {
      return false;
    }
    
    // Ensure payment headers exist before mapping
    await ensureWaitingListPaymentHeaders();
    
    // Get header map using alias-based mapping
    const headerMap = await getSheetHeaderMap(WAITING_LIST_SHEET, { requireSnakeCase: true, sheetType: 'WaitingList' });
    
    // Update reminder_sent using header mapping
    const reminderSentColIndex = headerMap.reminder_sent;
    if (reminderSentColIndex === undefined) {
      return false;
    }
    
    const col = columnIndexToLetter(reminderSentColIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${WAITING_LIST_SHEET}!${col}${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [['true']],
      },
    });

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Update order status
 */
export async function updateOrderStatus(orderId, newStatus) {
  try {
    // Get all orders to find the one to update (read extended range to include payment columns)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Orders!A:W',
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      throw new Error('No orders found');
    }

    // Find the row with matching order ID
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === orderId) {
        rowIndex = i + 1; // +1 because Google Sheets is 1-indexed
        break;
      }
    }

    if (rowIndex === -1) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Update status in column K (index 10)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Orders!K${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[newStatus]],
      },
    });

    // Update Updated At in column N (index 13)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Orders!N${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[new Date().toISOString()]],
      },
    });

    return true;
  } catch (error) {
    throw error;
  }
}

/**
 * Update order payment (paid amount and payment status)
 * ACCUMULATES payments instead of overwriting
 * Uses header-based mapping for column updates
 * @param {string} orderId - Order ID
 * @param {number} newPaymentAmount - New payment amount to ADD (not replace)
 * @returns {Object} Updated payment info
 */
export async function updateOrderPayment(orderId, newPaymentAmount) {
  try {
    
    if (!orderId) {
      throw new Error('Missing order_id: Cannot update payment without order ID');
    }
    
    const { calculatePaymentStatus, calculateRemainingBalance, parseIDRAmount } = await import('./payment-tracker.js');
    
    // Normalize order_id for lookup
    const normalizedOrderId = normalizeOrderId(orderId);
    
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
      const { calculateMinDP } = await import('./payment-tracker.js');
      dpMinAmount = calculateMinDP(totalAmount);
    } else {
    }
    

    // Find row index using header mapping
    const rowIndex = await findRowByOrderId('Orders', orderId);
    if (!rowIndex) {
      throw new Error(`Order ${orderId} not found`);
    }
    
    // Get header map using alias-based mapping (enforce snake_case for Orders)
    const headerMap = await getSheetHeaderMap('Orders', { requireSnakeCase: true, sheetType: 'Orders' });
    
    // Build update data using header-based column mapping (with alias support)
    const updateData = [];
    
    const updateColumn = (internalKey, value) => {
      const colIndex = headerMap[internalKey];
      if (colIndex !== undefined) {
        const col = columnIndexToLetter(colIndex); // Use proper column letter conversion
        updateData.push({
          range: `Orders!${col}${rowIndex}`,
          values: [[value]],
        });
        return true;
      }
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
    

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: updateData,
        },
      });
    }

    return {
      orderId,
      paidAmount: newTotalPaid, // Return accumulated total
      paymentStatus,
      remainingBalance,
      totalAmount, // Canonical field
      finalTotal: totalAmount, // Keep for backward compatibility
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Update waiting list order status
 */
export async function updateWaitingListOrderStatus(orderId, newStatus) {
  try {
    
    if (!orderId) {
      throw new Error('Missing order_id: Cannot update waiting list order status without order ID');
    }
    
    // Import calendar functions dynamically (OPTIONAL - failure does NOT block status update)
    const { updateCalendarEvent, deleteCalendarEvent } = await import('./google-calendar.js');

    // Find row index using header mapping
    const rowIndex = await findRowByOrderId(WAITING_LIST_SHEET, orderId);
    if (!rowIndex) {
      throw new Error(`Order ${orderId} not found in waiting list`);
    }
    
    // Ensure payment headers exist before mapping
    await ensureWaitingListPaymentHeaders();
    
    // Get header map to read order data and find calendar_event_id column
    const headerMap = await getSheetHeaderMap(WAITING_LIST_SHEET, { requireSnakeCase: true, sheetType: 'WaitingList' });
    
    // Read order row to get calendar event ID
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${WAITING_LIST_SHEET}!${rowIndex}:${rowIndex}`,
    });
    
    const orderRow = response.data.values?.[0] || [];
    
    // Get calendar event ID using header mapping
    const calendarEventIdColIndex = headerMap.calendar_event_id;
    const calendarEventId = calendarEventIdColIndex !== undefined ? (orderRow[calendarEventIdColIndex] || '') : '';
    
    // Helper to get value from order row by internal key
    const getValue = (internalKey, defaultValue = '') => {
      const colIndex = headerMap[internalKey];
      if (colIndex === undefined) return defaultValue;
      return orderRow[colIndex] !== undefined && orderRow[colIndex] !== '' ? orderRow[colIndex] : defaultValue;
    };

    // Handle calendar events based on status
    if (newStatus === 'cancelled' && calendarEventId) {
      // Delete calendar event when order is cancelled
      try {
        await deleteCalendarEvent(calendarEventId, orderId);
        // Clear calendar event ID in sheet (will be done in updateData below)
      } catch (error) {
        // Continue with status update even if calendar deletion fails (calendar is optional)
      }
    } else if (calendarEventId && getValue('event_date')) {
      // Update calendar event if it exists and order has date (OPTIONAL)
      try {
        const order = {
          id: getValue('order_id'),
          customer_name: getValue('customer_name'),
          phone_number: getValue('phone_number'),
          address: getValue('address'),
          event_name: getValue('event_name'),
          event_duration: getValue('event_duration'),
          event_date: getValue('event_date'),
          delivery_time: getValue('delivery_time'),
          items: (() => {
            try {
              return JSON.parse(getValue('items_json', '[]'));
            } catch {
              return [];
            }
          })(),
          notes: (() => {
            try {
              return JSON.parse(getValue('notes_json', '[]'));
            } catch {
              return [];
            }
          })(),
          status: newStatus,
        };
        await updateCalendarEvent(calendarEventId, order);
      } catch (error) {
        // Continue with status update even if calendar update fails (calendar is optional)
      }
    }
    
    // Build update data using header mapping
    const updateData = [];
    
    const updateColumn = (internalKey, value) => {
      const colIndex = headerMap[internalKey];
      if (colIndex !== undefined) {
        const col = String.fromCharCode(65 + colIndex); // A=65
        updateData.push({
          range: `${WAITING_LIST_SHEET}!${col}${rowIndex}`,
          values: [[value]],
        });
        return true;
      }
      return false;
    };
    
    // Update status and updated_at using internal keys
    updateColumn('status', newStatus);
    updateColumn('updated_at', new Date().toISOString());
    
    // Also update calendar_event_id if it was cleared
    if (newStatus === 'cancelled' && calendarEventId) {
      updateColumn('calendar_event_id', '');
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

    return true;
  } catch (error) {
    throw error;
  }
}

/**
 * Get all orders
 * Uses header-based mapping to read payment columns correctly
 */
export async function getAllOrders(limit = 100) {
  try {
    
    // Get header map using alias-based mapping (enforce snake_case for Orders)
    const headerMap = await getSheetHeaderMap('Orders', { requireSnakeCase: true, sheetType: 'Orders' });
    
    // Read extended range to include all columns
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Orders!A:${columnIndexToLetter(headerMap.__headersLength - 1)}`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
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

      const getNumericValue = (internalKey, defaultValue = 0) => {
        const value = getValue(internalKey, defaultValue);
        const numValue = parseFloat(value);
        return !isNaN(numValue) ? numValue : defaultValue;
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
        // Clean numeric values - if stored as formatted string, parse it
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
        // READ fallback: if total_amount missing, use final_total (legacy support)
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
          if (parsed > 0) {
          }
          return parsed;
        })(),
        // Keep final_total for backward compatibility (deprecated, use total_amount)
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
          // Clean formatted strings (e.g., "Rp 235.000" or "235.000")
          if (typeof val === 'string') {
            const cleaned = val.replace(/^rp\s*/i, '').replace(/\s+/g, '').replace(/[.,]/g, '');
            return parseFloat(cleaned) || 0;
          }
          return parseFloat(val) || 0;
        })(),
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
    
    return sortedOrders;
  } catch (error) {
    throw error;
  }
}

/**
 * Find row index by Order ID in a specific sheet
 * Uses header mapping to find order_id column (not hardcoded to column A)
 * Normalizes order_id for consistent comparison
 * @param {string} sheetName - Sheet name (e.g., 'Orders', 'WaitingList')
 * @param {string} orderId - Order ID to search for
 * @returns {Promise<number|null>} Row index (1-based) or null if not found
 */
export async function findRowByOrderId(sheetName, orderId) {
  try {
    if (!orderId) {
      return null;
    }
    
    // Get header map to find order_id column
    const headerMap = await getSheetHeaderMap(sheetName, { requireSnakeCase: false });
    const orderIdColumnIndex = headerMap.order_id;
    
    if (orderIdColumnIndex === undefined) {
      return null;
    }
    
    // Normalize input order_id
    const normalizedInputId = normalizeOrderId(orderId);
    
    // Read ALL data rows (not partial range) - use extended range to ensure we get all rows
    const lastColumn = columnIndexToLetter(headerMap.__headersLength - 1);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:${lastColumn}`, // Read all columns
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
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
      
      
      // Compare normalized values
      if (sheetOrderIdNormalized === normalizedInputId) {
        if (foundRow === null) {
          foundRow = i + 1; // Return 1-based row index
        } else {
          // Duplicate found
          duplicateRows.push(i + 1);
        }
      }
    }

    if (duplicateRows.length > 0) {
    }

    if (foundRow) {
      return foundRow;
    }

    return null;
  } catch (error) {
    return null;
  }
}

export async function getOrderById(orderId) {
  try {
    if (!orderId) {
      return null;
    }
    
    // Normalize order_id for comparison
    const normalizedInputId = normalizeOrderId(orderId);
    
    // ALWAYS search Orders sheet first (source of truth)
    const allOrders = await getAllOrders(1000);
    let order = allOrders.find(o => {
      const orderIdNormalized = normalizeOrderId(o.id || '');
      return orderIdNormalized === normalizedInputId;
    });
    
    if (order) {
      return order;
    }
    
    // Fallback: Check WaitingList (secondary source)
    const waitingListOrders = await getWaitingListOrders();
    order = waitingListOrders.find(o => {
      const orderIdNormalized = normalizeOrderId(o.id || '');
      return orderIdNormalized === normalizedInputId;
    });
    
    if (order) {
      return order;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Ensure Conversations sheet has correct headers in row 1
 * This function is idempotent and safe to call multiple times
 * If headers are missing or incorrect, it will:
 * 1. Insert correct headers into row 1
 * 2. Shift existing data down by 1 row
 * 3. Preserve all existing conversation data
 */
async function ensureConversationsHeaders() {
  try {
    // Check if sheet exists
    let sheetExists = false;
    try {
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${CONVERSATIONS_SHEET}!A1:G1`,
      });
      sheetExists = true;
    } catch (error) {
      // Sheet doesn't exist yet, will be created by initializeStorage
      return;
    }

    if (!sheetExists) return;

    // Read row 1 to check headers
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CONVERSATIONS_SHEET}!A1:G1`,
    });

    const existingHeaders = headerResponse.data.values?.[0] || [];
    
    // Check if headers match expected schema exactly
    const headersMatch = 
      existingHeaders.length === CONVERSATIONS_SCHEMA.length &&
      existingHeaders.every((header, index) => 
        String(header).toLowerCase().trim() === CONVERSATIONS_SCHEMA[index].toLowerCase()
      );

    if (headersMatch) {
      // Headers are correct, nothing to do
      return;
    }

    // Headers are missing or incorrect - need to fix

    // Get all existing data (if any)
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CONVERSATIONS_SHEET}!A:G`,
    });

    const allRows = allDataResponse.data.values || [];
    const hasData = allRows.length > 0;
    const firstRowLooksLikeData = hasData && allRows.length > 0 && 
      (allRows[0].length === 0 || 
       !CONVERSATIONS_SCHEMA.some(header => 
         String(allRows[0][0] || '').toLowerCase().includes(header.toLowerCase())
       ));

    if (hasData && firstRowLooksLikeData) {
      // Row 1 contains data (no headers) - insert new row for headers
      // This shifts all existing data down by 1 row, preserving it
      const sheetId = await getSheetId(CONVERSATIONS_SHEET);
      if (sheetId) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: [{
              insertDimension: {
                range: {
                  sheetId: sheetId,
                  dimension: 'ROWS',
                  startIndex: 0, // Insert at row 0 (becomes row 1 after insert)
                  endIndex: 1,   // Insert 1 row
                },
              },
            }],
          },
        });
      }
    }
    // If row 1 has incorrect headers, we'll just overwrite it below

    // Write correct headers to row 1 (overwrites incorrect headers or fills new row)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CONVERSATIONS_SHEET}!A1:G1`, // Locked range - always column A
      valueInputOption: 'RAW',
      requestBody: {
        values: [CONVERSATIONS_SCHEMA], // Exactly 7 headers matching schema
      },
    });

  } catch (error) {
    // Don't throw - allow system to continue
  }
}

/**
 * Get sheet ID by name (helper for batchUpdate operations)
 */
async function getSheetId(sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });
  const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
  return sheet?.properties.sheetId;
}

/**
 * Validate conversation data before writing
 * Throws error if validation fails
 */
function validateConversationData(data) {
  // Validate array length
  if (!Array.isArray(data) || data.length !== 7) {
    throw new Error(`Invalid conversation data: must be array of exactly 7 values, got ${data.length}`);
  }

  // Validate conversation_id (column A)
  if (!data[0] || String(data[0]).trim() === '') {
    throw new Error('Invalid conversation data: conversation_id is required');
  }

  // Validate platform_reference (column C)
  const platform = String(data[2] || '').toLowerCase().trim();
  if (!ALLOWED_PLATFORMS.includes(platform)) {
    throw new Error(`Invalid conversation data: platform_reference must be one of [${ALLOWED_PLATFORMS.join(', ')}], got "${data[2]}"`);
  }

  return true;
}

/**
 * Get or create conversation with strict schema enforcement
 * Schema: [conversation_id, external_user_id, platform_reference, customer_name, status, first_seen_at, last_message_at]
 */
export async function getOrCreateConversation(telegramChatId, fromName, fromId) {
  try {
    // Ensure headers exist before any operations
    await ensureConversationsHeaders();

    // Get all conversations using locked range A:G
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CONVERSATIONS_SHEET}!A:G`,
    });

    const rows = response.data.values || [];
    
    // Skip header row (row 0), search for existing conversation
    // Look for match by external_user_id (column B) which contains telegramChatId
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Column B (index 1) is external_user_id
      if (row[1] === String(telegramChatId)) {
        // Found existing conversation - UPDATE last_message_at (column G, index 6)
        const rowNumber = i + 1; // Google Sheets is 1-indexed
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${CONVERSATIONS_SHEET}!G${rowNumber}`, // Column G = last_message_at
          valueInputOption: 'RAW',
          requestBody: {
            values: [[new Date().toISOString()]],
          },
        });

        // Return conversation object matching schema
        return {
          id: row[0] || '',                    // Column A: conversation_id
          external_user_id: row[1] || '',      // Column B: external_user_id
          platform_reference: row[2] || '',     // Column C: platform_reference
          customer_name: row[3] || '',         // Column D: customer_name
          status: row[4] || 'active',          // Column E: status
          first_seen_at: row[5] || '',         // Column F: first_seen_at
          last_message_at: new Date().toISOString(), // Column G: last_message_at (updated)
        };
      }
    }

    // Conversation doesn't exist - CREATE new one
    const conversationId = `conv_telegram_${telegramChatId}_${Date.now()}`;
    const now = new Date().toISOString();
    
    // Build row array matching EXACT schema order (7 columns, starting from A)
    const newRow = [
      conversationId,                    // Column A: conversation_id
      String(telegramChatId),            // Column B: external_user_id
      'telegram',                        // Column C: platform_reference
      fromName || 'Unknown',             // Column D: customer_name
      'active',                          // Column E: status
      now,                               // Column F: first_seen_at
      now,                               // Column G: last_message_at
    ];

    // Validate before writing
    validateConversationData(newRow);

    // Append using locked range A:G - ensures data starts from column A
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CONVERSATIONS_SHEET}!A:G`, // Locked range - prevents column drift
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [newRow], // Exactly 7 values matching schema
      },
    });


    return {
      id: conversationId,
      external_user_id: String(telegramChatId),
      platform_reference: 'telegram',
      customer_name: fromName || 'Unknown',
      status: 'active',
      first_seen_at: now,
      last_message_at: now,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Get all messages using strict schema (A:H columns)
 */
export async function getAllMessages(limit = 100) {
  try {
    // First check if sheet exists
    try {
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${MESSAGES_SHEET}!A1:H1`,
      });
    } catch (error) {
      // Sheet doesn't exist, return empty array
      return [];
    }

    // Read all messages using locked range A:H
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${MESSAGES_SHEET}!A:H`, // Locked range - matches schema
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return []; // Only headers

    // Convert rows to objects using strict schema (A:H columns)
    // Skip header row (row 0)
    const messages = rows.slice(1, limit + 1).map(row => ({
      id: row[0] || '',                    // Column A: message_id
      conversation_id: row[1] || '',       // Column B: conversation_id
      external_user_id: row[2] || '',      // Column C: external_user_id
      platform: row[3] || '',              // Column D: platform
      direction: row[4] || '',             // Column E: direction
      text: row[5] || '',                  // Column F: message_text
      status: row[6] || 'sent',            // Column G: status
      created_at: row[7] || '',            // Column H: created_at
      // Legacy fields for backward compatibility
      telegram_chat_id: row[2] ? parseInt(row[2]) : null,
      from: row[2] || '',
      from_name: '',
      source: row[3] || '',
    }));

    // Sort by created_at ascending (oldest first, newest last) for chat UX
    // Frontend will handle final ordering, but backend should provide consistent order
    return messages.sort((a, b) => 
      new Date(a.created_at || 0) - new Date(b.created_at || 0)
    );
  } catch (error) {
    throw error;
  }
}

/**
 * Get messages by conversation
 */
export async function getMessagesByConversation(conversationId, limit = 50) {
  try {
    const allMessages = await getAllMessages(1000); // Get more to filter
    return allMessages
      .filter(m => m.conversation_id === conversationId)
      .slice(0, limit);
  } catch (error) {
    throw error;
  }
}

/**
 * Get conversation by ID
 */
export async function getConversationById(conversationId) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CONVERSATIONS_SHEET}!A:G`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return null; // Only headers

    // Find conversation by ID (column A)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[0] === conversationId) {
        return {
          id: row[0] || '',
          external_user_id: row[1] || '',
          platform_reference: row[2] || '',
          customer_name: row[3] || '',
          status: row[4] || 'active',
          first_seen_at: row[5] || '',
          last_message_at: row[6] || '',
        };
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Get all conversations
 */
export async function getAllConversations(limit = 50) {
  try {
    // First check if sheet exists
    try {
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${CONVERSATIONS_SHEET}!A1:G1`,
      });
    } catch (error) {
      // Sheet doesn't exist, return empty array
      return [];
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CONVERSATIONS_SHEET}!A:G`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return []; // Only headers

    // Fetch all messages once (more efficient than fetching per conversation)
    let allMessages = [];
    try {
      allMessages = await getAllMessages(1000);
    } catch (error) {
      // Continue without message stats
    }

    // Map rows to objects using strict schema (A:G columns)
    const conversations = rows.slice(1, limit + 1).map(row => {
      const externalUserId = row[1] || '';
      const platformRef = row[2] || '';
      const conversationId = row[0] || '';
      
      // Parse telegram_chat_id from external_user_id if platform is telegram
      let telegramChatId = null;
      if (platformRef === 'telegram' && externalUserId) {
        const parsed = parseInt(externalUserId);
        if (!isNaN(parsed)) {
          telegramChatId = parsed;
        }
      }
      
      // Get last message and message count for this conversation
      let lastMessage = '';
      let messageCount = 0;
      if (allMessages.length > 0) {
        const conversationMessages = allMessages.filter(m => m.conversation_id === conversationId);
        messageCount = conversationMessages.length;
        if (conversationMessages.length > 0) {
          // Get most recent message
          const sortedMessages = conversationMessages.sort((a, b) => 
            new Date(b.created_at || 0) - new Date(a.created_at || 0)
          );
          lastMessage = sortedMessages[0].text || '';
          // Truncate if too long
          if (lastMessage.length > 50) {
            lastMessage = lastMessage.substring(0, 50) + '...';
          }
        }
      }
      
      return {
        id: conversationId,                  // Column A: conversation_id
        external_user_id: externalUserId,     // Column B: external_user_id
        platform_reference: platformRef,      // Column C: platform_reference
        customer_name: row[3] || '',         // Column D: customer_name
        status: row[4] || 'active',          // Column E: status
        first_seen_at: row[5] || '',         // Column F: first_seen_at
        last_message_at: row[6] || '',      // Column G: last_message_at
        // Frontend compatibility fields
        telegram_chat_id: telegramChatId,    // For frontend use
        customer_id: externalUserId,          // Alias for external_user_id
        last_message: lastMessage,            // Last message preview
        message_count: messageCount,         // Message count
      };
    });

    // Sort by last_message_at descending
    return conversations.sort((a, b) => 
      new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0)
    );
  } catch (error) {
    throw error;
  }
}

/**
 * Ensure Users sheet exists with correct headers
 * Idempotent - safe to call multiple times
 */
export async function ensureUsersSheet() {
  try {
    // Get spreadsheet to check if Users sheet exists
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
    
    if (!existingSheets.includes(USERS_SHEET)) {
      // Create Users sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: USERS_SHEET,
              },
            },
          }],
        },
      });
      
    }
    
    // Ensure headers exist (idempotent)
    await ensureUsersHeaders();
  } catch (error) {
    throw error;
  }
}

/**
 * Ensure Users sheet has correct headers in row 1
 * Safely appends missing columns to the right without reordering or renaming existing columns
 * Idempotent - safe to call multiple times
 */
async function ensureUsersHeaders() {
  try {
    // Check if sheet exists
    let sheetExists = false;
    try {
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A1:Z1`, // Read wider range to see all existing headers
      });
      sheetExists = true;
    } catch (error) {
      // Sheet doesn't exist yet, will be created by ensureUsersSheet
      return;
    }

    if (!sheetExists) return;

    // Read row 1 to check headers (read wider range to see all columns)
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${USERS_SHEET}!A1:Z1`,
    });

    const existingHeaders = headerResponse.data.values?.[0] || [];
    
    // If no headers exist, create all required headers
    if (existingHeaders.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A1:G1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [USERS_SCHEMA],
        },
      });
      return;
    }

    // Check which required columns are missing
    const missingColumns = [];
    const existingHeadersLower = existingHeaders.map(h => String(h).toLowerCase().trim());
    
    USERS_SCHEMA.forEach((requiredHeader, index) => {
      const requiredHeaderLower = requiredHeader.toLowerCase().trim();
      
      // Check if this required header exists at the expected position
      if (index < existingHeaders.length && 
          existingHeadersLower[index] === requiredHeaderLower) {
        // Header exists at correct position
        return;
      }
      
      // Check if header exists anywhere (in case of manual reordering)
      if (existingHeadersLower.includes(requiredHeaderLower)) {
        // Header exists but at different position - don't add duplicate
        return;
      }
      
      // Header is missing - add it
      missingColumns.push({
        index: index,
        header: requiredHeader,
      });
    });

    // If all required headers exist, nothing to do
    if (missingColumns.length === 0) {
      // Verify headers are in correct order
      const headersInOrder = USERS_SCHEMA.every((header, index) => 
        index < existingHeaders.length && 
        existingHeadersLower[index] === header.toLowerCase().trim()
      );
      
      if (headersInOrder) {
        // Headers are correct and in order
        return;
      }
      
      // Headers exist but may be out of order - log warning but don't reorder
      return;
    }

    // Append missing columns to the right
    
    // Find the last column index
    const lastColumnIndex = existingHeaders.length;
    
    // Append missing headers starting from the next available column
    const headersToAppend = missingColumns.map(mc => mc.header);
    
    // Convert column index to letter (A=0, B=1, etc.)
    function columnIndexToLetter(index) {
      let letter = '';
      while (index >= 0) {
        letter = String.fromCharCode(65 + (index % 26)) + letter;
        index = Math.floor(index / 26) - 1;
      }
      return letter;
    }
    
    const startColumn = columnIndexToLetter(lastColumnIndex);
    const endColumn = columnIndexToLetter(lastColumnIndex + headersToAppend.length - 1);
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${USERS_SHEET}!${startColumn}1:${endColumn}1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headersToAppend],
      },
    });

  } catch (error) {
    throw error;
  }
}

/**
 * Get user role from Users sheet
 * @param {string} platform - Platform name (e.g., 'telegram', 'whatsapp')
 * @param {string} userId - User ID (platform-specific)
 * @returns {Promise<string|null>} Role ('admin', 'staff', 'customer') or null if not found
 */
export async function getUserRole(platform, userId) {
  try {
    await ensureUsersSheet();
    
    // Read wider range to handle variable column counts
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${USERS_SHEET}!A:Z`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return null; // Only headers

    // Find user by platform and user_id
    // Map headers to column indices (handle cases where columns may be in different positions)
    const headerRow = rows[0] || [];
    const headerMap = {};
    headerRow.forEach((header, index) => {
      const headerLower = String(header).toLowerCase().trim();
      headerMap[headerLower] = index;
    });
    
    const userIdCol = headerMap['user_id'] ?? 0; // Column A (default)
    const platformCol = headerMap['platform'] ?? 1; // Column B (default)
    const roleCol = headerMap['role'] ?? 3; // Column D (default)
    const isActiveCol = headerMap['is_active'] ?? 4; // Column E (default)
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowUserId = row[userIdCol] || ''; // user_id
      const rowPlatform = row[platformCol] || ''; // platform
      // is_active: default to true if empty or missing
      const rowIsActiveValue = row[isActiveCol];
      const rowIsActive = rowIsActiveValue === 'TRUE' || 
                         rowIsActiveValue === true || 
                         rowIsActiveValue === 'true' ||
                         rowIsActiveValue === '' ||
                         rowIsActiveValue === undefined ||
                         rowIsActiveValue === null; // Default to true if empty/missing
      
      // Flexible matching: try both string and number formats for userId
      const rowUserIdStr = String(rowUserId).trim();
      const userIdStr = String(userId).trim();
      const rowUserIdNum = parseInt(rowUserIdStr);
      const userIdNum = parseInt(userIdStr);
      
      const userIdMatch = rowUserIdStr === userIdStr || 
                         (!isNaN(rowUserIdNum) && !isNaN(userIdNum) && rowUserIdNum === userIdNum);
      
      const platformMatch = String(rowPlatform).toLowerCase().trim() === String(platform).toLowerCase().trim();
      
      if (userIdMatch && platformMatch && rowIsActive) {
        const role = row[roleCol] || 'customer';
        return role;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Upsert user role in Users sheet
 * @param {string} platform - Platform name (e.g., 'telegram', 'whatsapp')
 * @param {string} userId - User ID (platform-specific)
 * @param {string} displayName - Display name for the user
 * @param {string} role - Role ('admin', 'staff', 'customer')
 * @param {boolean} isActive - Whether user is active
 * @returns {Promise<void>}
 */
export async function upsertUserRole(platform, userId, displayName, role, isActive = true) {
  try {
    await ensureUsersSheet();
    
    // Read wider range to handle variable column counts
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${USERS_SHEET}!A:Z`,
    });

    const rows = response.data.values || [];
    const now = new Date().toISOString();
    
    // Map headers to column indices (handle cases where columns may be in different positions)
    const headerRow = rows[0] || [];
    const headerMap = {};
    headerRow.forEach((header, index) => {
      const headerLower = String(header).toLowerCase().trim();
      headerMap[headerLower] = index;
    });
    
    // Get column indices (with defaults for required columns)
    const userIdCol = headerMap['user_id'] ?? 0;
    const platformCol = headerMap['platform'] ?? 1;
    const displayNameCol = headerMap['display_name'] ?? 2;
    const roleCol = headerMap['role'] ?? 3;
    const isActiveCol = headerMap['is_active'] ?? 4;
    const createdAtCol = headerMap['created_at'] ?? 5;
    const updatedAtCol = headerMap['updated_at'] ?? 6;
    
    // Check if user exists
    let userRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowUserId = row[userIdCol] || '';
      const rowPlatform = row[platformCol] || '';
      
      if (String(rowUserId) === String(userId) && 
          String(rowPlatform).toLowerCase() === String(platform).toLowerCase()) {
        userRowIndex = i + 1; // +1 because sheet rows are 1-indexed
        break;
      }
    }
    
    // Build row data array with all columns (preserve existing values where possible)
    const maxCols = Math.max(7, headerRow.length); // At least 7 columns, or more if headers exist
    const rowData = new Array(maxCols).fill('');
    
    // Set values in correct column positions
    rowData[userIdCol] = String(userId);
    rowData[platformCol] = String(platform);
    rowData[displayNameCol] = String(displayName || '');
    rowData[roleCol] = String(role || 'customer');
    rowData[isActiveCol] = isActive ? 'TRUE' : 'FALSE';
    
    // Preserve created_at if user exists, otherwise set to now
    if (userRowIndex > 0 && rows[userRowIndex - 1][createdAtCol]) {
      rowData[createdAtCol] = rows[userRowIndex - 1][createdAtCol];
    } else {
      rowData[createdAtCol] = now;
    }
    
    // Always update updated_at
    rowData[updatedAtCol] = now;
    
    // Convert column index to letter helper
    function columnIndexToLetter(index) {
      let letter = '';
      while (index >= 0) {
        letter = String.fromCharCode(65 + (index % 26)) + letter;
        index = Math.floor(index / 26) - 1;
      }
      return letter;
    }
    
    if (userRowIndex > 0) {
      // Update existing user - update all columns that exist
      const endColumn = columnIndexToLetter(rowData.length - 1);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A${userRowIndex}:${endColumn}${userRowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [rowData],
        },
      });
    } else {
      // Insert new user
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:Z`, // Append to wide range to handle variable columns
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [rowData],
        },
      });
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Migrate sheet headers to snake_case format
 * Updates all column headers in the specified sheet from Title Case to snake_case
 * @param {string} sheetName - Name of the sheet to migrate
 * @returns {Promise<void>}
 */
export async function migrateSheetHeadersToSnakeCase(sheetName) {
  try {
    
    // Read current headers
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!1:1`,
    });
    
    const currentHeaders = headerResponse.data.values?.[0] || [];
    
    if (currentHeaders.length === 0) {
      return;
    }
    
    
    // Normalize headers to snake_case
    const normalizedHeaders = currentHeaders.map(header => {
      if (!header || typeof header !== 'string') {
        return '';
      }
      // Special handling for headers with parentheses like "Items (JSON)"
      let normalized = normalizeColumnName(header);
      // If the original had "JSON" or similar, preserve it in a readable way
      if (header.includes('(JSON)') || header.includes('JSON')) {
        normalized = normalized.replace(/json/g, 'json');
      }
      return normalized;
    });
    
    
    // Check if any headers changed
    const hasChanges = currentHeaders.some((header, index) => {
      const normalized = normalizedHeaders[index];
      return header !== normalized;
    });
    
    if (!hasChanges) {
      return;
    }
    
    // Update headers in row 1
    const lastCol = String.fromCharCode(65 + normalizedHeaders.length - 1); // A=65
    const range = `${sheetName}!A1:${lastCol}1`;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [normalizedHeaders],
      },
    });
    
    currentHeaders.forEach((oldHeader, index) => {
      const newHeader = normalizedHeaders[index];
      if (oldHeader !== newHeader) {
      }
    });
    
  } catch (error) {
    throw error;
  }
}

/**
 * Migrate all sheets (Orders, WaitingList, Reminders) to snake_case headers
 * @returns {Promise<void>}
 */
export async function migrateAllSheetsToSnakeCase() {
  try {
    
    // Migrate each sheet
    await migrateSheetHeadersToSnakeCase('Orders');
    await migrateSheetHeadersToSnakeCase('WaitingList');
    await migrateSheetHeadersToSnakeCase('Reminders');
    
    
  } catch (error) {
    throw error;
  }
}

/**
 * Migrate date and time formats in existing rows
 * Normalizes event_date to YYYY-MM-DD and delivery_time to HH:MM
 * @param {string} sheetName - Name of the sheet to migrate
 * @returns {Promise<Object>} Migration statistics
 */
export async function migrateDateAndTimeFormats(sheetName) {
  try {
    
    // Get header map
    const headerMap = await getSheetHeaderMap(sheetName, { requireSnakeCase: false });
    const eventDateColIndex = headerMap.event_date;
    const deliveryTimeColIndex = headerMap.delivery_time;
    const reminderDateColIndex = headerMap.reminder_date; // For Reminders sheet
    
    if (eventDateColIndex === undefined && reminderDateColIndex === undefined) {
      return { updated: 0, skipped: 0, errors: 0 };
    }
    
    // Read all rows
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:${columnIndexToLetter(headerMap.__headersLength - 1)}`,
    });
    
    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return { updated: 0, skipped: 0, errors: 0 };
    }
    
    
    const { normalizeEventDate } = await import('./date-utils.js');
    const { normalizeDeliveryTime } = await import('./price-calculator.js');
    
    const updates = [];
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // Process each row (skip header row)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowIndex = i + 1; // 1-based row index
      let rowUpdated = false;
      
      // Normalize event_date (for Orders and WaitingList)
      if (eventDateColIndex !== undefined && row[eventDateColIndex]) {
        const originalEventDate = row[eventDateColIndex];
        
        // Check if already in YYYY-MM-DD format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(originalEventDate)) {
          try {
            const normalized = normalizeEventDate(originalEventDate);
            const col = columnIndexToLetter(eventDateColIndex);
            updates.push({
              range: `${sheetName}!${col}${rowIndex}`,
              values: [[normalized]],
            });
            rowUpdated = true;
          } catch (error) {
            errorCount++;
          }
        } else {
          skippedCount++;
        }
      }
      
      // Normalize reminder_date (for Reminders sheet)
      if (reminderDateColIndex !== undefined && row[reminderDateColIndex]) {
        const originalReminderDate = row[reminderDateColIndex];
        
        // Check if already in YYYY-MM-DD format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(originalReminderDate)) {
          try {
            const normalized = normalizeEventDate(originalReminderDate);
            const col = columnIndexToLetter(reminderDateColIndex);
            updates.push({
              range: `${sheetName}!${col}${rowIndex}`,
              values: [[normalized]],
            });
            rowUpdated = true;
          } catch (error) {
            errorCount++;
          }
        } else {
          skippedCount++;
        }
      }
      
      // Normalize delivery_time (for Orders and WaitingList)
      if (deliveryTimeColIndex !== undefined && row[deliveryTimeColIndex]) {
        const originalDeliveryTime = row[deliveryTimeColIndex];
        
        // Check if already in HH:MM format
        if (!/^\d{2}:\d{2}$/.test(originalDeliveryTime)) {
          try {
            const normalized = normalizeDeliveryTime(originalDeliveryTime);
            const col = String.fromCharCode(65 + deliveryTimeColIndex);
            updates.push({
              range: `${sheetName}!${col}${rowIndex}`,
              values: [[normalized]],
            });
            rowUpdated = true;
          } catch (error) {
            errorCount++;
          }
        } else {
          skippedCount++;
        }
      }
      
      if (rowUpdated) {
        updatedCount++;
      }
    }
    
    // Apply updates in batches (Google Sheets API limit: 100 updates per batch)
    if (updates.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            valueInputOption: 'RAW',
            data: batch,
          },
        });
      }
    }
    
    
    return { updated: updatedCount, skipped: skippedCount, errors: errorCount };
    
  } catch (error) {
    throw error;
  }
}

/**
 * Migrate all sheets (Orders, WaitingList, Reminders) date/time formats
 * @returns {Promise<Object>} Migration statistics for all sheets
 */
export async function migrateAllSheetsDateAndTime() {
  try {
    
    const results = {
      Orders: await migrateDateAndTimeFormats('Orders'),
      WaitingList: await migrateDateAndTimeFormats('WaitingList'),
      Reminders: await migrateDateAndTimeFormats('Reminders'),
    };
    
    Object.entries(results).forEach(([sheetName, stats]) => {
    });
    
    return results;
    
  } catch (error) {
    throw error;
  }
}

/**
 * Detect duplicate orders in a sheet (safety net)
 * Checks for multiple rows with the same order_id
 * @param {string} sheetName - Name of the sheet to check ('Orders' or 'WaitingList')
 * @returns {Promise<Array>} Array of duplicate order IDs with row numbers
 */
export async function detectDuplicateOrders(sheetName) {
  try {
    
    const headerMap = await getSheetHeaderMap(sheetName, { requireSnakeCase: false });
    const orderIdColumnIndex = headerMap.order_id;
    
    if (orderIdColumnIndex === undefined) {
      return [];
    }
    
    // Read all rows
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:${columnIndexToLetter(headerMap.__headersLength - 1)}`,
    });
    
    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return [];
    }
    
    // Count occurrences of each order_id
    const orderIdCounts = new Map(); // orderId -> [rowNumbers]
    
    for (let i = 1; i < rows.length; i++) {
      const orderId = rows[i][orderIdColumnIndex];
      if (orderId && orderId.trim()) {
        const rowNumber = i + 1; // 1-based
        if (!orderIdCounts.has(orderId)) {
          orderIdCounts.set(orderId, []);
        }
        orderIdCounts.get(orderId).push(rowNumber);
      }
    }
    
    // Find duplicates (order_id appears more than once)
    const duplicates = [];
    for (const [orderId, rowNumbers] of orderIdCounts.entries()) {
      if (rowNumbers.length > 1) {
        duplicates.push({
          orderId,
          count: rowNumbers.length,
          rows: rowNumbers,
        });
      }
    }
    
    if (duplicates.length === 0) {
    } else {
    }
    
    return duplicates;
  } catch (error) {
    throw error;
  }
}

/**
 * Report legacy Title Case columns in a sheet
 * This is a manual helper to identify columns that should be deleted
 * @param {string} sheetName - Name of the sheet to check
 * @returns {Promise<Object>} Report with legacy column information
 */
export async function reportLegacyTitleCaseColumns(sheetName) {
  try {
    
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!1:1`,
    });
    
    const headers = headerResponse.data.values?.[0] || [];
    const legacyColumns = [];
    
    headers.forEach((header, index) => {
      if (header && typeof header === 'string') {
        const trimmed = header.trim();
        if (isLegacyTitleCaseColumn(trimmed)) {
          legacyColumns.push({
            name: trimmed,
            index: index,
            letter: columnIndexToLetter(index),
          });
        }
      }
    });
    
    if (legacyColumns.length === 0) {
      return { sheetName, legacyColumns: [] };
    }
    
    legacyColumns.forEach(col => {
    });
    
    
    return {
      sheetName,
      legacyColumns,
      recommendation: `Delete columns ${legacyColumns.map(c => c.letter).join(', ')} (${legacyColumns.map(c => c.name).join(', ')})`,
    };
    
  } catch (error) {
    throw error;
  }
}
