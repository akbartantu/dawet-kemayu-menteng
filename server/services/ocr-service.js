/**
 * OCR Service with watermark-resistant preprocessing
 * 
 * This module provides robust OCR for extracting amounts and IDs from images
 * that may contain watermarks, overlays, or poor quality.
 * 
 * Features:
 * - Image preprocessing to reduce watermark interference
 * - Multiple PSM modes for better text detection
 * - Digit-only recognition for amounts
 * - Confidence-based validation
 * - Fallback strategies
 */

import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractLargeText } from './ocr-large-text-strategy.js';

/**
 * OCR extraction modes
 */
export const OCR_MODE = {
  AMOUNT: 'amount',      // Extract monetary amounts
  QUANTITY: 'quantity',  // Extract quantities
  ORDER_ID: 'order_id',  // Extract order IDs
  GENERIC: 'generic'     // Generic text extraction
};

/**
 * Validation ranges for different extraction modes
 */
const VALIDATION_RANGES = {
  amount: {
    min: 10000,        // Minimum amount: Rp 10,000
    max: 50000000,     // Maximum amount: Rp 50,000,000
    description: 'Payment amount'
  },
  quantity: {
    min: 1,
    max: 500,
    description: 'Item quantity'
  }
};

/**
 * Preprocess image to reduce watermark interference and improve OCR accuracy
 * 
 * @param {Buffer} imageBuffer - Input image buffer
 * @param {Object} options - Preprocessing options
 * @returns {Promise<Buffer>} Preprocessed image buffer
 */
async function preprocessImage(imageBuffer, options = {}) {
  const {
    debugSave = false,
    debugPath = null,
    enhanceContrast = true,
    removeNoise = true,
    sharpen = true,
    mode = 'balanced', // 'light', 'balanced', 'aggressive', 'color'
    skipGrayscale = false
  } = options;

  try {


    let pipeline = sharp(imageBuffer);
    
    // Get image metadata
    const metadata = await pipeline.metadata();

    // Step 1: Convert to grayscale (reduces color watermark visibility)
    // SKIP for 'color' mode to preserve colored text
    if (!skipGrayscale && mode !== 'color') {
      pipeline = pipeline.grayscale();

    } else if (mode === 'color') {
      console.log('  ⊘ Skipped grayscale (preserving color)');
    }
    
    // Step 2: Resize for optimal OCR
    // For large images (>1500px), scale DOWN to make large text more readable
    // For small images (<800px), scale UP for better detail
    if (metadata.width > 1500) {
      const scale = 1200 / metadata.width;
      pipeline = pipeline.resize(Math.floor(metadata.width * scale), Math.floor(metadata.height * scale), {
        kernel: 'lanczos3'
      });
      console.log(`  ✓ Downscaled image to ${Math.floor(metadata.width * scale)}px (large text optimization)`);
    } else if (metadata.width < 800) {
      const scale = Math.ceil(1000 / metadata.width);
      pipeline = pipeline.resize(metadata.width * scale, metadata.height * scale, {
        kernel: 'lanczos3'
      });

    } else {
      console.log(`  ⊘ No scaling needed (${metadata.width}px is optimal)`);
    }
    
    // Step 3: Enhance contrast (makes text stand out from watermark)
    if (enhanceContrast) {
      pipeline = pipeline.normalize(); // Auto-contrast

    }
    
    // Step 4: Remove noise (reduces watermark artifacts)
    if (removeNoise && mode !== 'light' && mode !== 'color') {
      pipeline = pipeline.median(3); // Median filter to reduce noise

    }
    
    // Step 5: Sharpen text (improves OCR accuracy)
    if (sharpen && mode !== 'color') {
      pipeline = pipeline.sharpen();

    }
    
    // Step 6: Apply threshold - ONLY in aggressive mode
    // Binary threshold can remove text if not careful
    if (mode === 'aggressive') {
      pipeline = pipeline.threshold(128);
      console.log('  ✓ Applied binary threshold (aggressive)');
    }
    
    const processedBuffer = await pipeline.toBuffer();
    console.log(`✅ [OCR_PREPROCESS] Preprocessing complete (${processedBuffer.length} bytes)`);
    
    // Save preprocessed image for debugging
    if (debugSave && debugPath) {
      try {
        await mkdir(debugPath, { recursive: true });
        const debugFile = join(debugPath, `preprocessed_${mode}_${Date.now()}.png`);
        await writeFile(debugFile, processedBuffer);

      } catch (saveError) {
        console.warn(`⚠️ [OCR_PREPROCESS] Could not save debug image:`, saveError.message);
      }
    }
    
    return processedBuffer;
  } catch (error) {
    console.error('❌ [OCR_PREPROCESS] Preprocessing failed:', error.message);
    // Return original buffer if preprocessing fails
    return imageBuffer;
  }
}

