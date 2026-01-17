/**
 * Google Sheets Helper Utilities
 * Header mapping, column utilities, and validation functions
 */

import { getSheetsClient, getSpreadsheetId, retryWithBackoff } from '../repos/sheets.client.js';

// Header map cache to reduce READ requests (fix 429 rate limit)
const HEADER_MAP_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const headerMapCache = new Map(); // key: sheetName, value: { headerMap, fetchedAtMs }
const headerMapInflight = new Map(); // key: sheetName, value: Promise<headerMap> (single-flight pattern)

/**
 * Invalidate header cache for a sheet (call if header mismatch detected)
 * @param {string} sheetName - Sheet name to invalidate
 */
export function invalidateHeaderCache(sheetName) {
  headerMapCache.delete(sheetName);
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
  shipping_method: ['Shipping Method', 'shipping_method', 'shippingmethod', 'Delivery Method', 'deliverymethod'],
  delivery_method: ['delivery_method', 'Delivery Method', 'deliverymethod', 'Shipping Method', 'shipping_method', 'shippingmethod'],
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
  // Reminder fields (formerly WaitingList)
  calendar_event_id: ['Calendar Event ID', 'calendar_event_id', 'calendareventid'],
  // Reminder ID (for Reminders sheet)
  reminder_id: ['Reminder ID', 'reminder_id', 'reminderid'],
  sent_at: ['Sent At', 'sent_at', 'sentat'],
  attempts: ['Attempts', 'attempts'],
  last_attempt_at: ['Last Attempt At', 'last_attempt_at', 'lastattemptat'],
  notes: ['Notes', 'notes'],
  // Payment_History sheet fields
  payment_id: ['Payment ID', 'payment_id', 'paymentid'],
  payment_date: ['Payment Date', 'payment_date', 'paymentdate'],
  payment_method: ['Payment Method', 'payment_method', 'paymentmethod'],
  amount_input: ['Amount Input', 'amount_input', 'amountinput'],
  amount_confirmed: ['Amount Confirmed', 'amount_confirmed', 'amountconfirmed'],
  currency: ['Currency', 'currency'],
  proof_file_id: ['Proof File ID', 'proof_file_id', 'prooffileid'],
  proof_caption: ['Proof Caption', 'proof_caption', 'proofcaption'],
  created_by: ['Created By', 'created_by', 'createdby'],
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
 * 
 * CACHED: Uses in-memory cache with 10-minute TTL to reduce READ requests (fix 429)
 * SINGLE-FLIGHT: Deduplicates concurrent requests for same sheet
 * 
 * @param {string} sheetName - Name of the sheet
 * @param {Object} options - Options: { requireSnakeCase: boolean, sheetType: 'Orders' | 'Reminders' }
 * @returns {Object} Map of { internal_key: columnIndex, __headersLength: number }
 * @throws {Error} If required snake_case columns are missing
 */
export async function getSheetHeaderMap(sheetName, options = {}) {
  try {
    const { requireSnakeCase = true, sheetType = null } = options;
    const cacheKey = `${sheetName}_${JSON.stringify(options)}`;
    
    // Check cache first
    const cached = headerMapCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.fetchedAtMs) < HEADER_MAP_CACHE_TTL_MS) {
      return cached.headerMap;
    }
    
    // Single-flight: If a fetch is already in progress, await the same promise
    if (headerMapInflight.has(cacheKey)) {
      return await headerMapInflight.get(cacheKey);
    }
    
    // Start fetch
    const fetchPromise = (async () => {
      try {
        const sheets = getSheetsClient();
        const SPREADSHEET_ID = getSpreadsheetId();

        // Read row 1 with explicit wide range to ensure all columns are included
        const headerResponse = await retryWithBackoff(async () => {
          return await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A1:ZZ1`, // Wide range to ensure all columns are read
          });
        });
        
        const headers = headerResponse.data.values?.[0] || [];
        
        const headerTextMap = {}; // headerText -> index
        const legacyColumns = []; // Track legacy Title Case columns
        
        // Build lookup: header text -> column index
        headers.forEach((header, index) => {
          const normalized = String(header || '').trim();
          
          if (normalized) {
            if (headerTextMap[normalized] !== undefined) {
              console.warn(`⚠️ [HEADER_MAP] Duplicate header "${normalized}" at index ${index}, using first occurrence at ${headerTextMap[normalized]}`);
            } else {
              headerTextMap[normalized] = index;
            }
            
            // Track legacy Title Case columns
            if (isLegacyTitleCaseColumn(normalized)) {
              legacyColumns.push({ name: normalized, index, letter: columnIndexToLetter(index) });
            }
          }
        });
        
        // Log legacy columns if found
        if (legacyColumns.length > 0) {
          console.warn(`⚠️ [HEADER_MAP] Legacy Title Case columns detected in ${sheetName}:`, 
            legacyColumns.map(c => `${c.letter}: "${c.name}"`).join(', '));
          console.warn(`⚠️ [HEADER_MAP] These columns will be IGNORED. Use snake_case columns instead.`);
        }
        
        // Map internal keys to column indices using aliases
        const headerMap = {};
        const missingKeys = [];
        const missingSnakeCaseKeys = [];
        
        for (const [internalKey, aliases] of Object.entries(HEADER_ALIASES)) {
          let found = false;
          let foundColumnName = null;
          
          for (const alias of aliases) {
            const normalizedAlias = String(alias || '').trim();
            
            if (normalizedAlias && headerTextMap[normalizedAlias] !== undefined) {
              // Check if this is a legacy Title Case column for pricing/payment fields
              if (isLegacyTitleCaseColumn(normalizedAlias)) {
                console.error(`❌ [HEADER_MAP] Attempted to map legacy Title Case column "${alias}" for ${internalKey}`);
                console.error(`❌ [HEADER_MAP] This is not allowed. snake_case columns must be used.`);
                throw new Error(`Cannot use legacy Title Case column "${alias}" for ${internalKey}. Use snake_case column instead.`);
              }
              
              headerMap[internalKey] = headerTextMap[normalizedAlias];
              foundColumnName = normalizedAlias;
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
          }
        }
        
        // For Payment_History sheet (when requireSnakeCase=false), also try direct normalization
        // This allows columns to be found even if not in HEADER_ALIASES
        if (!requireSnakeCase && sheetType === 'Payment_History') {
          for (const [headerText, columnIndex] of Object.entries(headerTextMap)) {
            const normalized = normalizeColumnName(headerText);
            // Only add if not already mapped (avoid overwriting aliases)
            if (normalized && headerMap[normalized] === undefined) {
              headerMap[normalized] = columnIndex;
            }
          }
        }
        
        // Store headers length for range calculations
        headerMap.__headersLength = headers.length;
        
        // Enforce snake_case requirement for pricing/payment fields
        if (requireSnakeCase && missingSnakeCaseKeys.length > 0) {
          const errorMsg = `Missing required snake_case columns in ${sheetName}: ${missingSnakeCaseKeys.join(', ')}. ` +
            `These columns are mandatory and must use snake_case format (e.g., "product_total", not "Product Total"). ` +
            `Available headers: ${Object.keys(headerTextMap).join(', ')}`;
          console.error(`❌ [HEADER_MAP] ${errorMsg}`);
          throw new Error(errorMsg);
        }
        
        if (missingKeys.length > 0 && missingSnakeCaseKeys.length === 0) {
          // Only warn about non-critical missing keys
          console.warn(`⚠️ [HEADER_MAP] Missing optional keys in ${sheetName}:`, missingKeys);
        }
        
        const result = {
          ...headerMap,
          __headersLength: headers.length,
          __rawHeaders: headers,
          __headerTextMap: headerTextMap,
          __legacyColumns: legacyColumns,
        };
        
        // Cache the result
        headerMapCache.set(cacheKey, {
          headerMap: result,
          fetchedAtMs: now,
        });
        
        return result;
      } finally {
        // Remove from inflight map
        headerMapInflight.delete(cacheKey);
      }
    })();
    
    // Store promise for single-flight deduplication
    headerMapInflight.set(cacheKey, fetchPromise);
    
    return await fetchPromise;
  } catch (error) {
    console.error(`❌ [HEADER_MAP] Error reading headers from ${sheetName}:`, error.message);
    if (error.isRateLimit) {
      throw error;
    }
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
      // Convert to string for Google Sheets (handles arrays/objects via JSON.stringify)
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        row[columnIndex] = JSON.stringify(value);
      } else {
        row[columnIndex] = String(value);
      }
    }
  }
  
  return row;
}

/**
 * Validate required keys exist in header map
 * @param {Object} headerMap - Header map from getSheetHeaderMap()
 * @param {Array<string>} requiredKeys - Array of required snake_case keys
 * @param {string} sheetName - Sheet name for error messages
 * @throws {Error} If any required keys are missing
 */
export function validateRequiredKeys(headerMap, requiredKeys, sheetName) {
  const missingKeys = requiredKeys.filter(key => headerMap[key] === undefined);
  
  if (missingKeys.length > 0) {
    const errorMsg = `Missing required columns in ${sheetName}: ${missingKeys.join(', ')}`;
    console.error(`❌ [VALIDATE] ${errorMsg}`);
    throw new Error(errorMsg);
  }
}
