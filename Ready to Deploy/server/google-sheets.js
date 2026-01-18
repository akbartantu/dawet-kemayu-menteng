/**
 * Google Sheets Storage
 * BACKWARD COMPATIBILITY LAYER
 * 
 * This file re-exports all functions from the new modular repository structure
 * to maintain backward compatibility with existing code that imports from this file.
 * 
 * All actual implementations have been moved to:
 * - src/repos/orders.repo.js
 * - src/repos/conversations.repo.js
 * - src/repos/users.repo.js
 * - src/repos/price-list.repo.js
 * - src/repos/sheets.client.js
 * - src/utils/sheets-helpers.js
 * 
 * TODO: Update all imports to use the new repository files directly
 * TODO: Remove this file after all imports are updated
 */

// Re-export from sheets.client.js (for backward compatibility)
export { getSheetsClient as sheets, getSpreadsheetId as SPREADSHEET_ID, retryWithBackoff } from './src/repos/sheets.client.js';

// Re-export from sheets-helpers.js
export {
  normalizeOrderId,
  columnIndexToLetter,
  normalizeColumnName,
  getSheetHeaderMap,
  buildRowFromMap,
  validateRequiredKeys,
  invalidateHeaderCache,
} from './src/utils/sheets-helpers.js';

// Re-export from orders.repo.js
export {
  generateOrderId,
  ensureOrdersPaymentHeaders,
  findRowByOrderId,
  saveOrder,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  updateOrderPayment,
  updateOrderPaymentWithEvidence,
} from './src/repos/orders.repo.js';

// Re-export from conversations.repo.js
export {
  saveMessage,
  getAllMessages,
  getMessagesByConversation,
  getOrCreateConversation,
  getConversationById,
  getAllConversations,
} from './src/repos/conversations.repo.js';

// Re-export from users.repo.js
export {
  ensureUsersSheet,
  getUserRole,
  upsertUserRole,
  getAdminChatIds,
  invalidateAdminChatIdsCache,
} from './src/repos/users.repo.js';


// Re-export from price-list.repo.js
export {
  getPriceList,
  initializePriceList,
} from './src/repos/price-list.repo.js';

// Legacy functions that need to be kept for backward compatibility
// These will be moved to storage.repo.js in a future step

/**
 * Initialize Google Sheets (create headers if sheets don't exist)
 * This function orchestrates initialization of all sheets
 */
export async function initializeStorage() {
  const { ensureUsersSheet } = await import('./src/repos/users.repo.js');
  const { initializePriceList } = await import('./src/repos/price-list.repo.js');
  const conversationsRepo = await import('./src/repos/conversations.repo.js');
  const { ensureMessagesHeaders, ensureConversationsHeaders } = conversationsRepo;
  
  // Verify exports
  if (typeof ensureMessagesHeaders !== 'function') {
    throw new Error(`ensureMessagesHeaders is not a function. Type: ${typeof ensureMessagesHeaders}. Available exports: ${Object.keys(conversationsRepo).join(', ')}`);
  }
  if (typeof ensureConversationsHeaders !== 'function') {
    throw new Error(`ensureConversationsHeaders is not a function. Type: ${typeof ensureConversationsHeaders}`);
  }
  
  console.log('✅ [INIT] ensureMessagesHeaders type:', typeof ensureMessagesHeaders);
  console.log('✅ [INIT] ensureConversationsHeaders type:', typeof ensureConversationsHeaders);
  const { ensurePaymentHistorySheet } = await import('./src/repos/payment-history.repo.js');
  const { getSheetsClient, getSpreadsheetId } = await import('./src/repos/sheets.client.js');
  
  const sheets = getSheetsClient();
  const SPREADSHEET_ID = getSpreadsheetId();
  
  try {
    // Validate configuration first
    if (!SPREADSHEET_ID) {
      throw new Error('GOOGLE_SPREADSHEET_ID is not set in environment variables');
    }

    // Check if spreadsheet exists and create sheets if needed
    const getSpreadsheetPromise = sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Google Sheets API call timed out after 30 seconds')), 30000);
    });
    
    const spreadsheet = await Promise.race([getSpreadsheetPromise, timeoutPromise]);

    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
    console.log(`🔍 [INIT] Found ${existingSheets.length} existing sheet(s): ${existingSheets.join(', ')}`);

    // Track which sheets were just created
    let messagesSheetCreated = false;
    let conversationsSheetCreated = false;

    // Create Messages sheet if it doesn't exist
    const { SHEET_NAMES } = await import('./src/utils/constants.js');
    const MESSAGES_SHEET = SHEET_NAMES.MESSAGES;
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
    console.log('✅ [INIT] Messages headers initialized');

    // Create Conversations sheet if it doesn't exist
    const CONVERSATIONS_SHEET = SHEET_NAMES.CONVERSATIONS;
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
    console.log('✅ [INIT] Conversations headers initialized');

    // Initialize price list
    try {
      await initializePriceList();
      console.log('✅ [INIT] Price list initialized');
    } catch (error) {
      console.error('⚠️  Error initializing price list:', error.message);
      // Don't throw - continue without price list (optional)
    }

    // Initialize Users sheet
    try {
      await ensureUsersSheet();
      console.log('✅ [INIT] Users sheet initialized');
    } catch (error) {
      console.error('⚠️  Error initializing Users sheet:', error.message);
      // Don't throw - continue without Users sheet (optional)
    }

    // Initialize Payment_History sheet
    try {
      await ensurePaymentHistorySheet();
      console.log('✅ [INIT] Payment_History sheet initialized');
    } catch (error) {
      console.error('⚠️  Error initializing Payment_History sheet:', error.message);
      // Don't throw - continue without Payment_History sheet (optional)
    }

  } catch (error) {
    console.error('❌ Error initializing Google Sheets:', error.message);
    console.error('❌ [INIT] Stack:', error.stack);
    
    // Provide helpful error messages
    if (error.message.includes('timed out')) {
      console.error('⚠️  [INIT] Google Sheets API timed out. Check:');
      console.error('   1. Internet connection');
      console.error('   2. Google Service Account credentials');
      console.error('   3. Spreadsheet ID is correct');
      console.error('   4. Service account has access to the spreadsheet');
    } else if (error.message.includes('not set')) {
      console.error('⚠️  [INIT] Missing required environment variable');
    } else if (error.message.includes('404') || error.message.includes('not found')) {
      console.error('⚠️  [INIT] Spreadsheet not found. Check GOOGLE_SPREADSHEET_ID');
    } else if (error.message.includes('403') || error.message.includes('permission')) {
      console.error('⚠️  [INIT] Permission denied. Ensure service account has access to the spreadsheet');
    }
    
    throw error;
  }
}

