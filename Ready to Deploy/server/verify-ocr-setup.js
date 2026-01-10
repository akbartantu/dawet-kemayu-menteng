#!/usr/bin/env node
/**
 * OCR Setup Verification Script
 * 
 * Verifies that all OCR dependencies are installed and working correctly
 */

console.log('='.repeat(60));

let allPassed = true;

// Check 1: Sharp

try {
  const sharp = await import('sharp');


} catch (error) {


  allPassed = false;
}

// Check 2: Tesseract.js

try {
  const tesseract = await import('tesseract.js');

} catch (error) {


  allPassed = false;
}

// Check 3: OCR Service

try {
  const ocrService = await import('./services/ocr-service.js');





} catch (error) {


  allPassed = false;
}

// Check 4: Admin Bot Commands

try {
  const adminCommands = await import('./admin-bot-commands.js');

} catch (error) {


  allPassed = false;
}

// Check 5: Debug Tool

try {
  const fs = await import('fs/promises');
  await fs.access('./tools/ocr-debug.js');


} catch (error) {

  allPassed = false;
}

// Check 6: Documentation

try {
  const fs = await import('fs/promises');
  const docs = [
    'README-OCR.md',
    'docs/ocr-pipeline.md',
    'CHANGELOG-OCR.md',
    'OCR-UPGRADE-SUMMARY.md',
    'OCR-QUICK-REFERENCE.md'
  ];
  
  let docsFound = 0;
  for (const doc of docs) {
    try {
      await fs.access(doc);
      docsFound++;
    } catch {}
  }

  if (docsFound < docs.length) {

  }
} catch (error) {

}

// Summary
console.log('\n' + '='.repeat(60));
if (allPassed) {






  console.log('   - README-OCR.md (quick start)');
  console.log('   - docs/ocr-pipeline.md (technical details)');


  process.exit(0);
} else {





  console.log('- npm install (to install all dependencies)');
  process.exit(1);
}
