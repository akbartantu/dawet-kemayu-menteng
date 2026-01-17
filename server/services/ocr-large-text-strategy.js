/**
 * Large Text OCR Strategy
 * 
 * Special preprocessing for images with very large text (like payment amounts)
 * that Tesseract treats as graphics rather than text.
 */

import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

/**
 * Extract large prominent text (like payment amounts) from image
 * 
 * Strategy:
 * 1. Crop to center region where large amounts typically appear
 * 2. Scale down to make large text "normal" sized
 * 3. Use PSM 8 (single word) which is best for large isolated text
 * 
 * @param {Buffer} imageBuffer - Input image
 * @returns {Promise<string>} Extracted text
 */
export async function extractLargeText(imageBuffer) {
  try {

    // Step 1: Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();

    // Step 2: Crop to center region (where large amounts usually are)
    // For Jago-style receipts, amount is typically 30-40% from top
    const cropWidth = Math.floor(metadata.width * 0.9);
    const cropHeight = Math.floor(metadata.height * 0.25); // Focus on 25% height
    const left = Math.floor((metadata.width - cropWidth) / 2);
    const top = Math.floor(metadata.height * 0.30); // Start at 30% from top
    
    let pipeline = sharp(imageBuffer)
      .extract({
        left,
        top,
        width: cropWidth,
        height: cropHeight
      });

    // Step 3: Scale down to make large text readable (target ~600px width)
    const targetWidth = 600;
    if (cropWidth > targetWidth) {
      const scale = targetWidth / cropWidth;
      pipeline = pipeline.resize(
        Math.floor(cropWidth * scale),
        Math.floor(cropHeight * scale),
        { kernel: 'lanczos3' }
      );

    }
    
    // Step 4: Enhance for OCR
    pipeline = pipeline
      .grayscale()
      .normalize()
      .sharpen();

    const processedBuffer = await pipeline.toBuffer();
    
    // Step 5: Try multiple PSM modes for large text

    const worker = await createWorker('eng');
    const psmModes = [8, 7, 6]; // 8=single word, 7=single line, 6=block
    let bestText = '';
    let bestConfidence = 0;
    
    for (const psm of psmModes) {
      await worker.setParameters({
        tessedit_pageseg_mode: psm.toString(),
        preserve_interword_spaces: '0'
      });
      
      const { data: { text, confidence } } = await worker.recognize(processedBuffer);
      console.log(`      PSM ${psm}: "${text.trim()}" (confidence=${confidence.toFixed(1)}%)`);
      
      // Prefer results that contain "Rp" or numbers
      const hasRp = text.includes('Rp') || text.includes('rp') || text.includes('RP');
      const hasNumbers = /\d{3,}/.test(text);
      const score = confidence + (hasRp ? 20 : 0) + (hasNumbers ? 10 : 0);
      
      if (score > bestConfidence) {
        bestConfidence = score;
        bestText = text.trim();
      }
    }
    
    await worker.terminate();
    
    console.log(`   ✅ Best result: "${bestText}" (score=${bestConfidence.toFixed(1)})`);
    
    return bestText;
  } catch (error) {
    console.error(`   ❌ Large text extraction failed:`, error.message);
    return '';
  }
}

/**
 * Try multiple cropping strategies for large text
 * 
 * @param {Buffer} imageBuffer - Input image
 * @returns {Promise<string[]>} Array of extracted text from different regions
 */
export async function extractLargeTextMultiRegion(imageBuffer) {
  const results = [];
  
  try {
    const metadata = await sharp(imageBuffer).metadata();
    
    // Try 3 different regions
    const regions = [
      { name: 'center', top: 0.25, height: 0.4 },  // Center 40%
      { name: 'upper', top: 0.15, height: 0.3 },   // Upper 30%
      { name: 'middle', top: 0.30, height: 0.35 }  // Middle 35%
    ];
    
    for (const region of regions) {

      const cropHeight = Math.floor(metadata.height * region.height);
      const top = Math.floor(metadata.height * region.top);
      
      const cropped = await sharp(imageBuffer)
        .extract({
          left: 0,
          top,
          width: metadata.width,
          height: cropHeight
        })
        .toBuffer();
      
      const text = await extractLargeText(cropped);
      if (text) {
        results.push({ region: region.name, text });
      }
    }
  } catch (error) {
    console.error('❌ Multi-region extraction failed:', error.message);
  }
  
  return results;
}
