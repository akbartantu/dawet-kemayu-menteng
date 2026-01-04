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
  console.log(`\n🔍 Reporting legacy Title Case columns for sheet: ${sheetName}\n`);
  reportLegacyTitleCaseColumns(sheetName)
    .then(() => {
      console.log('\n✅ Report completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Report failed:', error.message);
      process.exit(1);
    });
} else {
  console.log('\n🔍 Reporting legacy Title Case columns for all sheets\n');
  Promise.all([
    reportLegacyTitleCaseColumns('Orders'),
    reportLegacyTitleCaseColumns('WaitingList'),
    reportLegacyTitleCaseColumns('Reminders'),
  ])
    .then(() => {
      console.log('\n✅ Report completed for all sheets');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Report failed:', error.message);
      process.exit(1);
    });
}
