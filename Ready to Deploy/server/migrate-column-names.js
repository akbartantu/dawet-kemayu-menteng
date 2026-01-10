/**
 * Migration Script: Update Google Sheets Column Names to snake_case
 * 
 * This script updates all column headers in Orders, WaitingList, and Reminders sheets
 * from Title Case with spaces (e.g., "Order ID") to snake_case (e.g., "order_id").
 * 
 * Usage:
 *   node migrate-column-names.js
 * 
 * WARNING: This will modify your Google Sheets. Make a backup first!
 */

import { migrateAllSheetsToSnakeCase } from './google-sheets.js';

// Run migration
migrateAllSheetsToSnakeCase()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  });
