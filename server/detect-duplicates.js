/**
 * Duplicate Order Detector
 * Detects duplicate orders (same order_id appears multiple times) in Google Sheets
 * 
 * Usage:
 *   node detect-duplicates.js [sheetName]
 * 
 * If sheetName is not provided, checks both Orders and WaitingList
 */
import { detectDuplicateOrders } from './google-sheets.js';
const sheetName = process.argv[2] || null;
if (sheetName) {
  detectDuplicateOrders(sheetName)
    .then((duplicates) => {
      if (duplicates.length === 0) {
        process.exit(0);
      } else {
        :`);
        duplicates.forEach(dup => {
          }`);
        });
        process.exit(1);
      }
    })
    .catch((error) => {
      process.exit(1);
    });
} else {
  Promise.all([
    detectDuplicateOrders('Orders'),
    detectDuplicateOrders('WaitingList'),
  ])
    .then(([ordersDups, waitingListDups]) => {
      const totalDups = ordersDups.length + waitingListDups.length;
      if (totalDups === 0) {
        process.exit(0);
      } else {
        total:`);
        if (ordersDups.length > 0) {
          `);
          ordersDups.forEach(dup => {
            }`);
          });
        }
        if (waitingListDups.length > 0) {
          `);
          waitingListDups.forEach(dup => {
            }`);
          });
        }
        process.exit(1);
      }
    })
    .catch((error) => {
      process.exit(1);
    });
}
