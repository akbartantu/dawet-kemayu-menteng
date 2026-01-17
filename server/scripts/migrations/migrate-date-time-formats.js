/**
 * Migration Script: Normalize event_date and delivery_time formats in Google Sheets
 * 
 * This script updates all existing rows in Orders, WaitingList, and Reminders sheets
 * to normalize event_date to YYYY-MM-DD and delivery_time to HH:MM format.
 * 
 * Usage:
 *   node migrate-date-time-formats.js
 * 
 * WARNING: This will modify your Google Sheets. Make a backup first!
 * This script is safe and idempotent - it only updates rows that need normalization.
 */

/**
 * Migration Script: Normalize event_date and delivery_time formats in Google Sheets
 * 
 * This script updates all existing rows in Orders, WaitingList, and Reminders sheets
 * to normalize event_date to YYYY-MM-DD and delivery_time to HH:MM format.
 * 
 * Usage:
 *   node migrate-date-time-formats.js
 * 
 * WARNING: This will modify your Google Sheets. Make a backup first!
 * This script is safe and idempotent - it only updates rows that need normalization.
 */

import { migrateAllSheetsDateAndTime } from './google-sheets.js';

// Run migration
migrateAllSheetsDateAndTime()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration script failed:', error);
    process.exit(1);
  });
