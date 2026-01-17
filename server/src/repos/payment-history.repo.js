/**
 * Payment History Repository
 * Handles all Payment_History sheet operations
 * Payment_History is the source of truth for all payments
 */

import logger from '../utils/logger.js';
import { getSheetsClient, getSpreadsheetId, retryWithBackoff } from './sheets.client.js';
import {
  getSheetHeaderMap,
  buildRowFromMap,
  validateRequiredKeys,
  columnIndexToLetter,
} from '../utils/sheets-helpers.js';
import { SHEET_NAMES } from '../utils/constants.js';
import { parseIDRAmount } from '../services/payment-tracker.js';

const PAYMENT_HISTORY_SHEET = SHEET_NAMES.PAYMENT_HISTORY;

/**
 * All columns for Payment_History sheet (for header creation)
 * payment_id and payment_date are auto-generated but columns must exist
 * proof_file_id and proof_caption are optional but columns should exist
 */
const ALL_COLUMNS = [
  'payment_id',
  'order_id',
  'payment_date',
  'payment_method',
  'amount_input',
  'amount_confirmed',
  'currency',
  'status',
  'note',
  'proof_file_id',
  'proof_caption',
  'created_by',
  'created_at',
  'updated_at',
];

/**
 * Required columns for Payment_History sheet (for validation)
 * Note: payment_id and payment_date are auto-generated, so they're not in required list
 * Note: proof_file_id and proof_caption are optional
 */
const REQUIRED_COLUMNS = [
  'order_id',
  'payment_method',
  'amount_input',
  'amount_confirmed',
  'currency',
  'status',
  'note',
  'created_by',
  'created_at',
  'updated_at',
];

/**
 * Generate unique payment ID
 * Format: PAY/YYYYMMDD/HHMMSS/RANDOM (matches existing format)
 * Example: PAY/20260110/065129/2615
 */
export function generatePaymentId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  
  return `PAY/${year}${month}${day}/${hours}${minutes}${seconds}/${random}`;
}

/**
 * Ensure Payment_History sheet exists and has required headers
 */
export async function ensurePaymentHistorySheet() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Get spreadsheet to check existing sheets
    const spreadsheet = await retryWithBackoff(async () => {
      return await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });
    });
    
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
    
    if (!existingSheets.includes(PAYMENT_HISTORY_SHEET)) {
      // Create Payment_History sheet
      await retryWithBackoff(async () => {
        return await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: [{
              addSheet: {
                properties: {
                  title: PAYMENT_HISTORY_SHEET,
                },
              },
            }],
          },
        });
      });
      
      logger.info(`✅ [PAYMENT_HISTORY] Created ${PAYMENT_HISTORY_SHEET} sheet`);
    }
    
    // Verify headers exist (don't create new columns - use existing ones)
    // Note: Payment_History doesn't need Orders sheet columns, so we don't use requireSnakeCase
    const headerMap = await getSheetHeaderMap(PAYMENT_HISTORY_SHEET, { requireSnakeCase: false, sheetType: 'Payment_History' });
    
    // Just log available headers for debugging (don't try to add missing ones)
    logger.info(`✅ [PAYMENT_HISTORY] Sheet exists with headers: ${Object.keys(headerMap).filter(k => !k.startsWith('__')).join(', ')}`);
  } catch (error) {
    logger.error(`❌ [PAYMENT_HISTORY] Error ensuring sheet:`, error.message);
    throw error;
  }
}

/**
 * Create a payment record in Payment_History
 * @param {Object} paymentData - Payment data
 * @param {string} paymentData.order_id - Order ID
 * @param {number} paymentData.amount_input - Raw input amount (string or number)
 * @param {number} paymentData.amount_confirmed - Confirmed amount (after "Y" confirmation, equals amount_input)
 * @param {string} paymentData.payment_method - Payment method: 'manual' (for /pay without photo) or 'transfer' (default: 'transfer')
 * @param {string} paymentData.status - Status: 'confirmed' | 'rejected' | 'pending_review'
 * @param {string} paymentData.currency - Currency (default: 'IDR')
 * @param {string} paymentData.note - Note (auto-filled: "Pembayaran manual entry by admin\nDikonfirmasi oleh admin (user XXX)")
 * @param {string} paymentData.proof_file_id - Optional proof file ID
 * @param {string} paymentData.proof_caption - Optional proof caption
 * @param {string} paymentData.created_by - User ID (auto-filled from userId)
 * @returns {Promise<Object>} Created payment record
 */
