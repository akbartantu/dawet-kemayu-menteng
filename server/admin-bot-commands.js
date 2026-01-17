/**
 * Admin Bot Commands
 * Handles admin-specific bot commands for order and payment management
 * Implements PRD Admin Assistant requirements
 */

import { getAllOrders, getOrderById, saveOrder, generateOrderId, updateOrderStatus } from './src/repos/orders.repo.js';
import { getPriceList } from './src/repos/price-list.repo.js';
import { getUserRole, upsertUserRole } from './src/repos/users.repo.js';
import { calculateOrderTotal } from './src/services/price-calculator.js';
import { formatPrice } from './src/utils/formatting.js';
import { 
  parseOrderFromMessage,
  parseOrderFromMessageAuto,
  validateOrder 
} from './src/services/order-parser.js';
import { 
  calculatePaymentStatus, 
  calculateRemainingBalance, 
  calculateMinDP,
  formatPaymentStatusMessage,
  validatePaymentStatusTransition 
} from './src/services/payment-tracker.js';
import { updateOrderPayment, updateOrderPaymentWithEvidence } from './src/repos/orders.repo.js';
import { 
  getJakartaTodayISO, 
  addDaysJakarta, 
  toISODateJakarta 
} from './src/utils/date-utils.js';
import logger from './src/utils/logger.js';
import { extractAmount as extractAmountFromImageNew } from './services/ocr-service.js';
import { isAdmin, requireAdmin } from './src/middleware/adminGuard.js';
import { pendingPaymentConfirmations } from './src/state/store.js';

/**
 * Extract amount/nominal from image using OCR with watermark-resistant preprocessing
 * Uses the new OCR service with Sharp preprocessing
 * @param {Object} message - Telegram message object with photo/document
 * @param {Object} options - Extraction options
 * @returns {Promise<number|null>} Extracted amount in Rupiah or null if not found
 */
async function extractAmountFromImage(message, options = {}) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.warn('⚠️ [OCR_AMOUNT] TELEGRAM_BOT_TOKEN not set, cannot download image for OCR');
      return null;
    }
    
    // Get file_id from photo or document
    let fileId = null;
    if (message.photo && message.photo.length > 0) {
      // Get largest photo
      const largestPhoto = message.photo[message.photo.length - 1];
      fileId = largestPhoto.file_id;
    } else if (message.document) {
      fileId = message.document.file_id;
    }
    
    if (!fileId) {
      return null;
    }
    
    // Get file path from Telegram
    const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
    const fileResponse = await fetch(getFileUrl);
    const fileData = await fileResponse.json();
    
    if (!fileData.ok || !fileData.result?.file_path) {
      console.warn('⚠️ [OCR_AMOUNT] Could not get file path from Telegram');
      return null;
    }
    
    const filePath = fileData.result.file_path;
    const imageUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    
    // Use new OCR service with preprocessing

    const result = await extractAmountFromImageNew(imageUrl, {
      preprocess: true,
      debugSave: process.env.OCR_DEBUG === 'true',
      lang: 'eng',
      minAmount: 10000,
      maxAmount: 50000000,
      ...options
    });
    
    if (result.ok) {
      console.log(`✅ [OCR_AMOUNT] Extracted amount: Rp ${result.value.toLocaleString('id-ID')}`);
      console.log(`   Confidence: ${result.confidence.toFixed(1)}%, Source: ${result.metadata.source}`);
      
      if (result.needsConfirmation) {

        if (result.candidates.length > 1) {

          result.candidates.slice(1, 4).forEach((c, i) => {
            console.log(`     ${i + 2}. Rp ${c.amount.toLocaleString('id-ID')} (${c.source})`);
          });
        }
      }
      
      return result.value;
    } else {

      if (result.error) {

      }
      return null;
    }
  } catch (error) {
    console.error('❌ [OCR_AMOUNT] Error extracting amount from image:', error);
    // Fallback to legacy OCR if new service fails
    return await extractAmountFromImageLegacy(message);
  }
}

/**
 * Legacy OCR extraction (fallback)
 * Kept for backward compatibility if new service fails
 */
async function extractAmountFromImageLegacy(message) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return null;
    }
    
    let fileId = null;
    if (message.photo && message.photo.length > 0) {
      const largestPhoto = message.photo[message.photo.length - 1];
      fileId = largestPhoto.file_id;
    } else if (message.document) {
      fileId = message.document.file_id;
    }
    
    if (!fileId) {
      return null;
    }
    
    const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
    const fileResponse = await fetch(getFileUrl);
    const fileData = await fileResponse.json();
    
    if (!fileData.ok || !fileData.result?.file_path) {
      return null;
    }
    
    const filePath = fileData.result.file_path;
    const imageUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    
    console.log('🔄 [OCR_AMOUNT] Using legacy OCR (fallback)...');
    
    // Try to use Tesseract.js for OCR (optional - requires npm install tesseract.js)
    try {
      const { createWorker } = await import('tesseract.js');
      // Use 'eng+ind' for better recognition of Indonesian numbers and "Rp" prefix
      // If that fails, fall back to 'eng'
      let worker;
      try {
        worker = await createWorker('eng+ind');

      } catch (langError) {

        worker = await createWorker('eng');
      }
      
      try {

        console.log(`🔍 [OCR_AMOUNT] Image URL: ${imageUrl.substring(0, 100)}...`);
        
        // Try multiple PSM modes to improve recognition
        // PSM 6 = Assume a single uniform block of text
        // PSM 11 = Sparse text (good for receipts with scattered text)
        // PSM 12 = Sparse text with OSD (Orientation and Script Detection)
        // PSM 13 = Raw line (treat image as a single text line)
        const psmModes = [11, 6, 12, 13];
        let bestText = '';
        let bestPsm = null;
        let bestHasRp = false;
        
        for (const psm of psmModes) {
          try {

            const { data: { text } } = await worker.recognize(imageUrl, {
              tessedit_pageseg_mode: psm,
            });
            
            // Check if this PSM mode found "Rp" or amount-like patterns
            const hasRp = /Rp/gi.test(text);
            const hasAmountPattern = /[\d]{1,3}(?:[.,]\d{3})+/.test(text);
            const rpMatches = text.match(/Rp\s*[\d.,]+/gi) || [];

            if (rpMatches.length > 0) {
              console.log(`    "Rp" matches found: ${rpMatches.slice(0, 5).join(', ')}`);
            }
            // Show first 200 chars of text for this PSM mode
            if (text.length > 0) {
              console.log(`    Sample text: "${text.substring(0, 200).replace(/\n/g, ' ')}"`);
            }
            
            // Prefer PSM modes that found "Rp" or amount patterns
            if (hasRp) {
              bestText = text;
              bestPsm = psm;
              bestHasRp = true;

              break; // Found "Rp", use this immediately
            } else if (hasAmountPattern && !bestHasRp) {
              // Keep as fallback if no "Rp" found yet
              bestText = text;
              bestPsm = psm;
            } else if (!bestText) {
              // Keep first result as last resort fallback
              bestText = text;
              bestPsm = psm;
            }
          } catch (psmError) {
            console.warn(`⚠️ [OCR_AMOUNT] PSM ${psm} failed:`, psmError.message);
          }
        }
        
        const text = bestText || '';
        console.log(`🔍 [OCR_AMOUNT] Using PSM mode ${bestPsm || 'default'} (found "Rp"=${bestHasRp})`);
        console.log(`🔍 [OCR_AMOUNT] Extracted text from image (first 500 chars): "${text.substring(0, 500)}"`);

        // Show full text if it's not too long (for debugging)
        if (text.length < 2000) {

        }
        
        // Log all "Rp" occurrences for debugging
        const rpOccurrences = (text.match(/Rp/gi) || []).length;
        console.log(`🔍 [OCR_AMOUNT] Found ${rpOccurrences} occurrence(s) of "Rp" in text`);
        
        // Show all lines containing "Rp" for debugging
        const linesWithRp = text.split('\n').filter(line => /Rp/gi.test(line));
        if (linesWithRp.length > 0) {

          linesWithRp.forEach((line, idx) => {
            console.log(`  ${idx + 1}. "${line.trim()}"`);
          });
        }
        
        // Extract amount/nominal from OCR text
        // CRITICAL: Only use amounts with "Rp" prefix - ignore standalone numbers
        // Payment proofs show "Rp395.000" - we must find this pattern
        
        // HIGH PRIORITY: Amounts with "Rp" prefix (most reliable for payment proofs)
        // Payment proofs typically show "Rp395.000" or "Rp 395.000" or "Rp395000"
        // OCR might read it as: "Rp395.000", "Rp 395.000", "Rp395000", "Rp395,000", etc.
        // Try multiple patterns to handle OCR variations
        const rpPatterns = [
          {
            pattern: /Rp\s*([\d]{1,3}(?:[.,]\d{3})+)/gi,      // Rp 395.000 or Rp395.000 (with separators)
            weight: 10,
            description: 'Rp with thousand separators'
          },
          {
            pattern: /Rp\s*([\d]{4,7})/gi,                    // Rp395000 (4-7 digits, no separators)
            weight: 9,
            description: 'Rp with digits only (4-7 digits)'
          },
          {
            pattern: /Rp\.?\s*([\d]{1,3}(?:[.,]\d{3})*)/gi,   // Rp. 395.000 (with period)
            weight: 8,
            description: 'Rp. with separators'
          },
        ];
        
        const rpMatches = [];
        for (const { pattern, weight, description } of rpPatterns) {
          for (const match of text.matchAll(pattern)) {
            const amountStr = match[1];
            if (!amountStr) continue;
            
            // Remove thousand separators (both . and ,)
            const cleaned = amountStr.replace(/[.,]/g, '');
            const amount = parseInt(cleaned, 10);
            
            if (!isNaN(amount) && amount >= 10000 && amount <= 1000000000) {
              // Check if we already have this amount (avoid duplicates)
              const existing = rpMatches.find(m => m.amount === amount);
              if (!existing) {
                rpMatches.push({
                  amount,
                  original: amountStr,
                  fullMatch: match[0],
                  position: match.index,
                  weight,
                  description,
                });
              }
            }
          }
        }
        
        // If we found amounts with "Rp" prefix, use those (they're most reliable)
        if (rpMatches.length > 0) {
          // Sort by: weight (descending), then by amount (ascending - prefer smaller amounts)
          // This ensures we pick the most reliable pattern match, and prefer smaller amounts
          // (which are more likely to be the actual transfer amount, not order totals)
          rpMatches.sort((a, b) => {
            // First sort by weight (higher weight = more reliable pattern)
            if (b.weight !== a.weight) {
              return b.weight - a.weight;
            }
            // Then by amount (smaller = more likely to be transfer amount)
            return a.amount - b.amount;
          });
          
          const selected = rpMatches[0];
          console.log(`🔍 [OCR_AMOUNT] Found ${rpMatches.length} amount(s) with "Rp" prefix:`);
          rpMatches.forEach((item, idx) => {
            console.log(`  ${idx + 1}. "${item.fullMatch}" → Rp ${item.amount.toLocaleString('id-ID')} (weight: ${item.weight}, pos: ${item.position})`);
          });
          console.log(`✅ [OCR_AMOUNT] Selected: "${selected.fullMatch}" → Rp ${selected.amount.toLocaleString('id-ID')} (${selected.description})`);
          await worker.terminate();
          return selected.amount;
        } else {



        }
        
        // MEDIUM PRIORITY: Amounts with payment keywords (even without "Rp")
        const contextualPatterns = [
          {
            pattern: /(?:transfer|pembayaran|nominal|jumlah|total|bayar)[:\s]*([\d]{1,3}(?:[.,]\d{3}){1,})/i,
            weight: 7,
            description: 'Payment keyword + amount (no Rp)'
          },
          {
            pattern: /([\d]{1,3}(?:[.,]\d{3}){1,})\s*rupiah/i,
            weight: 6,
            description: 'Amount + rupiah'
          },
        ];
        
        // FALLBACK: Standalone amounts with thousand separators in reasonable payment range
        // This is risky but necessary when OCR doesn't read "Rp" correctly
        // We'll be very selective: only numbers that look like payment amounts
        const standalonePatterns = [
          {
            pattern: /\b([\d]{1,3}(?:[.,]\d{3}){1,2})\b/g,  // 395.000 or 1.220.000 (1-3 digits, then 1-2 groups of 3 digits)
            weight: 4,
            description: 'Number with thousand separators (fallback)'
          },
          {
            pattern: /\b([\d]{4,7})\b/g,  // 395000 or 1220000 (4-7 digits, no separators)
            weight: 3,
            description: 'Number 4-7 digits (fallback)'
          },
        ];
        
        let extractedAmounts = [];
        
        // Extract with context (medium priority)
        for (const { pattern, weight, description } of contextualPatterns) {
          const matches = text.matchAll(new RegExp(pattern.source, 'gi'));
          for (const match of matches) {
            const amountStr = match[1] || match[0];
            const cleaned = amountStr.replace(/[.,]/g, '');
            const amount = parseInt(cleaned, 10);
            
            // Filter: reasonable payment range and not too long (avoid account numbers)
            if (!isNaN(amount) && amount >= 50000 && amount <= 5000000 && cleaned.length <= 7) {
              extractedAmounts.push({
                amount,
                original: amountStr,
                weight,
                description,
                context: match[0].substring(0, 50),
              });
            }
          }
        }
        
        // Extract standalone amounts (fallback) - only if no contextual matches
        if (extractedAmounts.length === 0) {

          for (const { pattern, weight, description } of standalonePatterns) {
            const matches = text.matchAll(new RegExp(pattern.source, 'gi'));
            for (const match of matches) {
              const amountStr = match[1] || match[0];
              const cleaned = amountStr.replace(/[.,]/g, '');
              const amount = parseInt(cleaned, 10);
              
              // Very strict filtering for standalone numbers:
              // - Must be in reasonable payment range (50k - 5M)
              // - Must not be too long (avoid account numbers like 103809282746)
              // - Must not be a date component (avoid 260107, 2026, etc.)
              const isReasonableAmount = amount >= 50000 && amount <= 5000000;
              const isNotTooLong = cleaned.length >= 4 && cleaned.length <= 7;
              const isNotDate = !/^(20\d{2}|19\d{2}|\d{6})$/.test(cleaned); // Not years or date codes
              const isNotAccountNumber = cleaned.length < 10; // Account numbers are usually 10+ digits
              
              if (!isNaN(amount) && isReasonableAmount && isNotTooLong && isNotDate && isNotAccountNumber) {
                // Check surrounding context - avoid if it's clearly part of an account number or date
                const matchIndex = match.index;
                const beforeContext = text.substring(Math.max(0, matchIndex - 20), matchIndex);
                const afterContext = text.substring(matchIndex + match[0].length, Math.min(text.length, matchIndex + match[0].length + 20));
                const fullContext = (beforeContext + match[0] + afterContext).toLowerCase();
                
                // Skip if it looks like an account number, date, or reference number
                const looksLikeAccount = /(?:account|rekening|no\.|nomor|ref)/i.test(fullContext);
                const looksLikeDate = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|wib|wit|202[0-9])/i.test(fullContext);
                
                if (!looksLikeAccount && !looksLikeDate) {
                  extractedAmounts.push({
                    amount,
                    original: amountStr,
                    weight,
                    description,
                    context: fullContext.substring(0, 50),
                  });
                }
              }
            }
          }
        }
        
        // Remove duplicates (same amount)
        const uniqueAmounts = [];
        const seenAmounts = new Set();
        for (const item of extractedAmounts) {
          if (!seenAmounts.has(item.amount)) {
            seenAmounts.add(item.amount);
            uniqueAmounts.push(item);
          }
        }
        
        // Log all candidate amounts found
        if (uniqueAmounts.length > 0) {
          console.log(`🔍 [OCR_AMOUNT] Found ${uniqueAmounts.length} candidate amount(s) (fallback patterns):`);
          uniqueAmounts.forEach((item, idx) => {
            console.log(`  ${idx + 1}. "${item.original}" → Rp ${item.amount.toLocaleString('id-ID')} (weight: ${item.weight}, ${item.description})`);
            if (item.context) {

            }
          });
        } else {

          console.log(`🔍 [OCR_AMOUNT] All numbers found in text (for debugging):`);
          // Find all numbers in text for debugging
          const allNumbers = text.match(/\b[\d]{1,}(?:[.,]\d{3})*\b/g) || [];
          if (allNumbers.length > 0) {
            allNumbers.forEach((num, idx) => {
              const cleaned = num.replace(/[.,]/g, '');
              const parsed = parseInt(cleaned, 10);
              const isReasonable = parsed >= 50000 && parsed <= 5000000 && cleaned.length <= 7;
              console.log(`  ${idx + 1}. "${num}" → ${parsed.toLocaleString('id-ID')} (${cleaned.length} digits${isReasonable ? ' - REASONABLE' : ' - filtered out'})`);
            });
          } else {
            console.log(`     (No numbers with thousand separators found)`);
          }
        }
        
        let extractedAmount = null;
        
        if (uniqueAmounts.length > 0) {
          // Sort by weight (descending), then by amount (ascending - prefer smaller amounts)
          uniqueAmounts.sort((a, b) => {
            if (b.weight !== a.weight) {
              return b.weight - a.weight;
            }
            return a.amount - b.amount;
          });
          
          extractedAmount = uniqueAmounts[0].amount;
          console.log(`✅ [OCR_AMOUNT] Selected: Rp ${extractedAmount.toLocaleString('id-ID')} (weight: ${uniqueAmounts[0].weight}, from: "${uniqueAmounts[0].original}", ${uniqueAmounts[0].description})`);
        }
        
        if (extractedAmount) {
          console.log(`✅ [OCR_AMOUNT] Found amount in image: Rp ${extractedAmount.toLocaleString('id-ID')}`);
          await worker.terminate();
          return extractedAmount;
        } else {


        }
      } finally {
        await worker.terminate();
      }
    } catch (tesseractError) {
      // Tesseract.js not available or failed - this is optional
      console.log(`ℹ️ [OCR_AMOUNT] Tesseract.js not available (optional feature). Install with: npm install tesseract.js`);

    }
    
    // Fallback: Return null if OCR not available or didn't find amount
    return null;
  } catch (error) {
    console.error('❌ [OCR_AMOUNT] Error extracting amount from image:', error);
    return null;
  }
}

