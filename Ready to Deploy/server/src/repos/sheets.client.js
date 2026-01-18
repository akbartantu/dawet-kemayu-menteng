/**
 * Google Sheets Client
 * Shared authentication and client setup for all repository modules
 */

import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file only in local development (not on Render)
// On Render, environment variables are provided directly by the platform
if (process.env.NODE_ENV !== 'production' || !process.env.RENDER) {
  // Try to load .env from server root (for local development)
  const envPath = path.resolve(__dirname, '../../.env');
  dotenv.config({ path: envPath });
}

// Google Sheets API setup
// Support both file-based (Render Secret Files) and environment variable-based authentication
let auth;
const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

let rawJson;
let authMethod;

if (keyFile) {
  // Render Secret File or local file: Read file and parse JSON
  authMethod = 'file';
  let keyFileAbsolute;
  
  if (keyFile.startsWith('./server/')) {
    // Remove ./server/ prefix and resolve from server root
    const relativePath = keyFile.replace('./server/', '');
    const serverRoot = path.resolve(__dirname, '../..'); // Go up from src/repos/ to server/
    keyFileAbsolute = path.resolve(serverRoot, relativePath);
  } else if (keyFile.startsWith('./')) {
    // Relative path, resolve from server root
    const serverRoot = path.resolve(__dirname, '../..'); // Go up from src/repos/ to server/
    keyFileAbsolute = path.resolve(serverRoot, keyFile.replace('./', ''));
  } else {
    // Absolute path (e.g., /etc/secrets/service-account.json on Render) or path relative to current working directory
    keyFileAbsolute = path.isAbsolute(keyFile) 
      ? keyFile 
      : path.resolve(process.cwd(), keyFile);
  }
  
  try {
    rawJson = fs.readFileSync(keyFileAbsolute, 'utf8');
    console.log(`✅ [GOOGLE_AUTH] Using service account key from file: ${keyFileAbsolute}`);
  } catch (error) {
    throw new Error(`Failed to read service account key file at ${keyFileAbsolute}: ${error.message}`);
  }
} else if (keyJson) {
  // Environment variable: Parse JSON string directly
  authMethod = 'env';
  rawJson = keyJson;
  console.log(`✅ [GOOGLE_AUTH] Using service account key from environment variable`);
} else {
  throw new Error('Either GOOGLE_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_KEY must be set');
}

// Parse JSON and normalize private_key newlines
let serviceAccountKey;
try {
  serviceAccountKey = JSON.parse(rawJson);
} catch (error) {
  throw new Error(`Failed to parse service account key JSON (method: ${authMethod}): ${error.message}`);
}

// Normalize private_key: convert \\n to \n (handles Render's escaped newlines)
if (serviceAccountKey.private_key) {
  serviceAccountKey.private_key = serviceAccountKey.private_key.replace(/\\n/g, '\n');
}

// Create Google Auth instance
auth = new google.auth.GoogleAuth({
  credentials: serviceAccountKey,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// Spreadsheet ID from .env
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

// Validate Google Sheets configuration on module load
if (!SPREADSHEET_ID) {
  console.warn('⚠️  GOOGLE_SPREADSHEET_ID not set. Google Sheets features will not work.');
}

/**
 * Get the Google Sheets API client instance
 * @returns {Object} Google Sheets API client
 */
export function getSheetsClient() {
  return sheets;
}

/**
 * Get the spreadsheet ID
 * @returns {string} Spreadsheet ID
 */
export function getSpreadsheetId() {
  return SPREADSHEET_ID;
}

/**
 * Retry wrapper for Google Sheets API calls with exponential backoff
 * Handles 429 rate limit errors gracefully
 */
export async function retryWithBackoff(fn, maxAttempts = 5) {
  let attempt = 0;
  const baseDelay = 500; // 500ms base delay
  
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      
      // Check if it's a rate limit error (429)
      const isRateLimit = error.code === 429 || 
                         error.message?.includes('rateLimitExceeded') ||
                         error.message?.includes('429') ||
                         (error.response?.status === 429);
      
      if (!isRateLimit || attempt >= maxAttempts) {
        // Not a rate limit error, or max attempts reached
        if (isRateLimit && attempt >= maxAttempts) {
          // Transform final rate limit error to user-friendly message
          const userError = new Error('⚠️ Sistem sedang kena limit Google Sheets (429). Coba lagi 1–2 menit ya.');
          userError.isRateLimit = true;
          throw userError;
        }
        throw error; // Re-throw non-rate-limit errors
      }
      
      // Calculate backoff: 500ms, 1000ms, 2000ms, 4000ms, 8000ms
      const delay = baseDelay * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 250; // Random jitter up to 250ms
      const totalDelay = delay + jitter;
      
      // Check for Retry-After header
      const retryAfter = error.response?.headers?.['retry-after'];
      const finalDelay = retryAfter ? parseInt(retryAfter) * 1000 : totalDelay;
      
      console.warn(`⚠️ [RETRY] Rate limit (429) on attempt ${attempt}/${maxAttempts}, waiting ${Math.round(finalDelay)}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, finalDelay));
    }
  }
}
