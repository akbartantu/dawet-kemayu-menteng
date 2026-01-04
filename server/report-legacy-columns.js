/**
 * Legacy Column Reporter
 * Reports Title Case columns that should be removed (legacy duplicates)
 * 
 * Usage:
 *   node report-legacy-columns.js [sheetName]
 * 
 * If sheetName is not provided, reports for all sheets (Orders, WaitingList, Reminders)
 */

import { reportLegacyTitleCaseColumns } from './google-sheets.js';

const sheetName = process.argv[2] || null;

if (sheetName) {
  reportLegacyTitleCaseColumns(sheetName)
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      process.exit(1);
    });
} else {
  Promise.all([
    reportLegacyTitleCaseColumns('Orders'),
    reportLegacyTitleCaseColumns('WaitingList'),
    reportLegacyTitleCaseColumns('Reminders'),
  ])
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      process.exit(1);
    });
}