/**
 * Extract order ID from image using OCR (optional feature)
 * Requires tesseract.js package: npm install tesseract.js
 * @param {Object} message - Telegram message object with photo/document
 * @param {Function} sendMessage - Function to send Telegram message
 * @returns {Promise<string|null>} Extracted order ID or null if not found
 */
async function extractOrderIdFromImage(message, sendMessage) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.warn('⚠️ [OCR] TELEGRAM_BOT_TOKEN not set, cannot download image for OCR');
      return null;
    }
    
    // Get file_id from photo or document
    let fileId = null;
    if (message.photo && message.photo.length > 0) {
      // Get largest photo
      const largestPhoto = message.photo[message.photo.length - 1];
      fileId = largestPhoto.file_id;
    } else if (message.document) {
      fileId = message.document.file_id;
    }
    
    if (!fileId) {
      return null;
    }
    
    // Get file path from Telegram
    const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
    const fileResponse = await fetch(getFileUrl);
    const fileData = await fileResponse.json();
    
    if (!fileData.ok || !fileData.result?.file_path) {
      console.warn('⚠️ [OCR] Could not get file path from Telegram');
      return null;
    }
    
    const filePath = fileData.result.file_path;
    const imageUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    
    // Try to use Tesseract.js for OCR (optional - requires npm install tesseract.js)
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      
      try {

        const { data: { text } } = await worker.recognize(imageUrl);
        console.log(`🔍 [OCR] Extracted text from image (first 300 chars): "${text.substring(0, 300)}"`);
        
        // Look for order ID pattern in OCR text (use literal DKM, not character class)
        const orderIdPattern = /(DKM\/\d{8}\/\d{6})/i;
        const match = text.match(orderIdPattern);
        
        if (match) {
          const extractedId = match[1];

          await worker.terminate();
          return extractedId;
        } else {

        }
      } finally {
        await worker.terminate();
      }
    } catch (tesseractError) {
      // Tesseract.js not available or failed - this is optional
      console.log(`ℹ️ [OCR] Tesseract.js not available (optional feature). Install with: npm install tesseract.js`);

    }
    
    // Fallback: Return null if OCR not available or didn't find order ID
    return null;
  } catch (error) {
    console.error('❌ [OCR] Error extracting order ID from image:', error);
    return null;
  }
}


/**
 * Handle payment confirmation (YES/NO response)
 * @param {number} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {string} response - User response (YES/NO)
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handlePaymentConfirmation(chatId, userId, response, sendMessage) {
  const responseUpper = response.toUpperCase().trim();
  if (responseUpper !== 'YES' && responseUpper !== 'NO') {
    return false; // Not a payment confirmation
  }
  
  // Find pending confirmation for this user
  let foundKey = null;
  for (const [key, data] of pendingPaymentConfirmations.entries()) {
    if (key.startsWith(`${userId}:`)) {
      foundKey = key;
      break;
    }
  }
  
  if (!foundKey) {
    return false; // No pending confirmation
  }
  
  const confirmation = pendingPaymentConfirmations.get(foundKey);
  pendingPaymentConfirmations.delete(foundKey);
  
  if (responseUpper === 'YES') {
    // Accept the payment
    try {
      // Check if this is from image OCR and has evidence info stored
      const isFromImage = confirmation.source === 'image_ocr';
      const hasEvidence = confirmation.evidenceFileId && confirmation.evidenceType;
      let result;
      
      if (isFromImage && hasEvidence) {
        // Use evidence info stored in confirmation
        const { updateOrderPaymentWithEvidence } = await import('./google-sheets.js');
        result = await updateOrderPaymentWithEvidence(
          confirmation.orderId,
          confirmation.enteredAmount,
          confirmation.evidenceFileId,
          confirmation.evidenceType,
          confirmation.telegramMessageId || message.message_id
        );
      } else {
        result = await updateOrderPayment(confirmation.orderId, confirmation.enteredAmount);
      }
      
      const message = formatPaymentStatusMessage({
        id: result.orderId,
        total_amount: result.totalAmount || result.finalTotal,
        final_total: result.finalTotal,
        paid_amount: result.paidAmount,
        payment_status: result.paymentStatus,
        remaining_balance: result.remainingBalance,
      });
      await sendMessage(chatId, `✅ Pembayaran dikonfirmasi.\n\n${message}`);
    } catch (error) {
      console.error('❌ [PAY_CONFIRM] Error confirming payment:', error);
      await sendMessage(chatId, `❌ Terjadi kesalahan: ${error.message}`);
    }
  } else {
    // Reject, use expected amount instead
    try {
      const { updateOrderPayment } = await import('./google-sheets.js');
      const result = await updateOrderPayment(confirmation.orderId, confirmation.expectedAmount);
      const message = formatPaymentStatusMessage({
        id: result.orderId,
        total_amount: result.totalAmount || result.finalTotal,
        final_total: result.finalTotal,
        paid_amount: result.paidAmount,
        payment_status: result.paymentStatus,
        remaining_balance: result.remainingBalance,
      });
      await sendMessage(
        chatId,
        'ℹ️ Menggunakan jumlah yang diharapkan.\n\n' + message
      );
    } catch (error) {
      console.error('❌ [PAY_CONFIRM] Error using expected amount:', error);
      await sendMessage(
        chatId,
        '❌ Pembayaran dibatalkan.\n\n' +
        'Silakan kirim ulang `/pay` dengan jumlah yang benar, atau upload foto bukti transfer dengan caption yang berisi order ID.'
      );
    }
  }
  
  return true; // Handled
}

/**
 * Handle /admin_auth command - Bootstrap admin using setup code
 * @param {string} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {string} messageText - Full message text
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleAdminAuth(chatId, userId, messageText, sendMessage) {
  try {
    const parts = messageText.split(' ');
    const code = parts[1];
    
    if (!code) {
      await sendMessage(chatId, '❌ Format: /admin_auth <CODE>\n\nMasukkan kode setup admin yang valid.');
      return;
    }
    
    const setupCode = process.env.ADMIN_SETUP_CODE;
    if (!setupCode) {
      await sendMessage(chatId, '❌ Admin setup tidak dikonfigurasi. Hubungi administrator sistem.');
      console.error('⚠️ ADMIN_SETUP_CODE not set in environment variables');
      return;
    }
    
    if (code !== setupCode) {
      await sendMessage(chatId, '❌ Kode tidak valid. Silakan coba lagi.');
      return;
    }
    
    // Get user info from Telegram message context
    // We need display name - try to get from message or use default
    const displayName = 'Admin User'; // Could be enhanced to get from message.from
    
    // Grant admin role
    await upsertUserRole('telegram', String(userId), displayName, 'admin', true);
    
    await sendMessage(
      chatId,
      '✅ **Akses Admin Diberikan!**\n\n' +
      'Anda sekarang memiliki akses admin. Perintah admin tersedia:\n' +
      '• /new_order\n' +
      '• /parse_order\n' +
      '• /order_detail <ORDER_ID>\n' +
      '• /status <ORDER_ID>\n' +
      '• /pay <ORDER_ID> <AMOUNT>\n' +
      '• /payment_status <ORDER_ID>\n' +
      '• /today_reminder'
    );

  } catch (error) {
    console.error('❌ Error in handleAdminAuth:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat memberikan akses admin. Silakan coba lagi.');
  }
}

/**
 * Handle /new_order command
 * Creates empty order with generated ID
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleNewOrder(chatId, userId, sendMessage) {
  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    return;
  }

  try {
    const orderId = await generateOrderId();
    await sendMessage(
      chatId,
      `✅ **Order Baru Dibuat**\n\n` +
      `📋 Order ID: ${orderId}\n\n` +
      `Silakan kirim template pesanan untuk di-parse, atau gunakan /parse_order untuk memulai.`
    );
  } catch (error) {
    console.error('❌ Error creating new order:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat membuat order baru.');
  }
}

/**
 * Handle /parse_order command
 * Parses order template and saves to database
 */
