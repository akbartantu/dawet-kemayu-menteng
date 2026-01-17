#!/usr/bin/env node
/**
 * OCR Debug Tool
 * 
 * Test and debug OCR extraction with various images
 * 
 * Usage:
 *   node tools/ocr-debug.js --image <path> --mode <amount|order_id> [options]
 * 
 * Options:
 *   --image <path>      Path to image file or URL
 *   --mode <mode>       Extraction mode: amount, order_id, generic
 *   --debug-save        Save preprocessed images for inspection
 *   --no-preprocess     Skip image preprocessing
 *   --lang <lang>       OCR language (default: eng)
 *   --min <amount>      Minimum amount (for amount mode)
 *   --max <amount>      Maximum amount (for amount mode)
 * 
 * Examples:
 *   node tools/ocr-debug.js --image payment.jpg --mode amount --debug-save
 *   node tools/ocr-debug.js --image https://example.com/receipt.png --mode amount
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { extractFromImage, OCR_MODE } from '../services/ocr-service.js';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    image: null,
    mode: 'amount',
    debugSave: false,
    preprocess: true,
    lang: 'eng',
    minAmount: 10000,
    maxAmount: 50000000
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--image':
        options.image = args[++i];
        break;
      case '--mode':
        options.mode = args[++i];
        break;
      case '--debug-save':
        options.debugSave = true;
        break;
      case '--no-preprocess':
        options.preprocess = false;
        break;
      case '--lang':
        options.lang = args[++i];
        break;
      case '--min':
        options.minAmount = parseInt(args[++i], 10);
        break;
      case '--max':
        options.maxAmount = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }
  
  if (!options.image) {
    console.error('Error: --image is required');
    printHelp();
    process.exit(1);
  }
  
  return options;
}

function printHelp() {

  --mode <mode>       Extraction mode: amount, order_id, generic (default: amount)
  --debug-save        Save preprocessed images for inspection
  --no-preprocess     Skip image preprocessing
  --lang <lang>       OCR language (default: eng)
  --min <amount>      Minimum amount for validation (default: 10000)
  --max <amount>      Maximum amount for validation (default: 50000000)
  --help, -h          Show this help message

Examples:
  # Extract amount from local image with debug output
  node tools/ocr-debug.js --image payment.jpg --mode amount --debug-save

  # Extract from URL without preprocessing
  node tools/ocr-debug.js --image https://example.com/receipt.png --mode amount --no-preprocess

  # Extract with custom validation range
  node tools/ocr-debug.js --image payment.jpg --mode amount --min 50000 --max 10000000
`);
}

// Format result for display
function formatResult(result, mode) {
  console.log('\n' + '='.repeat(60));

  console.log('='.repeat(60));
  
  if (!result.ok) {


    if (result.error) {

    }
    if (result.ocrText) {
      console.log(`\n📄 OCR Text (first 500 chars):`);

    }
    return;
  }

  if (mode === 'amount') {
    console.log(`\n💰 Extracted Amount: Rp ${result.value.toLocaleString('id-ID')}`);
    console.log(`   Confidence: ${result.confidence.toFixed(1)}%`);

    if (result.metadata) {





    }
    
    if (result.candidates && result.candidates.length > 1) {
      console.log(`\n🔍 Other Candidates (${result.candidates.length - 1}):`);
      result.candidates.slice(1, 5).forEach((candidate, i) => {
        console.log(`   ${i + 2}. Rp ${candidate.amount.toLocaleString('id-ID')} (${candidate.source}, weight: ${candidate.weight})`);
      });
    }
  } else {


    console.log(`\n   Confidence: ${result.confidence.toFixed(1)}%`);
  }
  
  console.log('\n' + '='.repeat(60));
}

// Main function
async function main() {
  const options = parseArgs();

  console.log('='.repeat(60));





  if (options.mode === 'amount') {
    console.log(`Validation Range: Rp ${options.minAmount.toLocaleString('id-ID')} - Rp ${options.maxAmount.toLocaleString('id-ID')}`);
  }
  
  console.log('='.repeat(60));
  
  try {
    // Load image
    let imageInput;
    if (options.image.startsWith('http://') || options.image.startsWith('https://')) {

      imageInput = options.image;
    } else {

      const imagePath = resolve(options.image);
      imageInput = await readFile(imagePath);

    }
    
    // Extract

    const startTime = Date.now();
    
    const result = await extractFromImage(imageInput, {
      mode: options.mode,
      preprocess: options.preprocess,
      debugSave: options.debugSave,
      lang: options.lang,
      minAmount: options.minAmount,
      maxAmount: options.maxAmount
    });
    
    const duration = Date.now() - startTime;
    
    // Display result
    formatResult(result, options.mode);

    // Exit with appropriate code
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Fatal Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