/**
 * Mark reminder as sent for an order
 * DEPRECATED: This function is no longer used - reminders are handled by reminders.repo.js
 * Kept for backward compatibility only
 */
export async function markReminderSent(orderId) {
  console.warn(`⚠️ [DEPRECATED] markReminderSent() is deprecated. Reminders are handled by reminders.repo.js`);
      return false;
    }
    
// Migration functions - these will be moved to storage.repo.js in a future step
// For now, keep them here for backward compatibility

/**
 * Migrate sheet headers to snake_case format
 * TODO: Move to storage.repo.js
 */
export async function migrateSheetHeadersToSnakeCase(sheetName) {
  // Implementation kept in original file for now
  // TODO: Move to storage.repo.js
  console.warn('⚠️ migrateSheetHeadersToSnakeCase: This function needs to be moved to storage.repo.js');
  throw new Error('Not implemented - needs to be moved to storage.repo.js');
}

/**
 * Migrate all sheets to snake_case
 * TODO: Move to storage.repo.js
 */
export async function migrateAllSheetsToSnakeCase() {
  console.warn('⚠️ migrateAllSheetsToSnakeCase: This function needs to be moved to storage.repo.js');
  throw new Error('Not implemented - needs to be moved to storage.repo.js');
}

/**
 * Migrate date and time formats
 * TODO: Move to storage.repo.js
 */
export async function migrateDateAndTimeFormats(sheetName) {
  console.warn('⚠️ migrateDateAndTimeFormats: This function needs to be moved to storage.repo.js');
  throw new Error('Not implemented - needs to be moved to storage.repo.js');
}

/**
 * Migrate all sheets date and time formats
 * TODO: Move to storage.repo.js
 */
export async function migrateAllSheetsDateAndTime() {
  console.warn('⚠️ migrateAllSheetsDateAndTime: This function needs to be moved to storage.repo.js');
  throw new Error('Not implemented - needs to be moved to storage.repo.js');
}

/**
 * Detect duplicate orders
 * TODO: Move to storage.repo.js
 */
export async function detectDuplicateOrders(sheetName) {
  console.warn('⚠️ detectDuplicateOrders: This function needs to be moved to storage.repo.js');
  throw new Error('Not implemented - needs to be moved to storage.repo.js');
}

/**
 * Report legacy Title Case columns
 * TODO: Move to storage.repo.js
 */
export async function reportLegacyTitleCaseColumns(sheetName) {
  console.warn('⚠️ reportLegacyTitleCaseColumns: This function needs to be moved to storage.repo.js');
  throw new Error('Not implemented - needs to be moved to storage.repo.js');
}