export async function handleParseOrder(chatId, userId, messageText, sendMessage, replyToMessage = null) {
  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    return;
  }

  try {
    let orderText = '';
    
    // Prefer reply_to_message if available
    if (replyToMessage && replyToMessage.text) {
      orderText = replyToMessage.text.trim();
      console.log(`🔍 [PARSE_ORDER] Using reply_to_message text (${orderText.length} chars)`);
    } else {
      // Extract payload from same message (everything after first newline or after command)
      const newlineIndex = messageText.indexOf('\n');
      if (newlineIndex >= 0) {
        orderText = messageText.substring(newlineIndex + 1).trim();
        console.log(`🔍 [PARSE_ORDER] Using payload from same message (${orderText.length} chars)`);
      } else {
        // Fallback: Remove /parse_order command from message
        orderText = messageText.replace(/^\/parse_order\s*/i, '').trim();
      }
    }
    
    if (!orderText) {
      await sendMessage(
        chatId,
        '❌ Format tidak valid.\n\n' +
        '**Cara penggunaan:**\n' +
        '1. Reply ke pesanan yang ingin di-parse, lalu ketik /parse_order\n' +
        '2. Atau ketik: /parse_order [template pesanan]\n' +
        '3. Atau kirim: /parse_order\\n[template pesanan]\n\n' +
        '**Rekomendasi:** Gunakan cara 1 (reply) untuk hasil yang lebih akurat.'
      );
      return;
    }

    // Parse order from template (use auto parser for better format detection)
    const parsedOrder = parseOrderFromMessageAuto(orderText);
    const validation = validateOrder(parsedOrder);

    if (!validation.valid) {
      await sendMessage(
        chatId,
        `❌ **Order tidak valid**\n\n` +
        `Kesalahan:\n${validation.errors.join('\n')}\n\n` +
        `Silakan perbaiki dan coba lagi.`
      );
      return;
    }

    // Check if this is an edit (order ID in form)
    // Look for "Invoice:" field or order ID pattern in the message (DKM/YYYYMMDD/000001)
    let orderId = null;
    let isEdit = false;
    
    // Try to extract Invoice from form (format: "Invoice: DKM/20260104/000001")
    const invoiceMatch = orderText.match(/Invoice\s*:\s*(DKM\/\d{8}\/\d{6})/i);
    if (invoiceMatch) {
      orderId = invoiceMatch[1];
    } else {
      // Fallback: Look for order ID pattern anywhere in the message
      const orderIdMatch = orderText.match(/(DKM\/\d{8}\/\d{6})/i);
      if (orderIdMatch) {
        orderId = orderIdMatch[1];
      }
    }
    
    if (orderId) {
      // Check if order exists
      const existingOrder = await getOrderById(orderId);
      if (existingOrder) {
        isEdit = true;
        logger.debug(`[PARSE_ORDER] Detected edit mode for existing order: ${orderId}`);
      } else {
        // Order ID found but doesn't exist - treat as new order with custom ID (not recommended)
        logger.warn(`[PARSE_ORDER] Order ID ${orderId} found in form but order doesn't exist. Creating new order.`);
        orderId = null; // Will generate new ID below
      }
    }
    
    // Generate new order ID if not editing
    if (!isEdit) {
      orderId = await generateOrderId();
    }
    
    // Create order data
    const orderData = {
      id: orderId,
      customer_name: parsedOrder.customer_name,
      phone_number: parsedOrder.phone_number,
      address: parsedOrder.address,
      event_name: parsedOrder.event_name,
      event_duration: parsedOrder.event_duration,
      event_date: parsedOrder.event_date,
      delivery_time: parsedOrder.delivery_time,
      items: parsedOrder.items,
      notes: parsedOrder.notes,
      delivery_method: parsedOrder.delivery_method,
      delivery_fee: parsedOrder.delivery_fee,
      // If editing, preserve existing status and created_at (don't overwrite)
      // If new, set default values
      status: isEdit ? undefined : 'pending',
      created_at: isEdit ? undefined : new Date().toISOString(),
    };

    // Save order (will update if exists, create if new)
    await saveOrder(orderData);

    // Get price list and calculate totals
    const priceList = await getPriceList();
    const calculation = calculateOrderTotal(orderData.items, priceList);

    // Format order summary
    let summary = isEdit 
      ? `✅ **ORDER UPDATED**\n\n`
      : `✅ **ORDER SUMMARY**\n\n`;
    summary += `📋 Order ID: ${orderId}\n`;
    summary += `👤 Customer: ${orderData.customer_name}\n`;
    summary += `📞 Phone: ${orderData.phone_number}\n`;
    summary += `📍 Address: ${orderData.address}\n`;
    if (orderData.event_date) {
      summary += `📅 Event Date: ${orderData.event_date}\n`;
    }
    if (orderData.delivery_time) {
      summary += `🕐 Delivery Time: ${orderData.delivery_time}\n`;
    }
    summary += `\n📦 **Items:**\n`;
    calculation.itemDetails.forEach((item, index) => {
      summary += `${index + 1}. ${item.name} (${item.quantity}x)\n`;
      summary += `   Subtotal: Rp ${formatPrice(item.itemTotal)}\n`;
    });
    summary += `\n💰 **Total: Rp ${formatPrice(calculation.subtotal)}**\n`;
    summary += `\n${isEdit ? '✅ Order berhasil diperbarui!' : '✅ Order berhasil disimpan!'}`;

    await sendMessage(chatId, summary);
  } catch (error) {
    console.error('❌ Error parsing order:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat memparse order. Silakan coba lagi.');
  }
}