export async function createPaymentRecord(paymentData) {
  try {
    await ensurePaymentHistorySheet();
    
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Generate payment ID
    const paymentId = generatePaymentId();
    
    // Normalize amounts
    let amountInput = paymentData.amount_input;
    if (typeof amountInput === 'string') {
      const parsed = parseIDRAmount(amountInput);
      amountInput = parsed !== null ? parsed : 0;
    }
    
    let amountConfirmed = paymentData.amount_confirmed;
    if (typeof amountConfirmed === 'string') {
      const parsed = parseIDRAmount(amountConfirmed);
      amountConfirmed = parsed !== null ? parsed : amountInput;
    }
    
    // If amount_confirmed not provided, use amount_input
    if (!amountConfirmed || amountConfirmed === 0) {
      amountConfirmed = amountInput;
    }
    
    // Prepare payment record
    // payment_id and payment_date are auto-generated
    const now = new Date();
    const paymentRecord = {
      payment_id: paymentId, // Auto-generated: PAY/YYYYMMDD/HHMMSS/RANDOM
      order_id: paymentData.order_id,
      payment_date: paymentData.payment_date || now.toISOString(), // Auto-generated as ISO string
      payment_method: paymentData.payment_method || 'transfer', // 'manual' or 'transfer'
      amount_input: amountInput,
      amount_confirmed: amountConfirmed, // After "Y" confirmation, equals amount_input
      currency: paymentData.currency || 'IDR', // Default: IDR
      status: paymentData.status || 'confirmed', // Use 'confirmed' instead of 'approved'
      note: paymentData.note || '', // Auto-filled: "Pembayaran manual entry by admin\nDikonfirmasi oleh admin (user XXX)"
      proof_file_id: paymentData.proof_file_id || '', // Optional
      proof_caption: paymentData.proof_caption || '', // Optional
      created_by: paymentData.created_by || '', // Auto-filled with user_id
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    
    // Get header map (use existing columns, don't create new ones)
    // Note: Payment_History doesn't need Orders sheet columns, so we don't use requireSnakeCase
    const headerMap = await getSheetHeaderMap(PAYMENT_HISTORY_SHEET, { requireSnakeCase: false, sheetType: 'Payment_History' });
    
    // Validate required keys exist (but don't create new columns - use existing ones)
    const missingRequired = REQUIRED_COLUMNS.filter(col => headerMap[col] === undefined);
    if (missingRequired.length > 0) {
      logger.error(`❌ [PAYMENT_HISTORY] Missing required columns: ${missingRequired.join(', ')}`);
      throw new Error(`Missing required columns in Payment_History: ${missingRequired.join(', ')}`);
    }
    
    // Build row
    const row = buildRowFromMap(headerMap, paymentRecord);
    
    // Append to sheet
    const lastColumn = columnIndexToLetter(headerMap.__headersLength - 1);
    await retryWithBackoff(async () => {
      return await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${PAYMENT_HISTORY_SHEET}!A:${lastColumn}`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [row],
        },
      });
    });
    
    logger.info(`✅ [PAYMENT_HISTORY] Created payment record: ${paymentId} for order: ${paymentData.order_id}`);
    
    return paymentRecord;
  } catch (error) {
    logger.error(`❌ [PAYMENT_HISTORY] Error creating payment record:`, error.message);
    throw error;
  }
}

/**
 * Get all payment records for an order
 * @param {string} orderId - Order ID
 * @returns {Promise<Array>} Array of payment records
 */
export async function getPaymentsByOrderId(orderId) {
  try {
    await ensurePaymentHistorySheet();
    
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Note: Payment_History doesn't need Orders sheet columns, so we don't use requireSnakeCase
    const headerMap = await getSheetHeaderMap(PAYMENT_HISTORY_SHEET, { requireSnakeCase: false, sheetType: 'Payment_History' });
    
    // Read all rows
    const lastColumn = columnIndexToLetter(headerMap.__headersLength - 1);
    const response = await retryWithBackoff(async () => {
      return await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${PAYMENT_HISTORY_SHEET}!A:${lastColumn}`,
      });
    });
    
    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return []; // No data rows
    }
    
    // Filter by order_id
    const orderIdColIndex = headerMap.order_id;
    if (orderIdColIndex === undefined) {
      throw new Error('order_id column not found in Payment_History sheet');
    }
    
    const payments = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowOrderId = row[orderIdColIndex];
      
      if (rowOrderId && String(rowOrderId).trim() === String(orderId).trim()) {
        // Build payment object
        const getValue = (key, defaultValue = '') => {
          const colIndex = headerMap[key];
          if (colIndex === undefined) return defaultValue;
          return row[colIndex] !== undefined && row[colIndex] !== '' ? row[colIndex] : defaultValue;
        };
        
        payments.push({
          payment_id: getValue('payment_id'),
          order_id: getValue('order_id'),
          payment_date: getValue('payment_date'),
          payment_method: getValue('payment_method'),
          amount_input: parseFloat(getValue('amount_input', '0')) || 0,
          amount_confirmed: parseFloat(getValue('amount_confirmed', '0')) || 0,
          currency: getValue('currency', 'IDR'),
          status: getValue('status', 'approved'),
          note: getValue('note'),
          proof_file_id: getValue('proof_file_id'),
          proof_caption: getValue('proof_caption'),
          created_by: getValue('created_by'),
          created_at: getValue('created_at'),
          updated_at: getValue('updated_at'),
        });
      }
    }
    
    return payments;
  } catch (error) {
    logger.error(`❌ [PAYMENT_HISTORY] Error getting payments for order ${orderId}:`, error.message);
    throw error;
  }
}
