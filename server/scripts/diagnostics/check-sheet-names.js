/**
 * Check Sheet Names
 * Lists all sheet names in the Google Spreadsheet and compares with expected names
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from On Production root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getSheetsClient, getSpreadsheetId } from '../../src/repos/sheets.client.js';
import { SHEET_NAMES } from '../../src/utils/constants.js';

async function checkSheetNames() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    if (!SPREADSHEET_ID) {
      console.error('❌ GOOGLE_SPREADSHEET_ID not set in .env file');
      process.exit(1);
    }
    
    console.log('📊 Checking sheet names in spreadsheet:', SPREADSHEET_ID);
    console.log('');
    
    // Get all sheets
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });
    
    const actualSheetNames = response.data.sheets.map(s => s.properties.title);
    
    console.log('✅ Actual sheet names in spreadsheet:');
    actualSheetNames.forEach(name => {
      console.log(`   - "${name}"`);
    });
    console.log('');
    
    console.log('📋 Expected sheet names (from constants):');
    Object.entries(SHEET_NAMES).forEach(([key, value]) => {
      const exists = actualSheetNames.includes(value);
      const status = exists ? '✅' : '❌';
      console.log(`   ${status} ${key}: "${value}"`);
    });
    console.log('');
    
    // Check for mismatches
    const missingSheets = [];
    Object.entries(SHEET_NAMES).forEach(([key, value]) => {
      if (!actualSheetNames.includes(value)) {
        missingSheets.push({ key, name: value });
      }
    });
    
    const extraSheets = actualSheetNames.filter(name => 
      !Object.values(SHEET_NAMES).includes(name)
    );
    
    if (missingSheets.length > 0) {
      console.log('⚠️  Missing sheets (expected but not found):');
      missingSheets.forEach(({ key, name }) => {
        console.log(`   - ${key}: "${name}"`);
      });
      console.log('');
    }
    
    if (extraSheets.length > 0) {
      console.log('ℹ️  Extra sheets (found but not in constants):');
      extraSheets.forEach(name => {
        console.log(`   - "${name}"`);
      });
      console.log('');
    }
    
    if (missingSheets.length === 0 && extraSheets.length === 0) {
      console.log('✅ All sheet names match!');
    }
    
  } catch (error) {
    console.error('❌ Error checking sheet names:', error.message);
    if (error.message.includes('quota')) {
      console.error('⚠️  Google Sheets API quota exceeded. Please wait a minute and try again.');
    }
    process.exit(1);
  }
}

checkSheetNames();