/**
 * Handle /order_detail command
 * Shows full order details
 * @param {string|number} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {string} orderId - Order ID to look up
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleOrderDetail(chatId, userId, orderId, sendMessage) {
  logger.debug(`[ORDER_DETAIL] Command received - chatId: ${chatId}, userId: ${userId}, orderId: ${orderId || 'MISSING'}`);
  
  try {
    // Check admin access
    const isUserAdmin = await isAdmin(userId);
    logger.debug(`[ORDER_DETAIL] Admin check - userId: ${userId}, isAdmin: ${isUserAdmin}`);
    
    if (!isUserAdmin) {
      await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini. Perintah ini hanya untuk admin.');
      return;
    }

    if (!orderId || !orderId.trim()) {
      await sendMessage(chatId, '❌ Format: /order_detail <ORDER_ID>\n\nContoh: /order_detail DKM/20260104/000001');
      return;
    }

    const trimmedOrderId = orderId.trim();
    logger.debug(`[ORDER_DETAIL] Looking up order: ${trimmedOrderId}`);

    // CRITICAL: Always read fresh from Google Sheets (no cache)
    // This ensures /order_detail shows latest data after /edit
    const order = await getOrderById(trimmedOrderId);
    
    if (!order) {
      await sendMessage(chatId, `❌ Order ID "${trimmedOrderId}" tidak ditemukan.`);
      return;
    }

    logger.debug(`✅ [ORDER_DETAIL] Order found: ${order.id}`);

    // Get price list for calculation
    let priceList;
    let calculation;
    try {
      priceList = await getPriceList();
      calculation = calculateOrderTotal(order.items || [], priceList);
    } catch (error) {
      logger.error('[ORDER_DETAIL] Error calculating totals:', error);
      logger.error('[ORDER_DETAIL] Error message:', error?.message || 'Unknown error');
      throw new Error(`Failed to calculate order totals: ${error?.message || 'Unknown error'}`);
    }

    // Format order detail with comprehensive information
    let detail = `📋 **ORDER DETAIL**\n\n`;
    detail += `**Order ID:** ${order.id}\n`;
    detail += `**Status:** ${order.status || 'N/A'}\n`;
    
    // Payment info if available
    if (order.payment_status) {
      detail += `**Payment Status:** ${order.payment_status}\n`;
      if (order.paid_amount) {
        detail += `**Paid:** Rp ${formatPrice(order.paid_amount)}\n`;
      }
      if (order.remaining_balance !== undefined) {
        detail += `**Remaining:** Rp ${formatPrice(order.remaining_balance)}\n`;
      }
    }
    
    detail += `\n👤 **Customer Info:**\n`;
    detail += `Nama Pemesan: ${order.customer_name || 'N/A'}\n`;
    if (order.receiver_name && order.receiver_name !== order.customer_name) {
      detail += `Nama Penerima: ${order.receiver_name}\n`;
    }
    detail += `Phone: ${order.phone_number || 'N/A'}\n`;
    detail += `Address: ${order.address || 'N/A'}\n`;
    
    if (order.event_name || order.event_date) {
      detail += `\n📅 **Event Info:**\n`;
      detail += `Event: ${order.event_name || '-'}\n`;
      if (order.event_date) {
        detail += `Date: ${order.event_date}\n`;
      }
      if (order.delivery_time) {
        detail += `Time: ${order.delivery_time}\n`;
      }
    }

    // Calculate total cups from items (for packaging calculation)
    let totalCups = 0;
    let hasPackagingInItems = false;
    if (order.items && order.items.length > 0) {
      order.items.forEach(item => {
        const itemName = (item.name || '').toLowerCase();
        // Check if packaging is already in items
        if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
          hasPackagingInItems = true;
          return;
        }
        // Check if item is a cup-based product (Dawet Small/Medium/Large)
        if (itemName.includes('dawet') && 
            (itemName.includes('small') || itemName.includes('medium') || itemName.includes('large'))) {
          // Exclude botol items (they're not cups)
          if (!itemName.includes('botol')) {
            totalCups += parseInt(item.quantity || 0);
          }
        }
      });
    }
    
    // Parse notes (handle both string and array formats)
    let notes = order.notes || [];
    if (typeof notes === 'string') {
      try {
        notes = JSON.parse(notes);
      } catch (e) {
        // If not valid JSON, treat as plain string
        if (notes.trim()) {
          notes = [notes.trim()];
        } else {
          notes = [];
        }
      }
    }
    // Ensure notes is an array
    if (!Array.isArray(notes)) {
      notes = notes ? [notes] : [];
    }
    
    // Check if packaging is requested in notes
    const hasPackagingRequest = notes.some(note => {
      const noteLower = String(note || '').toLowerCase().trim();
      return noteLower.includes('packaging styrofoam') && 
             (noteLower.includes(': ya') || noteLower.includes(': yes') || 
              noteLower === 'packaging styrofoam: ya' || noteLower === 'packaging styrofoam: yes');
    });
    
    // Calculate required packaging boxes (1 box per 50 cups, rounded up)
    const requiredPackagingBoxes = hasPackagingRequest && totalCups > 0 ? Math.ceil(totalCups / 50) : 0;

    detail += `\n📦 **Items:**\n`;
    if (order.items && order.items.length > 0) {
      let itemIndex = 1;
      let packagingShown = false;
      
      order.items.forEach((item) => {
        const itemName = (item.name || '').toLowerCase();
        
        // Skip packaging items (they'll be replaced with calculated quantity)
        if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
          // If packaging is requested, show calculated quantity once
          if (hasPackagingRequest && requiredPackagingBoxes > 0 && !packagingShown) {
            detail += `${itemIndex}. ${requiredPackagingBoxes}x Packaging Styrofoam (50 cup)\n`;
            packagingShown = true;
            itemIndex++;
          }
          // Skip original packaging item
          return;
        }
        
        // Display other items normally
        detail += `${itemIndex}. ${item.quantity}x ${item.name}\n`;
        itemIndex++;
      });
      
      // If packaging requested but not found in items, add it
      if (hasPackagingRequest && requiredPackagingBoxes > 0 && !packagingShown) {
        detail += `${itemIndex}. ${requiredPackagingBoxes}x Packaging Styrofoam (50 cup)\n`;
      }
    } else {
      detail += `Tidak ada items\n`;
    }

    detail += `\n💰 **Total: Rp ${formatPrice(calculation.subtotal)}**\n`;
    
    // Use total_amount (canonical) with fallback to final_total (legacy)
    const totalAmount = order.total_amount || order.final_total;
    if (totalAmount && totalAmount !== calculation.subtotal) {
      detail += `**Total Amount: Rp ${formatPrice(totalAmount)}**\n`;
    }
    
    // Filter out packaging-related notes and ensure all notes are strings
    const filteredNotes = notes
      .map(note => {
        // Convert note to string - handle objects, arrays, and other types
        if (note === null || note === undefined) {
          return null;
        }
        if (typeof note === 'object') {
          // If it's an object, try to extract meaningful info
          // Check if it has common properties that might contain the actual note text
          if (note.text) return String(note.text);
          if (note.note) return String(note.note);
          if (note.value) return String(note.value);
          if (note.message) return String(note.message);
          // If it's an array, join it
          if (Array.isArray(note)) {
            return note.map(n => String(n)).join(', ');
          }
          // Last resort: try JSON stringify
          try {
            const jsonStr = JSON.stringify(note);
            // If JSON is too long or looks like an object dump, try to extract useful info
            if (jsonStr.length > 100) {
              return null; // Skip very long objects
            }
            return jsonStr;
          } catch (e) {
            // If stringify fails, skip this note
            return null;
          }
        }
        return String(note);
      })
      .filter(note => {
        if (!note || !note.trim()) return false;
        const noteLower = note.toLowerCase().trim();
        // Filter out packaging-related notes
        return !(noteLower.includes('packaging styrofoam') && 
                 (noteLower.includes(': ya') || noteLower.includes(': yes') || 
                  noteLower === 'packaging styrofoam: ya' || noteLower === 'packaging styrofoam: yes'));
      });
    
    if (filteredNotes.length > 0) {
      detail += `\n📝 **Notes:**\n${filteredNotes.join('\n')}\n`;
    }
    
    // Removed Created/Updated timestamps from output (per requirements)

    await sendMessage(chatId, detail);
    logger.debug(`✅ [ORDER_DETAIL] Successfully sent order details for ${trimmedOrderId}`);
  } catch (error) {
    logger.error('[ORDER_DETAIL] Error getting order detail:', error);
    logger.error('[ORDER_DETAIL] Error message:', error?.message || 'Unknown error');
    logger.error('[ORDER_DETAIL] Error stack:', error?.stack || 'No stack trace');
    logger.error('[ORDER_DETAIL] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    await sendMessage(chatId, `❌ Maaf, ada error saat memproses perintah ini: ${error?.message || 'Unknown error'}. Silakan coba lagi.`);
  }
}

/**
 * Handle /status command
 * Quick status check
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleStatus(chatId, userId, orderId, sendMessage) {
  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
    return;
  }

  if (!orderId) {
    await sendMessage(chatId, '❌ Format: /status <order_id>');
    return;
  }

  try {
    const order = await getOrderById(orderId);
    
    if (!order) {
      await sendMessage(chatId, `❌ Order ${orderId} tidak ditemukan.`);
      return;
    }

    await sendMessage(
      chatId,
      `📋 **Order Status**\n\n` +
      `Order ID: ${order.id}\n` +
      `Status: ${order.status}\n` +
      `Customer: ${order.customer_name || 'N/A'}\n` +
      `Created: ${order.created_at ? new Date(order.created_at).toLocaleString('id-ID') : 'N/A'}`
    );
  } catch (error) {
    console.error('❌ Error getting status:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil status order.');
  }
}

/**
 * Handle payment with evidence (photo/document upload)
 * Extracts order_id from caption and auto-calculates amount from order
 * @param {number} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {Object} message - Telegram message object with photo/document
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handlePayWithEvidence(chatId, userId, message, sendMessage) {

  try {
    // Check both caption and message text (in case user types /pay in text and uploads photo)
    const caption = message.caption || '';
    const messageText = message.text || '';
    const combinedText = `${messageText} ${caption}`.trim();

    // Extract order_id from text/caption (support with/without backticks)
    // Pattern: DKM/YYYYMMDD/000001 or `DKM/YYYYMMDD/000001`
    // IMPORTANT: Use literal "DKM" not character class [DKM] to avoid matching partial strings like "M/20260109"
    // Try multiple patterns to be more flexible
    let orderIdMatch = null;
    
    // Pattern 1: Exact match with word boundaries or backticks
    orderIdMatch = combinedText.match(/(?:^|\s|`)(DKM\/\d{8}\/\d{6})(?:\s|`|$)/i);
    
    // Pattern 2: After /pay command
    if (!orderIdMatch) {
      orderIdMatch = combinedText.match(/\/pay\s+(DKM\/\d{8}\/\d{6})/i);
    }
    
    // Pattern 3: Anywhere in text (more lenient)
    if (!orderIdMatch) {
      orderIdMatch = combinedText.match(/(DKM\/\d{8}\/\d{6})/i);
    }
    
    let orderId = null;
    
    // If not found in text, try OCR on the image
    if (!orderIdMatch && (message.photo || message.document)) {

      try {
        const extractedOrderId = await extractOrderIdFromImage(message, sendMessage);
        if (extractedOrderId) {
          orderId = extractedOrderId;

        }
      } catch (ocrError) {
        console.warn(`⚠️ [PAY_EVIDENCE] OCR failed (non-critical):`, ocrError.message);
      }
    }
    
    // If still not found, use the regex match result
    if (!orderId && orderIdMatch) {
      orderId = orderIdMatch[1];
    }
    
    if (!orderId) {
      await sendMessage(
        chatId,
        '❌ Order ID tidak ditemukan di caption atau gambar.\n\n' +
        '**Format caption:**\n' +
        '`/pay DKM/20260108/000001`\n\n' +
        'Atau:\n' +
        '`DKM/20260108/000001`\n\n' +
        'Pastikan order ID ada di caption foto/bukti transfer, atau terlihat jelas di gambar.'
      );
      return;
    }

    // Get order from Orders sheet
    const order = await getOrderById(orderId);
    if (!order) {
      await sendMessage(
        chatId,
        `❌ Order \`${orderId}\` tidak ditemukan.\n\n` +
        'Silakan periksa order ID dari pesan konfirmasi pesanan Anda.'
      );
      return;
    }
    
    // Auto-calculate expected amount from order (use total_amount_expected or total_amount)
    const expectedAmount = order.total_amount || order.final_total || 0;
    if (!expectedAmount || expectedAmount <= 0) {
      await sendMessage(
        chatId,
        `❌ Order \`${orderId}\` tidak memiliki total amount yang valid.`
      );
      return;
    }
    
    // Get evidence file_id (prefer largest photo or document)
    let evidenceFileId = null;
    let evidenceType = null;
    if (message.photo && message.photo.length > 0) {
      // Get largest photo
      const largestPhoto = message.photo[message.photo.length - 1];
      evidenceFileId = largestPhoto.file_id;
      evidenceType = 'photo';
    } else if (message.document) {
      evidenceFileId = message.document.file_id;
      evidenceType = 'document';
    }
    
    // Extract amount from image using OCR
    let extractedAmount = null;
    if (evidenceFileId) {

      console.log(`🔍 [PAY_EVIDENCE] Expected amount from order: Rp ${expectedAmount.toLocaleString('id-ID')}`);

      try {
        extractedAmount = await extractAmountFromImage(message);
        if (extractedAmount) {
          console.log(`✅ [PAY_EVIDENCE] Extracted amount from image: Rp ${extractedAmount.toLocaleString('id-ID')}`);
          console.log(`🔍 [PAY_EVIDENCE] Difference from expected: Rp ${Math.abs(extractedAmount - expectedAmount).toLocaleString('id-ID')}`);
        } else {


          console.log(`   1. tesseract.js not installed (run: npm install tesseract.js)`);


          console.log(`ℹ️ [PAY_EVIDENCE] Will use expected amount: Rp ${expectedAmount.toLocaleString('id-ID')}`);
        }
      } catch (ocrError) {
        console.error(`❌ [PAY_EVIDENCE] OCR extraction failed:`, ocrError.message);
        console.error(`❌ [PAY_EVIDENCE] Stack:`, ocrError.stack);
        console.log(`ℹ️ [PAY_EVIDENCE] Falling back to expected amount: Rp ${expectedAmount.toLocaleString('id-ID')}`);
      }
    } else {

    }
    
    // Determine payment amount: use extracted amount if available, otherwise use expected amount
    let paymentAmount = expectedAmount;
    let amountSource = 'expected'; // 'expected' or 'extracted'
    
    if (extractedAmount && extractedAmount > 0) {
      console.log(`🔍 [PAY_EVIDENCE] Extracted amount is valid: Rp ${extractedAmount.toLocaleString('id-ID')}`);

      // Check for suspicious amount if we extracted from image
      const { detectSuspiciousPayment, parseIDRAmount } = await import('./src/services/payment-tracker.js');
      const suspiciousCheck = detectSuspiciousPayment(expectedAmount, extractedAmount);
      
      if (suspiciousCheck.isSuspicious) {
        // Store pending confirmation with evidence info
        const confirmationKey = `${userId}:${orderId}`;
        pendingPaymentConfirmations.set(confirmationKey, {
          orderId,
          expectedAmount,
          enteredAmount: extractedAmount,
          timestamp: Date.now(),
          source: 'image_ocr',
          evidenceFileId,
          evidenceType,
          telegramMessageId: message.message_id,
        });
        
        // Ask for confirmation
        // formatPrice is already imported at top of file
        await sendMessage(
          chatId,
          '⚠️ **Konfirmasi Jumlah Pembayaran**\n\n' +
          `📋 Order ID: \`${orderId}\`\n` +
          `💵 Total yang Diharapkan: Rp ${formatPrice(expectedAmount)}\n` +
          `💳 Jumlah yang Terdeteksi dari Gambar: Rp ${formatPrice(extractedAmount)}\n\n` +
          `**Peringatan:** ${suspiciousCheck.reason}\n\n` +
          'Apakah jumlah yang terdeteksi dari gambar benar?\n' +
          'Balas **YES** untuk konfirmasi, atau **NO** untuk menggunakan jumlah yang diharapkan.'
        );
        return;
      }
      
      // Use extracted amount if not suspicious
      paymentAmount = extractedAmount;
      amountSource = 'extracted';
      console.log(`✅ [PAY_EVIDENCE] Using extracted amount from image: Rp ${paymentAmount.toLocaleString('id-ID')}`);
      console.log(`✅ [PAY_EVIDENCE] Amount source: EXTRACTED (from OCR)`);
    } else {

      console.log(`ℹ️ [PAY_EVIDENCE] Using expected amount: Rp ${paymentAmount.toLocaleString('id-ID')}`);
      console.log(`ℹ️ [PAY_EVIDENCE] Amount source: EXPECTED (from order total)`);
    }
    
    // Update payment with evidence
    const result = await updateOrderPaymentWithEvidence(
      orderId,
      paymentAmount,
      evidenceFileId,
      evidenceType,
      message.message_id
    );
    
    console.log(`✅ [PAY_EVIDENCE] Payment updated - Order: ${orderId}, Amount: ${paymentAmount} (${amountSource}), Total Paid: ${result.paidAmount}, Status: ${result.paymentStatus}`);
    
    // Format confirmation message with monospace order_id
    // formatPrice is already imported at top of file
    let confirmationMessage = 
      '✅ **Pembayaran Diterima!**\n\n' +
      `📋 Order ID: \`${orderId}\`\n` +
      `💵 Total Pesanan: Rp ${formatPrice(expectedAmount)}\n`;
    
    if (amountSource === 'extracted' && extractedAmount) {
      confirmationMessage += `💳 Jumlah dari Gambar: Rp ${formatPrice(extractedAmount)}\n`;
      confirmationMessage += `💳 Total Dibayar: Rp ${formatPrice(result.paidAmount)}\n`;
    } else {
      // If using expected amount, show it clearly
      confirmationMessage += `💳 Total Dibayar: Rp ${formatPrice(result.paidAmount)}\n`;
      confirmationMessage += `ℹ️ *Catatan: Jumlah menggunakan total pesanan (OCR tidak menemukan jumlah di gambar)*\n`;
    }
    
    confirmationMessage += 
      `📊 Status: ${result.paymentStatus}\n\n` +
      'Bukti transfer telah disimpan. Terima kasih!';
    
    await sendMessage(chatId, confirmationMessage);
  } catch (error) {
    console.error('❌ [PAY_EVIDENCE] Error processing payment evidence:', error);
    console.error('❌ [PAY_EVIDENCE] Stack:', error.stack);
    await sendMessage(
      chatId,
      `❌ Terjadi kesalahan: ${error.message || 'Gagal memproses bukti pembayaran. Silakan coba lagi.'}`
    );
  }
}

/**
 * Handle /pay command (legacy - for admin manual entry with amount)
 * Update payment for an order (accumulates with existing paid amount)
 * Includes suspicious amount detection and confirmation flow
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handlePay(chatId, userId, orderId, amountInput, sendMessage) {

  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
    return;
  }

  if (!orderId || !amountInput) {
    await sendMessage(
      chatId,
      '❌ Format: /pay <ORDER_ID> <AMOUNT>\n\n' +
      '**Contoh:**\n' +
      '`/pay DKM/20260104/000001 235.000`\n' +
      'Atau: `/pay DKM/20260104/000001 Rp 235.000`\n\n' +
      '**Atau upload foto bukti transfer dengan caption:**\n' +
      '`/pay DKM/20260104/000001`\n\n' +
      '(Jumlah akan dihitung otomatis dari total pesanan)'
    );
    return;
  }

  try {
    // Get order to check expected amount
    const order = await getOrderById(orderId);
    if (!order) {
      await sendMessage(chatId, `❌ Order \`${orderId}\` tidak ditemukan.`);
      return;
    }
    
    const expectedAmount = order.total_amount || order.final_total || 0;
    
    // Parse Indonesian currency format
    const { parseIDRAmount, detectSuspiciousPayment } = await import('./src/services/payment-tracker.js');
    const newPaymentAmount = parseIDRAmount(amountInput);
    
    if (newPaymentAmount === null) {
      await sendMessage(
        chatId,
        '❌ Format jumlah pembayaran tidak valid.\n\n' +
        'Format yang diterima:\n' +
        '• 235.000\n' +
        '• 235,000\n' +
        '• Rp 235.000\n' +
        '• 235000\n\n' +
        'Contoh: `/pay DKM/20260104/000001 235.000`'
      );
      return;
    }

    console.log(`🔍 [PAY] Parsed amount: ${newPaymentAmount} (from input: "${amountInput}")`);

    // Check for suspicious amount
    if (expectedAmount > 0) {
      const suspicious = detectSuspiciousPayment(expectedAmount, newPaymentAmount);
      if (suspicious.isSuspicious) {
        // Store pending confirmation
        const confirmationKey = `${userId}:${orderId}`;
        pendingPaymentConfirmations.set(confirmationKey, {
          orderId,
          expectedAmount,
          enteredAmount: newPaymentAmount,
          timestamp: Date.now(),
          source: 'manual_entry',
        });
        
        // Ask for confirmation
        // formatPrice is already imported at top of file
        await sendMessage(
          chatId,
          '⚠️ **Konfirmasi Jumlah Pembayaran**\n\n' +
          `📋 Order ID: \`${orderId}\`\n` +
          `💵 Total yang Diharapkan: Rp ${formatPrice(expectedAmount)}\n` +
          `💳 Jumlah yang Dimasukkan: Rp ${formatPrice(newPaymentAmount)}\n\n` +
          `**Peringatan:** ${suspicious.reason}\n\n` +
          'Apakah jumlah ini benar?\n' +
          'Balas **YES** untuk konfirmasi, atau **NO** untuk memasukkan ulang.'
        );
        return;
      }
    }

    // Update payment (will accumulate with existing)
    const result = await updateOrderPayment(orderId, newPaymentAmount);

    const message = formatPaymentStatusMessage({
      id: result.orderId,
      total_amount: result.totalAmount || result.finalTotal, // Use totalAmount (canonical)
      final_total: result.finalTotal, // Keep for backward compatibility
      paid_amount: result.paidAmount,
      payment_status: result.paymentStatus,
      remaining_balance: result.remainingBalance,
    });

    await sendMessage(chatId, message);
  } catch (error) {
    console.error('❌ [PAY] Error updating payment:', error);
    console.error('❌ [PAY] Stack:', error.stack);
    // Return early - do NOT show status card after error
    await sendMessage(chatId, `❌ Terjadi kesalahan: ${error.message || 'Gagal memperbarui pembayaran. Silakan coba lagi.'}`);
    return; // Early return to prevent any further processing
  }
}

/**
 * Handle /payment_status command
 * Show payment status only
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handlePaymentStatus(chatId, userId, orderId, sendMessage) {
  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
    return;
  }

  if (!orderId) {
    await sendMessage(chatId, '❌ Format: /payment_status <order_id>');
    return;
  }

  try {
    const order = await getOrderById(orderId);
    
    if (!order) {
      await sendMessage(chatId, `❌ Order ${orderId} tidak ditemukan.`);
      return;
    }

    const message = formatPaymentStatusMessage(order);
    await sendMessage(chatId, message);
  } catch (error) {
    console.error('❌ Error getting payment status:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil status pembayaran.');
  }
}

/**
 * Get orders by event date
 * @param {string} targetDate - Date in YYYY-MM-DD format
 * @param {string} paymentStatusFilter - Optional payment status filter (e.g., 'FULLPAID', 'PAID', 'UNPAID')
 * @returns {Promise<Array>} Array of orders sorted by delivery_time
 */