/**
 * Extract text from image using Tesseract with optimized settings
 * 
 * @param {Buffer} imageBuffer - Image buffer
 * @param {Object} options - OCR options
 * @returns {Promise<Object>} Extraction result
 */
async function extractTextWithTesseract(imageBuffer, options = {}) {
  const {
    mode = OCR_MODE.GENERIC,
    lang = 'eng',
    digitsOnly = false,
    psmModes = [11, 6, 12, 13]
  } = options;

  let worker = null;
  
  try {
    // Create Tesseract worker
    worker = await createWorker(lang);

    // Configure for digit-only recognition if needed
    if (digitsOnly) {
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789.,Rp '
      });

    }
    
    let bestResult = null;
    let bestScore = 0;
    
    // Try multiple PSM modes to find the best result
    for (const psm of psmModes) {
      try {

        const { data } = await worker.recognize(imageBuffer, {
          tessedit_pageseg_mode: psm
        });
        
        const text = data.text || '';
        const confidence = data.confidence || 0;
        
        // Score this result based on:
        // 1. Confidence score
        // 2. Whether it contains expected patterns
        let score = confidence;
        
        if (mode === OCR_MODE.AMOUNT) {
          // Boost score if we find "Rp" or amount patterns
          if (/Rp/i.test(text)) score += 20;
          if (/[\d]{1,3}(?:[.,]\d{3})+/.test(text)) score += 10;
        }
        
        console.log(`  PSM ${psm}: confidence=${confidence.toFixed(1)}%, score=${score.toFixed(1)}, text_length=${text.length}`);
        
        if (score > bestScore) {
          bestScore = score;
          bestResult = {
            text,
            confidence,
            psm,
            words: data.words || []
          };
        }
        
        // If we found a very good result, stop early
        if (score > 90) {
          console.log(`✅ [OCR_TESSERACT] Found high-confidence result (score=${score.toFixed(1)}), stopping early`);
          break;
        }
      } catch (psmError) {
        console.warn(`⚠️ [OCR_TESSERACT] PSM ${psm} failed:`, psmError.message);
      }
    }
    
    if (bestResult) {
      console.log(`✅ [OCR_TESSERACT] Best result: PSM ${bestResult.psm}, confidence=${bestResult.confidence.toFixed(1)}%`);
      return {
        ok: true,
        text: bestResult.text,
        confidence: bestResult.confidence,
        psm: bestResult.psm,
        words: bestResult.words
      };
    } else {
      return {
        ok: false,
        text: '',
        confidence: 0,
        error: 'No valid OCR result'
      };
    }
  } catch (error) {
    console.error('❌ [OCR_TESSERACT] Extraction failed:', error.message);
    return {
      ok: false,
      text: '',
      confidence: 0,
      error: error.message
    };
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}

/**
 * Extract and validate amounts from OCR text
 * 
 * @param {string} text - OCR extracted text
 * @param {Object} options - Validation options
 * @returns {Object} Extraction result with candidates
 */
