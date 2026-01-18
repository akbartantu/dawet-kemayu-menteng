/**
 * Price List Repository
 * Handles all price list-related Google Sheets operations
 */

import { getSheetsClient, getSpreadsheetId } from './sheets.client.js';

import { SHEET_NAMES } from '../utils/constants.js';

const PRICE_LIST_SHEET = SHEET_NAMES.PRICE_LIST;

/**
 * Get price list from Google Sheets
 */
export async function getPriceList() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Check if sheet exists
    try {
      await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${PRICE_LIST_SHEET}!A1:F1`,
      });
    } catch (error) {
      // Sheet doesn't exist, return empty object
      console.warn('⚠️ Price list sheet not found, returning empty price list');
      return {};
    }

    // Read extended range to support new schema (A-F columns)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${PRICE_LIST_SHEET}!A:F`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      console.warn('⚠️ Price list sheet has no data rows');
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
          console.warn(`⚠️ [PRICE_LIST] Skipping "${itemName}" - invalid price: ${unitPriceRaw}`);
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
          console.warn(`⚠️ [PRICE_LIST] Skipping "${itemName}" - invalid price: ${priceRaw}`);
          skippedCount++;
          continue;
        }
        
        priceList[itemName] = price;
        activeCount++;
      }
    }

    return priceList;
  } catch (error) {
    console.error('❌ Error getting price list:', error.message);
    console.error('❌ Stack:', error.stack);
    return {};
  }
}

/**
 * Initialize price list sheet with default prices
 */
export async function initializePriceList() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
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
    }
  } catch (error) {
    console.error('❌ Error initializing price list:', error.message);
    console.error('   Full error:', error);
    throw error;
  }
}