/**
 * Get orders by ISO date (centralized filter function)
 * @param {string} targetISO - Target date in YYYY-MM-DD format (must be normalized)
 * @param {string} paymentStatusFilter - Optional payment status filter
 * @returns {Promise<Array>} Array of orders matching the date
 */
async function getOrdersByISODate(targetISO, paymentStatusFilter = null) {
  try {

    // Get all orders (we'll filter by date)
    const allOrders = await getAllOrders(10000); // Get large limit to ensure we get all orders
    
    // Filter by event_date using centralized normalization
    // Both targetISO and order.event_date are normalized to YYYY-MM-DD for comparison
    const filteredOrders = allOrders.filter(order => {
      const orderDate = order.event_date;
      if (!orderDate) return false;
      
      // Normalize order date to ISO format (handles DD/MM/YYYY, serial numbers, etc.)
      // CRITICAL: If already ISO YYYY-MM-DD, return as-is (no timezone shift)
      const normalizedOrderDate = toISODateJakarta(orderDate);
      
      if (!normalizedOrderDate) {
        // Log for debugging but don't fail the filter
        console.log(`[ORDERS_FILTER] raw="${orderDate}" normalized=null (skipping)`);
        return false;
      }
      
      // Compare normalized ISO dates
      const matches = normalizedOrderDate === targetISO;
      if (matches) {

      }
      
      return matches;
    });

    // Remove duplicates by order_id (defensive - should not happen, but handle it)
    const uniqueOrders = [];
    const seenOrderIds = new Set();
    for (const order of filteredOrders) {
      const orderId = order.id || '';
      if (orderId && !seenOrderIds.has(orderId)) {
        seenOrderIds.add(orderId);
        uniqueOrders.push(order);
      } else if (!orderId) {
        // Include orders without ID (shouldn't happen, but be safe)
        uniqueOrders.push(order);
      } else {
        // Duplicate found - log warning
        console.warn(`⚠️ [GET_ORDERS_BY_ISO_DATE] Duplicate order_id found: ${orderId} (skipping duplicate)`);
      }
    }
    
    // Filter by payment status if specified
    let finalOrders = uniqueOrders;
    if (paymentStatusFilter) {
      const filterUpper = paymentStatusFilter.toUpperCase();
      finalOrders = uniqueOrders.filter(order => {
        const orderPaymentStatus = (order.payment_status || '').toUpperCase();
        // Match exact or common variations
        if (filterUpper === 'FULLPAID' || filterUpper === 'FULL PAID') {
          return orderPaymentStatus === 'FULLPAID' || orderPaymentStatus === 'FULL PAID' || orderPaymentStatus === 'PAID';
        }
        return orderPaymentStatus === filterUpper;
      });

    }
    
    // Sort by delivery_time (HH:MM format, lexicographically safe)
    finalOrders.sort((a, b) => {
      const timeA = (a.delivery_time || '').trim() || '99:99'; // Missing times go to bottom
      const timeB = (b.delivery_time || '').trim() || '99:99';
      return timeA.localeCompare(timeB);
    });
    
    return finalOrders;
  } catch (error) {
    console.error('❌ [GET_ORDERS_BY_ISO_DATE] Error:', error);
    throw error;
  }
}

/**
 * Get orders by event date (legacy wrapper - now uses getOrdersByISODate)
 * @param {string} targetDate - Date in YYYY-MM-DD format or other formats
 * @param {string} paymentStatusFilter - Optional payment status filter
 * @returns {Promise<Array>} Array of orders sorted by delivery_time
 */
async function getOrdersByDate(targetDate, paymentStatusFilter = null) {
  // Normalize target date to ISO format (YYYY-MM-DD) in Asia/Jakarta
  const targetDateISO = toISODateJakarta(targetDate);
  if (!targetDateISO) {
    console.error(`❌ [GET_ORDERS_BY_DATE] Invalid target date: ${targetDate}`);
    throw new Error(`Invalid target date: ${targetDate}`);
  }

  // Use centralized filter function
  return await getOrdersByISODate(targetDateISO, paymentStatusFilter);
}

/**
 * Format items list for recap (bullet list format)
 * @param {Array|string} itemsJson - Order items array or JSON string
 * @returns {string} Formatted items string with bullet points
 */
function formatItemsForRecap(itemsJson) {
  try {
    // Parse if string
    let items = itemsJson;
    if (typeof itemsJson === 'string') {
      items = JSON.parse(itemsJson);
    }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return '- (tidak ada)';
    }
    
    // Format as bullet list
    return items.map(item => {
      const name = item.name || item.item || 'Unknown';
      const qty = item.quantity || 0;
      return `- ${qty}x ${name}`;
    }).join('\n');
  } catch (error) {
    // Fallback: try to display raw value
    console.warn('⚠️ [FORMAT_ITEMS] Error parsing items_json:', error.message);
    if (typeof itemsJson === 'string' && itemsJson.trim()) {
      return `- ${itemsJson}`;
    }
    return '- (tidak ada)';
  }
}

/**
 * Format notes list for recap (bullet list format)
 * @param {Array|string} notesJson - Order notes array or JSON string
 * @returns {string} Formatted notes string with bullet points
 */
function formatNotesForRecap(notesJson) {
  try {
    // Handle empty/null/undefined
    if (!notesJson || notesJson === '' || notesJson === '[]' || notesJson === 'null') {
      return '- (tidak ada)';
    }
    
    // Parse if string
    let notes = notesJson;
    if (typeof notesJson === 'string') {
      // Try parsing as JSON
      try {
        notes = JSON.parse(notesJson);
      } catch (e) {
        // If not valid JSON, treat as plain string
        if (notesJson.trim()) {
          return `- ${notesJson}`;
        }
        return '- (tidak ada)';
      }
    }
    
    // Handle array
    if (Array.isArray(notes)) {
      if (notes.length === 0) {
        return '- (tidak ada)';
      }
      return notes.map(note => {
        const noteStr = typeof note === 'string' ? note : String(note || '');
        return noteStr.trim() ? `- ${noteStr.trim()}` : '- (tidak ada)';
      }).join('\n');
    }
    
    // Handle single string
    if (typeof notes === 'string' && notes.trim()) {
      return `- ${notes.trim()}`;
    }
    
    return '- (tidak ada)';
  } catch (error) {
    // Fallback: try to display raw value
    console.warn('⚠️ [FORMAT_NOTES] Error parsing notes_json:', error.message);
    if (typeof notesJson === 'string' && notesJson.trim()) {
      return `- ${notesJson}`;
    }
    return '- (tidak ada)';
  }
}

/**
 * Format order recap message (H-1 recap format)
 * @param {Array} orders - Array of orders sorted by delivery_time
 * @param {string} date - Date string (YYYY-MM-DD)
 * @returns {string} Formatted recap message
 */
function formatRecapMessage(orders, date) {
  if (orders.length === 0) {
    return `Tidak ada pesanan untuk besok (${date}).`;
  }
  
  let message = `📋REKAP PESANAN (${date})\n`;
  message += `Total: ${orders.length} pesanan\n\n`;
  
  orders.forEach((order, index) => {
    // Get delivery time (default to --:-- if missing/invalid)
    let deliveryTime = (order.delivery_time || '').trim();
    if (!deliveryTime || !/^\d{2}:\d{2}$/.test(deliveryTime)) {
      deliveryTime = '--:--';
    }
    
    // Get other fields with defaults
    const customerName = order.customer_name || '-';
    const phoneNumber = order.phone_number || '-';
    const address = order.address || '-';
    const paymentStatus = order.payment_status || 'UNPAID';
    const remainingBalance = order.remaining_balance || 0;
    
    // Get items: prefer parsed items array, fallback to items_json string
    const itemsData = order.items || order.items_json || '[]';
    
    // Get notes: prefer parsed notes array, fallback to notes_json string
    const notesData = order.notes || order.notes_json || '[]';
    
    // Calculate total cups and required styrofoam boxes
    let totalCups = 0;
    let hasPackagingInItems = false;
    
    try {
      const items = typeof itemsData === 'string' ? JSON.parse(itemsData) : itemsData;
      if (Array.isArray(items)) {
        items.forEach(item => {
          const qty = parseInt(item.quantity || 0);
          const itemName = (item.name || item.item || '').toLowerCase();
          
          // Check if packaging is in items
          if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
            hasPackagingInItems = true;
            return;
          }
          
          // Check if item is a cup-based product (Dawet Small/Medium/Large)
          if (itemName.includes('dawet') && 
              (itemName.includes('small') || 
               itemName.includes('medium') || 
               itemName.includes('large'))) {
            // Exclude botol items (they're not cups)
            if (!itemName.includes('botol')) {
              totalCups += qty;
            }
          }
        });
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_RECAP] Error calculating total cups:', e.message);
    }
    
    // Calculate styrofoam boxes needed (1 box per 50 cups, rounded up)
    const styrofoamBoxes = totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
    
    // Format items list (replace packaging with calculated quantity)
    let itemsList = '';
    try {
      const items = typeof itemsData === 'string' ? JSON.parse(itemsData) : itemsData;
      if (Array.isArray(items) && items.length > 0) {
        let packagingShown = false;
        items.forEach(item => {
          const itemName = (item.name || item.item || '').toLowerCase();
          
          // If this is a packaging item, show calculated quantity
          if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
            if (styrofoamBoxes > 0) {
              itemsList += `• ${styrofoamBoxes}x Packaging Styrofoam (50 cup)\n`;
              packagingShown = true;
            }
            return; // Skip original packaging item
          }
          
          // Display other items normally
          itemsList += `• ${item.quantity || 0}x ${item.name || item.item || 'Unknown'}\n`;
        });
        
        // If packaging needed but not in items, add it
        if (styrofoamBoxes > 0 && !packagingShown) {
          itemsList += `• ${styrofoamBoxes}x Packaging Styrofoam (50 cup)\n`;
        }
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_RECAP] Error formatting items:', e.message);
      itemsList = '- (tidak ada)\n';
    }
    
    if (!itemsList.trim()) {
      itemsList = '- (tidak ada)\n';
    }
    
    // Format notes (single line format, not bullet list)
    let notesStr = '';
    try {
      let notes = notesData;
      if (typeof notesData === 'string') {
        try {
          notes = JSON.parse(notesData);
        } catch (e) {
          // If not valid JSON, treat as plain string
          if (notesData.trim()) {
            notes = [notesData.trim()];
          } else {
            notes = [];
          }
        }
      }
      
      if (Array.isArray(notes) && notes.length > 0) {
        // Filter out empty notes
        const validNotes = notes.filter(note => note && String(note).trim());
        if (validNotes.length > 0) {
          // Join all notes with newline (single line per note)
          notesStr = validNotes.map(note => String(note).trim()).join('\n');
        } else {
          notesStr = '-';
        }
      } else if (typeof notes === 'string' && notes.trim()) {
        notesStr = notes.trim();
      } else {
        notesStr = '-';
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_RECAP] Error formatting notes:', e.message);
      notesStr = '-';
    }
    
    // Format payment status
    let paymentStatusText = paymentStatus.toUpperCase();
    if (paymentStatus.toUpperCase() === 'FULLPAID' || paymentStatus.toUpperCase() === 'FULL PAID' || paymentStatus.toUpperCase() === 'PAID') {
      paymentStatusText = 'LUNAS';
    } else if (remainingBalance > 0) {
      paymentStatusText = `${paymentStatus} (Sisa: Rp ${formatPrice(remainingBalance)})`;
    }
    
    // Build order block (new format)
    message += `👤 Customer: ${customerName}\n`;
    message += `📞 Phone: ${phoneNumber}\n`;
    message += `📍 Address: ${address}\n\n`;
    message += `🕐 Delivery Time: ${deliveryTime}\n\n`;
    message += `📦 Items:\n${itemsList}`;
    message += `\n📝 Notes:\n${notesStr}\n\n`;
    message += `✅ Payment Status: ${paymentStatusText}\n\n`;
    
    // Add separator between orders (except for the last one)
    if (index < orders.length - 1) {
      message += `─────────────────\n\n`;
    }
  });
  
  return message;
}