function extractAmounts(text, options = {}) {
  const {
    minAmount = VALIDATION_RANGES.amount.min,
    maxAmount = VALIDATION_RANGES.amount.max,
    preferSmaller = true
  } = options;

  const candidates = [];
  
  // Pattern 1: Amounts with "Rp" prefix (highest priority)
  const rpPatterns = [
    { pattern: /Rp\s*([\d]{1,3}(?:[.,]\d{3})+)/gi, weight: 10, desc: 'Rp with separators' },
    { pattern: /Rp\s*([\d]{4,9})/gi, weight: 9, desc: 'Rp with digits only' },
    { pattern: /Rp\.?\s*([\d]{1,3}(?:[.,]\d{3})*)/gi, weight: 8, desc: 'Rp. with separators' }
  ];
  
  for (const { pattern, weight, desc } of rpPatterns) {
    for (const match of text.matchAll(pattern)) {
      const amountStr = match[1];
      if (!amountStr) continue;
      
      const cleaned = amountStr.replace(/[.,]/g, '');
      const amount = parseInt(cleaned, 10);
      
      if (!isNaN(amount) && amount >= minAmount && amount <= maxAmount) {
        candidates.push({
          amount,
          original: match[0],
          weight,
          source: desc,
          position: match.index
        });
      }
    }
  }
  
  // Pattern 2: Amounts with context keywords (medium priority)
  const contextPatterns = [
    { pattern: /(?:transfer|pembayaran|nominal|jumlah|total|bayar)[:\s]*([\d]{1,3}(?:[.,]\d{3})+)/gi, weight: 7 },
    { pattern: /([\d]{1,3}(?:[.,]\d{3})+)\s*rupiah/gi, weight: 6 }
  ];
  
  for (const { pattern, weight } of contextPatterns) {
    for (const match of text.matchAll(pattern)) {
      const amountStr = match[1];
      if (!amountStr) continue;
      
      const cleaned = amountStr.replace(/[.,]/g, '');
      const amount = parseInt(cleaned, 10);
      
      if (!isNaN(amount) && amount >= minAmount && amount <= maxAmount) {
        candidates.push({
          amount,
          original: match[0],
          weight,
          source: 'contextual',
          position: match.index
        });
      }
    }
  }
  
  // Remove duplicates
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!seen.has(candidate.amount)) {
      seen.add(candidate.amount);
      unique.push(candidate);
    }
  }
  
  // Sort by weight (desc), then by amount (asc if preferSmaller)
  unique.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return preferSmaller ? a.amount - b.amount : b.amount - a.amount;
  });
  
  console.log(`🔍 [OCR_EXTRACT] Found ${unique.length} candidate amount(s)`);
  unique.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.original} → Rp ${c.amount.toLocaleString('id-ID')} (weight: ${c.weight})`);
  });
  
  return {
    ok: unique.length > 0,
    candidates: unique,
    selected: unique[0] || null,
    count: unique.length
  };
}

/**
 * Main OCR extraction function
 * 
 * @param {Buffer|string} imageInput - Image buffer or URL
 * @param {Object} options - Extraction options
 * @returns {Promise<Object>} Extraction result
 */
export async function extractFromImage(imageInput, options = {}) {
  const {
    mode = OCR_MODE.GENERIC,
    preprocess = true,
    debugSave = false,
    debugPath = join(tmpdir(), 'ocr-debug'),
    lang = 'eng',
    minAmount,
    maxAmount,
    requireConfirmation = false
  } = options;

  console.log(`🔍 [OCR_SERVICE] Starting extraction (mode: ${mode})`);
  
  try {
    // Download image if URL provided
    let imageBuffer;
    if (typeof imageInput === 'string') {

      const response = await fetch(imageInput);
      imageBuffer = Buffer.from(await response.arrayBuffer());

    } else {
      imageBuffer = imageInput;
    }
    
    // Try multiple preprocessing strategies
    // 'color' mode preserves color info (good for colored text on white background)
    const preprocessModes = preprocess ? ['color', 'light', 'balanced', 'aggressive'] : [null];
    let bestResult = null;
    let bestScore = 0;
    let lastOcrResult = null; // Track last OCR result for debugging
    
    for (const preprocessMode of preprocessModes) {
      let processedBuffer = imageBuffer;
      
      if (preprocessMode) {

        processedBuffer = await preprocessImage(imageBuffer, {
          debugSave,
          debugPath,
          mode: preprocessMode
        });
      } else {

      }
      
      // For amount extraction, try multiple strategies
      let ocrResult = null;
      let extractResult = null;
      
      if (mode === OCR_MODE.AMOUNT) {
        // Try 1: Large text strategy (for prominent amounts)

        const largeText = await extractLargeText(processedBuffer);
        if (largeText) {

          const largeTextResult = extractAmounts(largeText, { minAmount, maxAmount });
          if (largeTextResult.ok) {

            extractResult = largeTextResult;
            ocrResult = { ok: true, text: largeText, confidence: 95 }; // High confidence for large text
            lastOcrResult = ocrResult;
          }
        }
        
        // Try 2: Full text recognition (can read "Rp" prefix)
        if (!extractResult?.ok) {

          ocrResult = await extractTextWithTesseract(processedBuffer, {
            mode,
            lang,
            digitsOnly: false // Allow all characters
          });
          
          // Store last OCR result for debugging
          lastOcrResult = ocrResult;
          
          if (ocrResult.ok) {
            console.log(`   📄 OCR Text (first 200 chars): ${ocrResult.text.substring(0, 200)}`);
            
            extractResult = extractAmounts(ocrResult.text, {
              minAmount,
              maxAmount
            });
            
            if (extractResult.ok) {

            } else {

            }
          }
        }
        
        // Try 3: Digits-only if full text failed
        if (!extractResult?.ok) {
          ocrResult = await extractTextWithTesseract(processedBuffer, {
            mode,
            lang,
            digitsOnly: true
          });
          
          lastOcrResult = ocrResult;
          
          if (ocrResult.ok) {
            extractResult = extractAmounts(ocrResult.text, {
              minAmount,
              maxAmount
            });
          }
        }
        
        if (!ocrResult?.ok || !extractResult?.ok) {

          continue;
        }
        
        // Score this result
        const score = ocrResult.confidence + (extractResult.selected.weight * 5);
        console.log(`   ✅ Found amount with ${preprocessMode || 'no preprocessing'}: Rp ${extractResult.selected.amount.toLocaleString('id-ID')} (score: ${score.toFixed(1)})`);
        
        if (score > bestScore) {
          bestScore = score;
          bestResult = {
            extractResult,
            ocrResult,
            preprocessMode
          };
        }
        
        // If we found a very good result, stop early
        if (score > 100) {

          break;
        }
      } else {
        // For generic mode
        const digitsOnly = mode === OCR_MODE.QUANTITY;
        ocrResult = await extractTextWithTesseract(processedBuffer, {
          mode,
          lang,
          digitsOnly
        });
        
        lastOcrResult = ocrResult;
        
        if (ocrResult.ok) {
          bestResult = {
            ocrResult,
            preprocessMode
          };
          break;
        }
      }
    }
    
    // Return best result
    if (!bestResult) {
      // Get the last OCR result for debugging (even if no amounts found)
      const debugText = lastOcrResult?.ok 
        ? lastOcrResult.text.substring(0, 500)
        : 'All preprocessing modes failed';
      const debugConfidence = lastOcrResult?.confidence || 0;
      
      return {
        ok: false,
        value: null,
        candidates: [],
        reason: 'no_amounts_found',
        ocrText: debugText,
        ocrConfidence: debugConfidence
      };
    }
    
    if (mode === OCR_MODE.AMOUNT) {
      const { extractResult, ocrResult, preprocessMode } = bestResult;
      const selected = extractResult.selected;
      
      // Check if confirmation is needed
      const needsConfirmation = requireConfirmation || 
                                extractResult.count > 1 ||
                                ocrResult.confidence < 80;

      return {
        ok: true,
        value: selected.amount,
        candidates: extractResult.candidates,
        confidence: ocrResult.confidence,
        needsConfirmation,
        reason: needsConfirmation ? 'low_confidence' : 'ok',
        metadata: {
          source: selected.source,
          weight: selected.weight,
          original: selected.original,
          psm: ocrResult.psm,
          preprocessMode
        }
      };
    }
    
    // For generic mode, just return the text
    const { ocrResult, preprocessMode } = bestResult;
    return {
      ok: true,
      value: ocrResult.text,
      confidence: ocrResult.confidence,
      metadata: {
        psm: ocrResult.psm,
        preprocessMode
      }
    };
  } catch (error) {
    console.error('❌ [OCR_SERVICE] Extraction failed:', error);
    return {
      ok: false,
      value: null,
      candidates: [],
      reason: 'exception',
      error: error.message
    };
  }
}

/**
 * Extract amount from image (convenience wrapper)
 */
export async function extractAmount(imageInput, options = {}) {
  return extractFromImage(imageInput, {
    ...options,
    mode: OCR_MODE.AMOUNT
  });
}

/**
 * Extract order ID from image (convenience wrapper)
 */
export async function extractOrderId(imageInput, options = {}) {
  return extractFromImage(imageInput, {
    ...options,
    mode: OCR_MODE.ORDER_ID,
    preprocess: true
  });
}
