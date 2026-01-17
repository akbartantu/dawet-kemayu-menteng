/**
 * Conversations Repository
 * Handles all conversation and message-related Google Sheets operations
 */

import { getSheetsClient, getSpreadsheetId, retryWithBackoff } from './sheets.client.js';

import { SHEET_NAMES } from '../utils/constants.js';

const MESSAGES_SHEET = SHEET_NAMES.MESSAGES;
const CONVERSATIONS_SHEET = SHEET_NAMES.CONVERSATIONS;

// Conversations sheet schema - ENFORCED COLUMN ORDER (MANDATORY)
const CONVERSATIONS_SCHEMA = [
  'conversation_id',
  'external_user_id',
  'platform_reference',
  'customer_name',
  'status',
  'first_seen_at',
  'last_message_at'
];

import { PLATFORMS } from '../utils/constants.js';

// Allowed platform reference values (validation)
const ALLOWED_PLATFORMS = [PLATFORMS.TELEGRAM, PLATFORMS.WHATSAPP];

// Messages sheet schema - ENFORCED COLUMN ORDER (MANDATORY)
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

/**
 * Get sheet ID by name (helper for batchUpdate operations)
 */
async function getSheetId(sheetName) {
  const sheets = getSheetsClient();
  const SPREADSHEET_ID = getSpreadsheetId();
  
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });
  const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
  return sheet?.properties.sheetId;
}

/**
 * Ensure Messages sheet has correct headers in row 1
 * This function is idempotent and safe to call multiple times
 */
async function ensureMessagesHeaders() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
    console.error('❌ Error ensuring Messages headers:', error.message);
    // Don't throw - allow system to continue
  }
}

/**
 * Ensure Conversations sheet has correct headers in row 1
 * This function is idempotent and safe to call multiple times
 */
async function ensureConversationsHeaders() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
    console.error('❌ Error ensuring Conversations headers:', error.message);
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
 * Save message to Google Sheets with strict schema enforcement
 */
export async function saveMessage(messageData) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
    console.error('❌ Error saving message to Google Sheets:', error.message);
    throw error;
  }
}

/**
 * Get all messages using strict schema (A:H columns)
 */
export async function getAllMessages(limit = 100) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
    console.error('❌ Error getting messages:', error.message);
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
    console.error('❌ Error getting conversation messages:', error.message);
    throw error;
  }
}

/**
 * Get or create conversation with strict schema enforcement
 * Schema: [conversation_id, external_user_id, platform_reference, customer_name, status, first_seen_at, last_message_at]
 */
export async function getOrCreateConversation(telegramChatId, fromName, fromId) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
    console.error('❌ Error getting/creating conversation:', error.message);
    throw error;
  }
}

/**
 * Get conversation by ID
 */
export async function getConversationById(conversationId) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
    console.error('❌ Error getting conversation by ID:', error.message);
    return null;
  }
}

/**
 * Get all conversations
 */
export async function getAllConversations(limit = 50) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
    console.error('❌ Error getting conversations:', error.message);
    throw error;
  }
}