/**
 * Format order list message (uses same detailed format as recap)
 * @param {Array} orders - Array of orders sorted by delivery_time
 * @param {string} date - Date string (YYYY-MM-DD)
 * @returns {string} Formatted list message
 */
function formatOrderListMessage(orders, date) {
  if (orders.length === 0) {
    // Ensure consistent empty response format
    return `📅 Tidak ada pesanan untuk tanggal ${date}.`;
  }
  
  // Remove duplicates by order_id (defensive)
  const uniqueOrders = [];
  const seenOrderIds = new Set();
  for (const order of orders) {
    const orderId = order.id || '';
    if (orderId && !seenOrderIds.has(orderId)) {
      seenOrderIds.add(orderId);
      uniqueOrders.push(order);
    } else if (!orderId) {
      // Include orders without ID (shouldn't happen, but be safe)
      uniqueOrders.push(order);
    }
  }
  
  // Use same format as recap message
  let message = `📋REKAP PESANAN (${date})\n`;
  message += `Total: ${uniqueOrders.length} pesanan\n\n`;
  
  uniqueOrders.forEach((order, index) => {
    // Get delivery time (default to --:-- if missing/invalid)
    let deliveryTime = (order.delivery_time || '').trim();
    if (!deliveryTime || !/^\d{2}:\d{2}$/.test(deliveryTime)) {
      deliveryTime = '--:--';
    }
    
    // Get other fields with defaults
    const customerName = order.customer_name || '-';
    const phoneNumber = order.phone_number || '-';
    const address = order.address || '-';
    const paymentStatus = order.payment_status || 'UNPAID';
    const remainingBalance = order.remaining_balance || 0;
    const deliveryMethod = order.delivery_method || order.shipping_method || '-';
    
    // Get invoice totals
    const productTotal = parseFloat(order.product_total || 0);
    const packagingFee = parseFloat(order.packaging_fee || 0);
    const deliveryFee = parseFloat(order.delivery_fee || 0);
    const finalTotal = parseFloat(order.total_amount || order.final_total || 0);
    
    // Get items: prefer parsed items array, fallback to items_json string
    const itemsData = order.items || order.items_json || '[]';
    
    // Get notes: prefer parsed notes array, fallback to notes_json string
    const notesData = order.notes || order.notes_json || '[]';
    
    // Calculate total cups and required styrofoam boxes
    let totalCups = 0;
    let hasPackagingInItems = false;
    
    try {
      const items = typeof itemsData === 'string' ? JSON.parse(itemsData) : itemsData;
      if (Array.isArray(items)) {
        items.forEach(item => {
          const qty = parseInt(item.quantity || 0);
          const itemName = (item.name || item.item || '').toLowerCase();
          
          // Check if packaging is in items
          if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
            hasPackagingInItems = true;
            return;
          }
          
          // Check if item is a cup-based product (Dawet Small/Medium/Large)
          if (itemName.includes('dawet') && 
              (itemName.includes('small') || 
               itemName.includes('medium') || 
               itemName.includes('large'))) {
            // Exclude botol items (they're not cups)
            if (!itemName.includes('botol')) {
              totalCups += qty;
            }
          }
        });
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_ORDER_LIST] Error calculating total cups:', e.message);
    }
    
    // Calculate styrofoam boxes needed (1 box per 50 cups, rounded up)
    const styrofoamBoxes = totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
    
    // Format items list (replace packaging with calculated quantity)
    let itemsList = '';
    try {
      const items = typeof itemsData === 'string' ? JSON.parse(itemsData) : itemsData;
      if (Array.isArray(items) && items.length > 0) {
        let packagingShown = false;
        items.forEach(item => {
          const itemName = (item.name || item.item || '').toLowerCase();
          
          // If this is a packaging item, show calculated quantity
          if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
            if (styrofoamBoxes > 0) {
              itemsList += `• ${styrofoamBoxes}x Packaging Styrofoam (50 cup)\n`;
              packagingShown = true;
            }
            return; // Skip original packaging item
          }
          
          // Display other items normally
          itemsList += `• ${item.quantity || 0}x ${item.name || item.item || 'Unknown'}\n`;
        });
        
        // If packaging needed but not in items, add it
        if (styrofoamBoxes > 0 && !packagingShown) {
          itemsList += `• ${styrofoamBoxes}x Packaging Styrofoam (50 cup)\n`;
        }
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_ORDER_LIST] Error formatting items:', e.message);
      itemsList = '- (tidak ada)\n';
    }
    
    if (!itemsList.trim()) {
      itemsList = '- (tidak ada)\n';
    }
    
    // Format notes (single line format, not bullet list)
    let notesStr = '';
    try {
      let notes = notesData;
      if (typeof notesData === 'string') {
        try {
          notes = JSON.parse(notesData);
        } catch (e) {
          // If not valid JSON, treat as plain string
          if (notesData.trim()) {
            notes = [notesData.trim()];
          } else {
            notes = [];
          }
        }
      }
      
      if (Array.isArray(notes) && notes.length > 0) {
        // Filter out empty notes and packaging-related notes
        const validNotes = notes.filter(note => {
          const noteStr = String(note || '').trim();
          if (!noteStr) return false;
          // Filter out packaging-related notes
          const noteLower = noteStr.toLowerCase();
          if (noteLower.includes('packaging styrofoam') || 
              noteLower.includes('packaging:') ||
              noteLower === 'packaging styrofoam' ||
              noteLower === 'ya' ||
              noteLower === 'tidak') {
            return false;
          }
          return true;
        });
        if (validNotes.length > 0) {
          // Join all notes with newline (single line per note)
          notesStr = validNotes.map(note => String(note).trim()).join('\n');
        } else {
          notesStr = '-';
        }
      } else if (typeof notes === 'string' && notes.trim()) {
        const noteStr = notes.trim();
        // Filter out packaging-related notes
        const noteLower = noteStr.toLowerCase();
        if (noteLower.includes('packaging styrofoam') || 
            noteLower.includes('packaging:') ||
            noteLower === 'packaging styrofoam' ||
            noteLower === 'ya' ||
            noteLower === 'tidak') {
          notesStr = '-';
        } else {
          notesStr = noteStr;
        }
      } else {
        notesStr = '-';
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_ORDER_LIST] Error formatting notes:', e.message);
      notesStr = '-';
    }
    
    // Format payment status
    let paymentStatusText = paymentStatus.toUpperCase();
    if (paymentStatus.toUpperCase() === 'FULLPAID' || paymentStatus.toUpperCase() === 'FULL PAID' || paymentStatus.toUpperCase() === 'PAID') {
      paymentStatusText = 'LUNAS';
    } else if (remainingBalance > 0) {
      paymentStatusText = `${paymentStatus} (Sisa: Rp ${formatPrice(remainingBalance)})`;
    }
    
    // Build order block (new format)
    const invoiceNumber = order.id || '-';
    message += `🧾 Invoice: ${invoiceNumber}\n`;
    message += `👤 Customer: ${customerName}\n`;
    message += `📞 Phone: ${phoneNumber}\n`;
    message += `📍 Address: ${address}\n\n`;
    message += `🕐 Delivery Time: ${deliveryTime}\n`;
    message += `🚚 Delivery Method: ${deliveryMethod}\n\n`;
    message += `📦 Items:\n${itemsList}`;
    message += `\n📝 Notes:\n${notesStr}\n\n`;
    message += `✅ Payment Status: ${paymentStatusText}\n\n`;
    
    // Add separator between orders (except for the last one)
    if (index < uniqueOrders.length - 1) {
      message += `─────────────────\n\n`;
    }
  });
  
  return message;
}

/**
 * Get today's date in YYYY-MM-DD format (local timezone)
 * @returns {string} Today's date
 */
/**
 * Get today's date in Asia/Jakarta timezone as ISO string (YYYY-MM-DD)
 * @returns {string} Today's date in YYYY-MM-DD format
 */
function getTodayDate() {
  return getJakartaTodayISO();
}

/**
 * Get tomorrow's date in Asia/Jakarta timezone as ISO string (YYYY-MM-DD)
 * @returns {string} Tomorrow's date in YYYY-MM-DD format
 */
function getTomorrowDate() {
  const todayISO = getJakartaTodayISO();
  return addDaysJakarta(todayISO, 1);
}

/**
 * Handle /recap_h1 command - Show tomorrow's orders recap
 * @param {string} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleRecapH1(chatId, userId, sendMessage) {
  try {

    // Check admin access
    if (!(await isAdmin(userId))) {
      await sendMessage(chatId, 'Maaf, command ini hanya untuk admin.');
      return;
    }
    
    // Get tomorrow's date
    const tomorrow = getTomorrowDate();

    // Get orders for tomorrow (filter by FULLPAID only)
    const orders = await getOrdersByDate(tomorrow, 'FULLPAID');

    // Log first 3 order IDs for sanity check
    if (orders.length > 0) {
      const orderIds = orders.slice(0, 3).map(o => o.id).join(', ');

    }
    
    // Format and send recap message
    const message = formatRecapMessage(orders, tomorrow);
    await sendMessage(chatId, message);

  } catch (error) {
    console.error('❌ [RECAP_H1] Error:', error);
    console.error('❌ [RECAP_H1] Stack:', error.stack);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil rekapan pesanan. Silakan coba lagi.');
  }
}

/**
 * Handle /orders_date command - Show orders for a specific date
 * @param {string} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {string} dateStr - Date string (YYYY-MM-DD) or 'today' or 'tomorrow'
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleOrdersDate(chatId, userId, dateStr, sendMessage) {
  try {

    // Check admin access
    if (!(await isAdmin(userId))) {
      await sendMessage(chatId, 'Maaf, command ini hanya untuk admin.');
      return;
    }
    
    // Determine target date (normalized to ISO in Asia/Jakarta)
    let targetDate;
    if (dateStr === 'today' || dateStr === 'hari ini') {
      targetDate = getTodayDate();

    } else if (dateStr === 'tomorrow' || dateStr === 'besok') {
      targetDate = getTomorrowDate();

    } else {
      // Validate and normalize date format
      // Accept YYYY-MM-DD, DD/MM/YYYY, or other formats (will be normalized)
      const normalized = toISODateJakarta(dateStr);
      if (!normalized) {
        await sendMessage(chatId, '❌ Format tanggal tidak valid. Gunakan: YYYY-MM-DD atau DD/MM/YYYY\n\nContoh: /orders_date 2026-01-18\nAtau: /orders_today, /orders_tomorrow');
        return;
      }
      targetDate = normalized;
    }
    
    console.log(`🔍 [ORDERS_DATE] Fetching orders for date: ${targetDate} (normalized)`);
    
    // Get orders for target date (filter by FULLPAID only)
    const orders = await getOrdersByDate(targetDate, 'FULLPAID');

    // Debug logging
    if (dateStr === 'today' || dateStr === 'hari ini') {

    } else if (dateStr === 'tomorrow' || dateStr === 'besok') {

    }
    
    // Log first 3 order IDs for sanity check
    if (orders.length > 0) {
      const orderIds = orders.slice(0, 3).map(o => o.id).join(', ');

    }
    
    // Format and send list message
    const message = formatOrderListMessage(orders, targetDate);
    await sendMessage(chatId, message);

  } catch (error) {
    console.error('❌ [ORDERS_DATE] Error:', error);
    console.error('❌ [ORDERS_DATE] Stack:', error.stack);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil daftar pesanan. Silakan coba lagi.');
  }
}

/**
 * Format order data into editable form template (pre-filled with existing data)
 * @param {Object} order - Order object from database
 * @returns {string} Formatted order form template
 */
