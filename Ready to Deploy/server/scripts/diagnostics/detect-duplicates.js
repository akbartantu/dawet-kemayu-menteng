/**
 * Duplicate Order Detector
 * Detects duplicate orders (same order_id appears multiple times) in Google Sheets
 * 
 * Usage:
 *   node detect-duplicates.js [sheetName]
 * 
 * If sheetName is not provided, checks Orders sheet
 */

import { detectDuplicateOrders } from '../google-sheets.js';
import { SHEET_NAMES } from '../src/utils/constants.js';

const sheetName = process.argv[2] || null;

if (sheetName) {
  detectDuplicateOrders(sheetName)
    .then((duplicates) => {
      if (duplicates.length === 0) {
        process.exit(0);
      } else {
        duplicates.forEach(dup => {
        });
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('\n❌ Detection failed:', error.message);
      process.exit(1);
    });
} else {
  detectDuplicateOrders(SHEET_NAMES.ORDERS)
    .then((ordersDups) => {
      if (ordersDups.length === 0) {
        process.exit(0);
      } else {
        ordersDups.forEach(dup => {
          console.log(`⚠️ Duplicate order found: ${dup.order_id} (rows: ${dup.rows.join(', ')})`);
        });
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('\n❌ Detection failed:', error.message);
      process.exit(1);
    });
}
