/**
 * Legacy Column Reporter
 * Reports Title Case columns that should be removed (legacy duplicates)
 * 
 * Usage:
 *   node report-legacy-columns.js [sheetName]
 * 
 * If sheetName is not provided, reports for all sheets (Orders, Reminders)
 */

import { reportLegacyTitleCaseColumns } from '../google-sheets.js';
import { SHEET_NAMES } from '../src/utils/constants.js';

const sheetName = process.argv[2] || null;

if (sheetName) {
  reportLegacyTitleCaseColumns(sheetName)
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Report failed:', error.message);
      process.exit(1);
    });
} else {
  Promise.all([
    reportLegacyTitleCaseColumns(SHEET_NAMES.ORDERS),
    reportLegacyTitleCaseColumns(SHEET_NAMES.REMINDERS),
  ])
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Report failed:', error.message);
      process.exit(1);
    });
}