function formatOrderFormTemplate(order) {
  // Get items as formatted string
  const itemsText = (order.items || []).map(item => 
    `${item.quantity}x ${item.name}`
  ).join('\n') || '';

  // Get all notes first (to check for packaging)
  const allNotes = order.notes || [];
  
  // Check if packaging is requested (check original notes before filtering)
  const hasPackaging = allNotes.some(note => {
    const noteLower = String(note || '').toLowerCase().trim();
    return noteLower.includes('packaging styrofoam') && 
           (noteLower.includes(': ya') || noteLower.includes(': yes') || 
            noteLower === 'packaging styrofoam: ya' || noteLower === 'packaging styrofoam: yes');
  });
  
  // Filter out packaging notes for display
  const notes = allNotes.filter(note => {
    const noteLower = String(note || '').toLowerCase().trim();
    return !(noteLower.includes('packaging styrofoam') && 
             (noteLower.includes(': ya') || noteLower.includes(': yes') || 
              noteLower === 'packaging styrofoam: ya' || noteLower === 'packaging styrofoam: yes'));
  });
  const notesText = notes.join('\n') || '';

  // Format event date (convert YYYY-MM-DD to DD/MM/YYYY if needed)
  let eventDateFormatted = order.event_date || '';
  if (eventDateFormatted && eventDateFormatted.includes('-')) {
    const parts = eventDateFormatted.split('-');
    if (parts.length === 3) {
      eventDateFormatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }

  // Format delivery time (ensure HH:MM format)
  let deliveryTimeFormatted = order.delivery_time || '';
  if (deliveryTimeFormatted && !deliveryTimeFormatted.includes(':')) {
    // If time is in wrong format, try to fix it
    deliveryTimeFormatted = deliveryTimeFormatted.replace(/\./g, ':');
  }

  // Format delivery fee
  const deliveryFeeFormatted = order.delivery_fee 
    ? (typeof order.delivery_fee === 'number' ? order.delivery_fee.toString() : order.delivery_fee)
    : '';

  // Build form template (include Invoice field so parser can detect edit mode)
  let form = `📝 **EDIT ORDER**\n\n`;
  form += `**Invoice:** ${order.id || 'N/A'}\n\n`;
  form += `Silakan edit form berikut dan kirim kembali:\n\n`;
  form += `Invoice: ${order.id || 'N/A'}\n`;
  form += `Nama Pemesan: ${order.customer_name || ''}\n`;
  form += `Nama Penerima: ${order.receiver_name || order.customer_name || ''}\n`;
  form += `No HP Penerima: ${order.phone_number || ''}\n`;
  form += `Alamat Penerima: ${order.address || ''}\n\n`;
  form += `Nama Event (jika ada): ${order.event_name || ''}\n`;
  form += `Durasi Event (dalam jam): ${order.event_duration || ''}\n\n`;
  form += `Tanggal Event: ${eventDateFormatted}\n`;
  form += `Waktu Kirim (jam): ${deliveryTimeFormatted}\n\n`;
  form += `Detail Pesanan:\n${itemsText}\n\n`;
  form += `Packaging Styrofoam\n`;
  form += `(1 box Rp40.000 untuk 50 cup): ${hasPackaging ? 'YA' : 'TIDAK'}\n\n`;
  form += `Metode Pengiriman: ${order.delivery_method || 'Pickup'}\n\n`;
  form += `Biaya Pengiriman (Rp): ${deliveryFeeFormatted}\n\n`;
  form += `Notes:\n${notesText}\n\n`;
  form += `Mendapatkan info Dawet Kemayu Menteng dari:\n`;
  form += `${order.source || 'Teman / Instagram / Facebook / TikTok / Lainnya'}`;

  return form;
}

/**
 * Handle /edit command
 * Updates order with new data from form
 * Accepts: /edit ORDER_ID followed by updated form in same message or reply
 * Automatically compares fields and updates only changed values
 * @param {string|number} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {string} messageText - Full message text (command + form)
 * @param {Function} sendMessage - Function to send Telegram message
 * @param {Object} replyToMessage - Optional reply_to_message object
 */
export async function handleEditOrder(chatId, userId, messageText, sendMessage, replyToMessage = null) {
  logger.debug(`[EDIT_ORDER] Command received - chatId: ${chatId}, userId: ${userId}`);
  
  try {
    // Check admin access
    if (!(await requireAdmin(userId, sendMessage, chatId))) {
      return;
    }

    // Extract order ID and form data
    let orderId = null;
    let formText = '';
    
    // Method 1: Check if form is in reply_to_message
    if (replyToMessage && replyToMessage.text) {
      formText = replyToMessage.text.trim();
      // Extract order ID from command message (first line)
      const commandMatch = messageText.match(/^\/edit\s+(DKM\/\d{8}\/\d{6})/i);
      if (commandMatch) {
        orderId = commandMatch[1];
      }
      logger.debug(`[EDIT_ORDER] Using reply_to_message - orderId: ${orderId}, form length: ${formText.length}`);
    } else {
      // Method 2: Extract from same message
      // Format: /edit ORDER_ID\n[form] - form starts after first newline
      const lines = messageText.split('\n');
      const firstLine = lines[0] || '';
      
      // Try to extract order ID from first line
      const orderIdMatch = firstLine.match(/^\/edit\s+(DKM\/\d{8}\/\d{6})/i);
      if (orderIdMatch) {
        orderId = orderIdMatch[1];
        // Form is everything after first line (remove empty lines at start)
        formText = lines.slice(1).join('\n').trim();
        logger.debug(`[EDIT_ORDER] Extracted from same message - orderId: ${orderId}, form length: ${formText.length}`);
      } else {
        // Fallback: Try to find order ID anywhere in message
        const orderIdPattern = /(DKM\/\d{8}\/\d{6})/i;
        const globalMatch = messageText.match(orderIdPattern);
        if (globalMatch) {
          orderId = globalMatch[1];
          // Remove command line and order ID from form text
          formText = messageText
            .replace(/^\/edit\s*/i, '')
            .replace(new RegExp(orderId, 'gi'), '')
            .trim();
          logger.debug(`[EDIT_ORDER] Found order ID in message - orderId: ${orderId}, form length: ${formText.length}`);
        }
      }
    }

    // Validate order ID
    if (!orderId || !orderId.trim()) {
      await sendMessage(
        chatId,
        '❌ Format: /edit <ORDER_ID>\n\n' +
        'Kemudian kirim form pesanan yang sudah diupdate.\n\n' +
        '**Contoh penggunaan (1 pesan):**\n' +
        '/edit DKM/20260107/000037\n\n' +
        'Nama Pemesan: Novi\n' +
        'No HP Penerima: 081234567\n' +
        'Alamat Penerima: ...\n' +
        '(form lengkap)\n\n' +
        '**Atau (2 pesan):**\n' +
        '1. Ketik: /edit DKM/20260107/000037\n' +
        '2. Reply pesan tersebut dengan form yang sudah diedit'
      );
      return;
    }

    const trimmedOrderId = orderId.trim();
    
    // Validate form text
    if (!formText || formText.length < 50) {
      await sendMessage(
        chatId,
        '❌ Form pesanan tidak ditemukan atau terlalu pendek.\n\n' +
        'Pastikan Anda mengirim form pesanan lengkap setelah perintah /edit.\n\n' +
        '**Format:**\n' +
        '/edit DKM/20260107/000037\n\n' +
        'Nama Pemesan: ...\n' +
        'No HP Penerima: ...\n' +
        'Alamat Penerima: ...\n' +
        '(form lengkap)'
      );
      return;
    }

    logger.debug(`[EDIT_ORDER] Looking up order: ${trimmedOrderId}`);

    // Fetch existing order
    const existingOrder = await getOrderById(trimmedOrderId);
    
    if (!existingOrder) {
      await sendMessage(chatId, `❌ Order ID "${trimmedOrderId}" tidak ditemukan.`);
      return;
    }

    logger.debug(`✅ [EDIT_ORDER] Order found: ${existingOrder.id}`);

    // Parse the updated form
    logger.debug(`[EDIT_ORDER] Parsing form text (${formText.length} chars)...`);
    const parsedOrder = parseOrderFromMessageAuto(formText);
    
    // Log parsed items for debugging
    logger.debug(`[EDIT_ORDER] Parsed items:`, JSON.stringify(parsedOrder.items, null, 2));
    logger.debug(`[EDIT_ORDER] Parsed items count: ${parsedOrder.items.length}`);
    parsedOrder.items.forEach((item, idx) => {
      logger.debug(`[EDIT_ORDER] Item ${idx + 1}: ${item.quantity}x ${item.name}`);
    });
    
    const validation = validateOrder(parsedOrder);

    if (!validation.valid) {
      await sendMessage(
        chatId,
        `❌ **Form tidak valid**\n\n` +
        `Kesalahan:\n${validation.errors.join('\n')}\n\n` +
        `Silakan perbaiki dan coba lagi.`
      );
      return;
    }

    // Prepare updated order data - merge parsed form with existing order
    // Support partial updates: only update fields that are provided in form
    // For fields not in form, keep existing values
    const updatedOrderData = {
      id: trimmedOrderId, // Keep same order ID (required for update)
    };
    
    // Track which fields changed (for logging)
    const changedFields = [];
    
    // Merge strategy: Use parsed value if provided, otherwise keep existing
    // Required fields (always update if provided in form)
    if (parsedOrder.customer_name) {
      if (parsedOrder.customer_name !== existingOrder.customer_name) {
        updatedOrderData.customer_name = parsedOrder.customer_name;
        changedFields.push('customer_name');
      } else {
        updatedOrderData.customer_name = existingOrder.customer_name;
      }
    } else {
      updatedOrderData.customer_name = existingOrder.customer_name;
    }
    
    if (parsedOrder.phone_number) {
      if (parsedOrder.phone_number !== existingOrder.phone_number) {
        updatedOrderData.phone_number = parsedOrder.phone_number;
        changedFields.push('phone_number');
      } else {
        updatedOrderData.phone_number = existingOrder.phone_number;
      }
    } else {
      updatedOrderData.phone_number = existingOrder.phone_number;
    }
    
    if (parsedOrder.address) {
      if (parsedOrder.address !== existingOrder.address) {
        updatedOrderData.address = parsedOrder.address;
        changedFields.push('address');
      } else {
        updatedOrderData.address = existingOrder.address;
      }
    } else {
      updatedOrderData.address = existingOrder.address;
    }
    
    // Optional fields - update if provided, keep existing if not
    updatedOrderData.receiver_name = parsedOrder.receiver_name !== null && parsedOrder.receiver_name !== undefined 
      ? parsedOrder.receiver_name 
      : (existingOrder.receiver_name || '');
    if (updatedOrderData.receiver_name !== (existingOrder.receiver_name || '')) {
      changedFields.push('receiver_name');
    }
    
    updatedOrderData.event_name = parsedOrder.event_name !== null && parsedOrder.event_name !== undefined 
      ? parsedOrder.event_name 
      : (existingOrder.event_name || '');
    if (updatedOrderData.event_name !== (existingOrder.event_name || '')) {
      changedFields.push('event_name');
    }
    
    updatedOrderData.event_duration = parsedOrder.event_duration !== null && parsedOrder.event_duration !== undefined 
      ? parsedOrder.event_duration 
      : (existingOrder.event_duration || '');
    if (updatedOrderData.event_duration !== (existingOrder.event_duration || '')) {
      changedFields.push('event_duration');
    }
    
    updatedOrderData.event_date = parsedOrder.event_date || (existingOrder.event_date || '');
    if (updatedOrderData.event_date !== (existingOrder.event_date || '')) {
      changedFields.push('event_date');
    }
    
    updatedOrderData.delivery_time = parsedOrder.delivery_time || (existingOrder.delivery_time || '');
    if (updatedOrderData.delivery_time !== (existingOrder.delivery_time || '')) {
      changedFields.push('delivery_time');
    }
    
    // Items - update if provided in form
    // CRITICAL: Always use parsed items if they exist (form was provided)
    if (parsedOrder.items && parsedOrder.items.length > 0) {
      const existingItemsJson = JSON.stringify(existingOrder.items || []);
      const parsedItemsJson = JSON.stringify(parsedOrder.items);
      
      logger.debug(`[EDIT_ORDER] Comparing items:`);
      logger.debug(`[EDIT_ORDER] Existing: ${existingItemsJson}`);
      logger.debug(`[EDIT_ORDER] Parsed: ${parsedItemsJson}`);
      
      if (parsedItemsJson !== existingItemsJson) {
        updatedOrderData.items = parsedOrder.items; // Use parsed items (from form)
        changedFields.push('items');
        logger.debug(`[EDIT_ORDER] Items changed - using parsed items:`, JSON.stringify(parsedOrder.items));
      } else {
        updatedOrderData.items = existingOrder.items;
        logger.debug(`[EDIT_ORDER] Items unchanged - keeping existing`);
      }
    } else {
      // No items in form - keep existing
      updatedOrderData.items = existingOrder.items;
      logger.debug(`[EDIT_ORDER] No items in parsed form - keeping existing items`);
    }
    
    // Notes - update if provided in form
    if (parsedOrder.notes && parsedOrder.notes.length > 0) {
      const existingNotesJson = JSON.stringify(existingOrder.notes || []);
      const parsedNotesJson = JSON.stringify(parsedOrder.notes);
      if (parsedNotesJson !== existingNotesJson) {
        updatedOrderData.notes = parsedOrder.notes;
        changedFields.push('notes');
      } else {
        updatedOrderData.notes = existingOrder.notes;
      }
    } else {
      updatedOrderData.notes = existingOrder.notes;
    }
    
    // Delivery method - update if provided
    updatedOrderData.delivery_method = parsedOrder.delivery_method || (existingOrder.delivery_method || 'Pickup');
    if (updatedOrderData.delivery_method !== (existingOrder.delivery_method || 'Pickup')) {
      changedFields.push('delivery_method');
    }
    
    // Delivery fee - update if provided (handle null/0 explicitly)
    const existingDeliveryFee = existingOrder.delivery_fee !== null && existingOrder.delivery_fee !== undefined ? existingOrder.delivery_fee : null;
    const parsedDeliveryFee = parsedOrder.delivery_fee !== null && parsedOrder.delivery_fee !== undefined ? parsedOrder.delivery_fee : null;
    
    // If delivery_fee is explicitly provided in form (even if 0), use it
    // Otherwise keep existing
    if (parsedOrder.delivery_fee !== null && parsedOrder.delivery_fee !== undefined) {
      updatedOrderData.delivery_fee = parsedDeliveryFee;
      if (parsedDeliveryFee !== existingDeliveryFee) {
        changedFields.push('delivery_fee');
      }
    } else {
      updatedOrderData.delivery_fee = existingDeliveryFee;
    }
    
    // Preserve existing metadata (don't change on edit)
    updatedOrderData.status = existingOrder.status || 'pending';
    updatedOrderData.created_at = existingOrder.created_at;
    updatedOrderData.conversation_id = existingOrder.conversation_id || '';
    
    // Log what changed
    if (changedFields.length > 0) {
      logger.debug(`[EDIT_ORDER] Changed fields: ${changedFields.join(', ')}`);
    } else {
      logger.debug(`[EDIT_ORDER] No fields changed (form matches existing order)`);
    }

    // Save updated order (saveOrder handles upsert - updates if exists, creates if new)
    // saveOrder will calculate totals including packaging fee and save to Google Sheets
    logger.debug(`[EDIT_ORDER] Saving order ${trimmedOrderId} to Google Sheets...`);
    
    // CRITICAL: Log what we're about to save
    logger.debug(`[EDIT_ORDER] About to save order with items:`, JSON.stringify(updatedOrderData.items, null, 2));
    logger.debug(`[EDIT_ORDER] Items JSON string:`, JSON.stringify(updatedOrderData.items));
    
    // CRITICAL: Save order to Google Sheets - this MUST persist the update
    const savedOrder = await saveOrder(updatedOrderData);
    
    logger.debug(`[EDIT_ORDER] Order saved successfully. Totals:`, {
      productTotal: savedOrder.productTotal,
      packagingFee: savedOrder.packagingFee,
      deliveryFee: savedOrder.deliveryFee,
      totalAmount: savedOrder.totalAmount
    });
    
    // CRITICAL: Re-read order from Google Sheets to verify update persisted
    // This ensures we display what's actually in the sheet, not what we think we saved
    logger.debug(`[EDIT_ORDER] Re-reading order from Google Sheets to verify update...`);
    
    // Wait a moment for Google Sheets to update (sometimes there's a slight delay)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const verifiedOrder = await getOrderById(trimmedOrderId);
    
    if (!verifiedOrder) {
      logger.error(`[EDIT_ORDER] CRITICAL: Order ${trimmedOrderId} not found after save!`);
      await sendMessage(chatId, `❌ Error: Order tidak ditemukan setelah update. Silakan coba lagi.`);
      return;
    }
    
    logger.debug(`[EDIT_ORDER] Verified: Order ${trimmedOrderId} exists in Google Sheets`);
    logger.debug(`[EDIT_ORDER] Verified order items:`, JSON.stringify(verifiedOrder.items, null, 2));
    
    // Use verified order data for display (single source of truth)
    const displayOrder = verifiedOrder;

    // Get price list for display calculations
    const priceList = await getPriceList();
    
    // Use verified order from Google Sheets (single source of truth)
    const displayItems = displayOrder.items || [];
    
    // CRITICAL: Log what we're displaying
    logger.debug(`[EDIT_ORDER] Display items from verified order:`, JSON.stringify(displayItems, null, 2));
    displayItems.forEach((item, idx) => {
      logger.debug(`[EDIT_ORDER] Display item ${idx + 1}: ${item.quantity}x ${item.name}`);
    });
    
    const calculation = calculateOrderTotal(displayItems, priceList);

    // Calculate packaging info (for display) from verified order
    let totalCups = 0;
    let hasPackagingRequest = false;
    
    // Count total cups from items (Dawet Small/Medium/Large, excluding botol)
    displayItems.forEach(item => {
      const itemName = (item.name || '').toLowerCase();
      if (itemName.includes('dawet') && 
          (itemName.includes('small') || itemName.includes('medium') || itemName.includes('large'))) {
        if (!itemName.includes('botol')) {
          totalCups += parseInt(item.quantity || 0);
        }
      }
    });
    
    // Check if packaging is requested in notes
    const notes = displayOrder.notes || [];
    hasPackagingRequest = notes.some(note => {
      const noteLower = String(note || '').toLowerCase().trim();
      return noteLower.includes('packaging styrofoam') && 
             (noteLower.includes(': ya') || noteLower.includes(': yes') || 
              noteLower === 'packaging styrofoam: ya' || noteLower === 'packaging styrofoam: yes');
    });
    
    // Calculate required packaging boxes (1 box per 50 cups, rounded up)
    const packagingBoxes = hasPackagingRequest && totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
    
    // Use packaging fee from saved order (calculated by computeOrderTotals)
    const packagingFee = savedOrder.packagingFee || (packagingBoxes * 40000);

    // Format update summary using verified order data
    let summary = `✅ **ORDER UPDATED**\n\n`;
    summary += `📋 Order ID: ${trimmedOrderId}\n`;
    summary += `👤 Customer: ${displayOrder.customer_name || 'N/A'}\n`;
    summary += `📞 Phone: ${displayOrder.phone_number || 'N/A'}\n`;
    summary += `📍 Address: ${displayOrder.address || 'N/A'}\n`;
    if (displayOrder.event_name) {
      summary += `📅 Event: ${displayOrder.event_name}\n`;
    }
    if (displayOrder.event_date) {
      summary += `📅 Event Date: ${displayOrder.event_date}\n`;
    }
    if (displayOrder.delivery_time) {
      summary += `🕐 Delivery Time: ${displayOrder.delivery_time}\n`;
    }
    if (displayOrder.delivery_method) {
      summary += `🚚 Delivery Method: ${displayOrder.delivery_method}\n`;
    }
    summary += `\n📦 **Items:**\n`;
    
    // Display regular items (filter out any packaging items that might be in the list)
    let itemIndex = 1;
    calculation.itemDetails.forEach((item) => {
      const itemName = (item.name || '').toLowerCase();
      // Skip packaging items (we'll add calculated one below)
      if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
        return;
      }
      summary += `${itemIndex}. ${item.name} (${item.quantity}x)\n`;
      if (item.itemTotal > 0) {
        summary += `   Subtotal: Rp ${formatPrice(item.itemTotal)}\n`;
      }
      itemIndex++;
    });
    
    // Add packaging item if requested (use saved packaging fee from computeOrderTotals)
    if (hasPackagingRequest && packagingBoxes > 0 && packagingFee > 0) {
      summary += `${itemIndex}. Packaging Styrofoam (50 cup) (${packagingBoxes}x)\n`;
      summary += `   Subtotal: Rp ${formatPrice(packagingFee)}\n`;
    }
    
    // Use totals from savedOrder (which includes packaging fee calculated by computeOrderTotals)
    const productTotal = savedOrder.productTotal || calculation.subtotal;
    const totalWithPackaging = productTotal + packagingFee;
    const deliveryFee = savedOrder.deliveryFee || displayOrder.delivery_fee || 0;
    const grandTotal = savedOrder.totalAmount || (totalWithPackaging + deliveryFee);
    
    summary += `\n💰 **Product Total: Rp ${formatPrice(productTotal)}**\n`;
    if (packagingFee > 0) {
      summary += `📦 **Packaging Fee: Rp ${formatPrice(packagingFee)}**\n`;
    }
    summary += `💰 **Subtotal: Rp ${formatPrice(totalWithPackaging)}**\n`;
    if (deliveryFee > 0) {
      summary += `🚚 **Delivery Fee: Rp ${formatPrice(deliveryFee)}**\n`;
    }
    summary += `💰 **Grand Total: Rp ${formatPrice(grandTotal)}**\n`;
    summary += `\n✅ Order berhasil diperbarui!`;

    await sendMessage(chatId, summary);
    logger.debug(`✅ [EDIT_ORDER] Order ${trimmedOrderId} updated successfully in Google Sheets`);
  } catch (error) {
    logger.error('[EDIT_ORDER] Error:', error);
    logger.error('[EDIT_ORDER] Stack:', error.stack);
    await sendMessage(chatId, `❌ Maaf, ada error saat memproses perintah ini: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Handle /cancel command
 * Cancel an order (admin only)
 * @param {number} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {string} orderId - Order ID to cancel
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleCancel(chatId, userId, orderId, sendMessage) {

  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
    return;
  }

  if (!orderId) {
    await sendMessage(chatId, '❌ Format: `/cancel <ORDER_ID>`\n\nContoh: `/cancel DKM/20260104/000001`');
    return;
  }

  try {
    const order = await getOrderById(orderId);
    if (!order) {
      await sendMessage(chatId, `❌ Order \`${orderId}\` tidak ditemukan.`);
      return;
    }

    // Check if already cancelled or completed
    const currentStatus = order.status || '';
    if (currentStatus.toLowerCase() === 'cancelled' || currentStatus.toLowerCase() === 'completed') {
      await sendMessage(
        chatId,
        `ℹ️ Order \`${orderId}\` sudah berstatus: **${currentStatus}**\n\n` +
        'Tidak dapat dibatalkan lagi.'
      );
      return;
    }

    // Update status to CANCELLED
    await updateOrderStatus(orderId, 'cancelled');
    
    // Try to notify customer (if conversation_id exists)
    // Note: sendMessage function is not available here, so we'll skip customer notification
    // Customer will see status update when they check order status
    console.log(`ℹ️ [CANCEL] Customer notification skipped (use order-status-notifications for full notification)`);

    await sendMessage(
      chatId,
      `✅ Order \`${orderId}\` berhasil dibatalkan.\n\n` +
      `Status: **CANCELLED**\n` +
      `Alasan: Dibatalkan oleh admin`
    );
  } catch (error) {
    console.error('❌ [CANCEL] Error cancelling order:', error);
    console.error('❌ [CANCEL] Stack:', error.stack);
    await sendMessage(chatId, `❌ Terjadi kesalahan: ${error.message || 'Gagal membatalkan pesanan.'}`);
  }
}

