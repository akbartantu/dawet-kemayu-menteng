/**
 * Users Repository
 * Handles all user-related Google Sheets operations
 */

import { getSheetsClient, getSpreadsheetId, retryWithBackoff } from './sheets.client.js';
import { columnIndexToLetter } from '../utils/sheets-helpers.js';

import { SHEET_NAMES } from '../utils/constants.js';

const USERS_SHEET = SHEET_NAMES.USERS;

// Users sheet schema - REQUIRED COLUMNS (in logical order)
const USERS_SCHEMA = [
  'user_id',
  'platform',
  'display_name',
  'role',
  'is_active',
  'created_at',
  'updated_at'
];

// Admin chat IDs cache (for reminder recipients)
const ADMIN_CHAT_IDS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let adminChatIdsCache = null; // { chatIds: number[], fetchedAtMs: number }
let adminChatIdsInflight = null; // Promise<number[]> (single-flight pattern)

/**
 * Ensure Users sheet exists with correct headers
 * Idempotent - safe to call multiple times
 */
export async function ensureUsersSheet() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
    console.error('❌ Error ensuring Users sheet:', error.message);
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
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
      console.warn('⚠️ Users sheet headers exist but may be out of order. Manual review recommended.');
      return;
    }

    // Append missing columns to the right
    console.log(`🔄 Adding ${missingColumns.length} missing column(s) to Users sheet...`);
    
    // Find the last column index
    const lastColumnIndex = existingHeaders.length;
    
    // Append missing headers starting from the next available column
    const headersToAppend = missingColumns.map(mc => mc.header);
    
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

    console.log(`✅ Added missing columns to Users sheet: ${headersToAppend.join(', ')}`);
  } catch (error) {
    console.error('❌ Error ensuring Users headers:', error.message);
    throw error;
  }
}

/**
 * Get user role from Users sheet
 */
export async function getUserRole(platform, userId) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
    console.error('❌ Error getting user role:', error.message);
    return null;
  }
}

/**
 * Upsert user role in Users sheet
 */
export async function upsertUserRole(platform, userId, displayName, role, isActive = true) {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
    
    if (userRowIndex > 0) {
      // UPDATE existing user - update all columns that exist
      const endColumn = columnIndexToLetter(rowData.length - 1);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A${userRowIndex}:${endColumn}${userRowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [rowData],
        },
      });
      
      // Invalidate admin cache if role changed
      invalidateAdminChatIdsCache();
    } else {
      // INSERT new user
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${USERS_SHEET}!A:Z`, // Append to wide range to handle variable columns
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [rowData],
        },
      });
      
      // Invalidate admin cache
      invalidateAdminChatIdsCache();
    }
  } catch (error) {
    console.error('❌ Error upserting user role:', error.message);
    throw error;
  }
}

/**
 * Get all admin chat IDs (cached)
 * Returns array of Telegram chat IDs for users with role='admin' and platform='telegram'
 */
export async function getAdminChatIds() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Check cache first
    const now = Date.now();
    if (adminChatIdsCache && (now - adminChatIdsCache.fetchedAtMs) < ADMIN_CHAT_IDS_CACHE_TTL_MS) {
      console.log(`[ADMIN_RECIPIENTS] Using cached admin chat IDs (age: ${Math.round((now - adminChatIdsCache.fetchedAtMs) / 1000)}s)`);
      return adminChatIdsCache.chatIds;
    }
    
    // Single-flight: if a fetch is in progress, await the same promise
    if (adminChatIdsInflight) {
      return await adminChatIdsInflight;
    }
    
    // Start fetch
    const fetchPromise = (async () => {
      try {
        await ensureUsersSheet();
        
        // Read Users sheet ONCE
        const response = await retryWithBackoff(async () => {
          return await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${USERS_SHEET}!A:Z`,
          });
        });
        
        const rows = response.data.values || [];
        if (rows.length <= 1) {
          // Only headers, no users
          const result = [];
          adminChatIdsCache = { chatIds: result, fetchedAtMs: Date.now() };
          console.log(`[ADMIN_RECIPIENTS] count=0 (no users in sheet)`);
          return result;
        }
        
        // Map headers to column indices
        const headerRow = rows[0] || [];
        const headerMap = {};
        headerRow.forEach((header, index) => {
          const headerLower = String(header).toLowerCase().trim();
          headerMap[headerLower] = index;
        });
        
        const userIdCol = headerMap['user_id'] ?? 0;
        const platformCol = headerMap['platform'] ?? 1;
        const roleCol = headerMap['role'] ?? 3;
        const isActiveCol = headerMap['is_active'] ?? 4;
        
        // Filter admin users
        const chatIds = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          
          const userId = row[userIdCol];
          const platform = String(row[platformCol] || '').toLowerCase().trim();
          const role = String(row[roleCol] || '').toLowerCase().trim();
          const isActiveValue = row[isActiveCol];
          const isActive = isActiveValue === 'TRUE' || 
                          isActiveValue === true || 
                          isActiveValue === 'true' ||
                          isActiveValue === '' ||
                          isActiveValue === undefined ||
                          isActiveValue === null; // Default to true if empty/missing
          
          // Filter: platform == "telegram", role == "admin", is_active == true
          if (platform === 'telegram' && role === 'admin' && isActive) {
            // Validate user_id is numeric
            const userIdStr = String(userId || '').trim();
            if (!userIdStr) continue; // Skip empty user_id
            
            const chatId = parseInt(userIdStr);
            if (isNaN(chatId)) {
              console.warn(`⚠️ [ADMIN_RECIPIENTS] Invalid user_id (non-numeric): "${userIdStr}" in row ${i + 1}, skipping`);
              continue;
            }
            
            chatIds.push(chatId);
          }
        }
        
        // Cache result
        adminChatIdsCache = { chatIds, fetchedAtMs: Date.now() };

        return chatIds;
      } finally {
        // Clear inflight promise
        adminChatIdsInflight = null;
      }
    })();
    
    // Store inflight promise
    adminChatIdsInflight = fetchPromise;
    
    return await fetchPromise;
  } catch (error) {
    console.error('❌ [ADMIN_RECIPIENTS] Error getting admin chat IDs:', error.message);
    adminChatIdsInflight = null; // Clear on error
    // Return empty array on error (fail gracefully)
    return [];
  }
}

/**
 * Invalidate admin chat IDs cache (call if Users sheet is updated)
 */
export function invalidateAdminChatIdsCache() {
  adminChatIdsCache = null;
}