/**
 * Handle /complete command
 * Mark an order as completed (admin only)
 * @param {number} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {string} orderId - Order ID to complete
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleComplete(chatId, userId, orderId, sendMessage) {

  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
    return;
  }

  if (!orderId) {
    await sendMessage(chatId, '❌ Format: `/complete <ORDER_ID>`\n\nContoh: `/complete DKM/20260104/000001`');
    return;
  }

  try {
    const order = await getOrderById(orderId);
    if (!order) {
      await sendMessage(chatId, `❌ Order \`${orderId}\` tidak ditemukan.`);
      return;
    }

    // Check if already cancelled
    const currentStatus = order.status || '';
    if (currentStatus.toLowerCase() === 'cancelled') {
      await sendMessage(
        chatId,
        `❌ Order \`${orderId}\` sudah dibatalkan. Tidak dapat diselesaikan.`
      );
      return;
    }

    // Check if already completed
    if (currentStatus.toLowerCase() === 'completed') {
      await sendMessage(
        chatId,
        `ℹ️ Order \`${orderId}\` sudah berstatus: **COMPLETED**`
      );
      return;
    }

    // Warn if not in delivered/confirmed state (preferred: require DELIVERED)
    if (currentStatus.toLowerCase() !== 'delivered' && currentStatus.toLowerCase() !== 'confirmed') {
      console.warn(`⚠️ [COMPLETE] Order ${orderId} status is ${currentStatus}, not DELIVERED/CONFIRMED`);
      // Continue anyway but log warning
    }

    // Update status to COMPLETED
    await updateOrderStatus(orderId, 'completed');
    
    // Try to notify customer (if conversation_id exists)
    // Note: sendMessage function is not available here, so we'll skip customer notification
    // Customer will see status update when they check order status
    console.log(`ℹ️ [COMPLETE] Customer notification skipped (use order-status-notifications for full notification)`);

    await sendMessage(
      chatId,
      `✅ Order \`${orderId}\` berhasil ditandai sebagai selesai.\n\n` +
      `Status: **COMPLETED**`
    );
  } catch (error) {
    console.error('❌ [COMPLETE] Error completing order:', error);
    console.error('❌ [COMPLETE] Stack:', error.stack);
    await sendMessage(chatId, `❌ Terjadi kesalahan: ${error.message || 'Gagal menyelesaikan pesanan.'}`);
  }
}
