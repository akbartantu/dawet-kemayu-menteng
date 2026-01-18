/**
 * Payment Commands
 * Handles payment-related admin commands and OCR helpers
 */

import { getOrderById, updateOrderPayment, updateOrderPaymentWithEvidence } from '../repos/orders.repo.js';
import { formatPrice, formatCurrencyIDR } from '../utils/formatting.js';
import { formatPaymentStatusMessage, detectSuspiciousPayment, parseIDRAmount } from '../services/payment-tracker.js';
import { requireAdmin } from '../middleware/adminGuard.js';
import { pendingPaymentConfirmations } from '../state/store.js';
import { extractAmount as extractAmountFromImageNew } from '../../services/ocr-service.js';

/**
 * Extract amount/nominal from image using OCR with watermark-resistant preprocessing
 * Uses the new OCR service with Sharp preprocessing
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
        console.warn(`⚠️ [OCR_AMOUNT] OCR error: ${result.error}`);
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
            if (text.length > 0) {
              console.log(`    Sample text: "${text.substring(0, 200).replace(/\n/g, ' ')}"`);
            }
            
            // Prefer PSM modes that found "Rp"
            if (hasRp) {
              bestText = text;
              bestPsm = psm;
              bestHasRp = true;
              break; // Found "Rp", use this immediately
            } else if (hasAmountPattern && !bestHasRp) {
              bestText = text;
              bestPsm = psm;
            } else if (!bestText) {
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
        // HIGH PRIORITY: Amounts with "Rp" prefix (most reliable for payment proofs)
        const rpPatterns = [
          {
            pattern: /Rp\s*([\d]{1,3}(?:[.,]\d{3})+)/gi,
            weight: 10,
            description: 'Rp with thousand separators'
          },
          {
            pattern: /Rp\s*([\d]{4,7})/gi,
            weight: 9,
            description: 'Rp with digits only (4-7 digits)'
          },
          {
            pattern: /Rp\.?\s*([\d]{1,3}(?:[.,]\d{3})*)/gi,
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
          rpMatches.sort((a, b) => {
            if (b.weight !== a.weight) {
              return b.weight - a.weight;
            }
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
        const standalonePatterns = [
          {
            pattern: /\b([\d]{1,3}(?:[.,]\d{3}){1,2})\b/g,
            weight: 4,
            description: 'Number with thousand separators (fallback)'
          },
          {
            pattern: /\b([\d]{4,7})\b/g,
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
              
              // Very strict filtering for standalone numbers
              const isReasonableAmount = amount >= 50000 && amount <= 5000000;
              const isNotTooLong = cleaned.length >= 4 && cleaned.length <= 7;
              const isNotDate = !/^(20\d{2}|19\d{2}|\d{6})$/.test(cleaned);
              const isNotAccountNumber = cleaned.length < 10;
              
              if (!isNaN(amount) && isReasonableAmount && isNotTooLong && isNotDate && isNotAccountNumber) {
                // Check surrounding context
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
          });
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
 * Handle payment with evidence (photo/document upload)
 * Extracts order_id from caption and auto-calculates amount from order
 */
export async function handlePayWithEvidence(chatId, userId, message, sendMessage) {
  try {
    // Check both caption and message text (in case user types /pay in text and uploads photo)
    const caption = message.caption || '';
    const messageText = message.text || '';
    const combinedText = `${messageText} ${caption}`.trim();

    // Extract order_id from text/caption (support with/without backticks)
    // IMPORTANT: Use literal "DKM" not character class [DKM] to avoid matching partial strings
    // Order ID format: DKM/YYYYMMDD/000005 (date-based)
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
        '`/pay DKM/20260110/000005`\n\n' +
        'Atau:\n' +
        '`DKM/20260110/000005`\n\n' +
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
    
    // Auto-calculate expected amount from order
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
          console.log(`ℹ️ [PAY_EVIDENCE] Will use expected amount: Rp ${expectedAmount.toLocaleString('id-ID')}`);
        }
      } catch (ocrError) {
        console.error(`❌ [PAY_EVIDENCE] OCR extraction failed:`, ocrError.message);
        console.error(`❌ [PAY_EVIDENCE] Stack:`, ocrError.stack);
        console.log(`ℹ️ [PAY_EVIDENCE] Falling back to expected amount: Rp ${expectedAmount.toLocaleString('id-ID')}`);
      }
    }
    
    // Determine payment amount: use extracted amount if available, otherwise use expected amount
    let paymentAmount = expectedAmount;
    let amountSource = 'expected'; // 'expected' or 'extracted'
    
    if (extractedAmount && extractedAmount > 0) {
      console.log(`🔍 [PAY_EVIDENCE] Extracted amount is valid: Rp ${extractedAmount.toLocaleString('id-ID')}`);

      // Calculate remaining balance
      const currentPaidAmount = parseFloat(order.paid_amount || order.total_paid || 0) || 0;
      const remainingBalance = Math.max(0, expectedAmount - currentPaidAmount);
      
      // Check for suspicious amount
      const suspiciousCheck = detectSuspiciousPayment(expectedAmount, extractedAmount);
      
      // ALWAYS ask for confirmation (auto-approval flow)
      const confirmationKey = `${userId}:${orderId}`;
      pendingPaymentConfirmations.set(confirmationKey, {
        orderId,
        amountInput: extractedAmount,
        remainingBalance,
        timestamp: Date.now(),
        source: 'image_ocr',
        paymentMethod: 'transfer',
        proofFileId: evidenceFileId,
        proofCaption: message.caption || '',
        telegramMessageId: message.message_id,
      });
      
      // Build confirmation message
      let confirmationMessage = '✅ **Konfirmasi Pembayaran**\n\n';
      confirmationMessage += `📋 Order: \`${orderId}\`\n`;
      confirmationMessage += `💵 Nominal: ${formatCurrencyIDR(extractedAmount)}\n`;
      confirmationMessage += `💰 Sisa tagihan saat ini: ${formatCurrencyIDR(remainingBalance)}\n\n`;
      
      if (suspiciousCheck.isSuspicious) {
        confirmationMessage += `⚠️ **Peringatan:** ${suspiciousCheck.reason}\n\n`;
        confirmationMessage += 'Apakah Anda yakin nominal pembayaran sudah benar?\n';
      } else {
        confirmationMessage += 'Apakah nominal pembayaran sudah benar?\n';
      }
      
      confirmationMessage += 'Balas: "Ya"/"Y" untuk lanjut, atau "Tidak"/"T" untuk batal.';
      
      await sendMessage(chatId, confirmationMessage);
      return;
    } else {
      // No OCR amount extracted - use expected amount and ask for confirmation
      const currentPaidAmount = parseFloat(order.paid_amount || order.total_paid || 0) || 0;
      const remainingBalance = Math.max(0, expectedAmount - currentPaidAmount);
      
      // ALWAYS ask for confirmation
      const confirmationKey = `${userId}:${orderId}`;
      pendingPaymentConfirmations.set(confirmationKey, {
        orderId,
        amountInput: expectedAmount,
        remainingBalance,
        timestamp: Date.now(),
        source: 'image_expected',
        paymentMethod: 'transfer', // 'transfer' for evidence upload
        proofFileId: evidenceFileId,
        proofCaption: message.caption || '',
        telegramMessageId: message.message_id,
      });
      
      let confirmationMessage = '✅ **Konfirmasi Pembayaran**\n\n';
      confirmationMessage += `📋 Order: \`${orderId}\`\n`;
      confirmationMessage += `💵 Nominal: ${formatCurrencyIDR(expectedAmount)}\n`;
      confirmationMessage += `💰 Sisa tagihan saat ini: ${formatCurrencyIDR(remainingBalance)}\n\n`;
      confirmationMessage += `ℹ️ *Catatan: Jumlah menggunakan total pesanan (OCR tidak menemukan jumlah di gambar)*\n\n`;
      confirmationMessage += 'Apakah nominal pembayaran sudah benar?\n';
      confirmationMessage += 'Balas: "Ya"/"Y" untuk lanjut, atau "Tidak"/"T" untuk batal.';
      
      await sendMessage(chatId, confirmationMessage);
      return;
    }
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
      '`/pay DKM/20260110/000005 235.000`\n' +
      'Atau: `/pay DKM/20260110/000005 Rp 235.000`\n\n' +
      '**Atau upload foto bukti transfer dengan caption:**\n' +
      '`/pay DKM/20260110/000005`\n\n' +
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
        'Contoh: `/pay DKM/20260110/000005 235.000`'
      );
      return;
    }

    console.log(`🔍 [PAY] Parsed amount: ${newPaymentAmount} (from input: "${amountInput}")`);

    // Calculate remaining balance
    const currentPaidAmount = parseFloat(order.paid_amount || order.total_paid || 0) || 0;
    const remainingBalance = Math.max(0, expectedAmount - currentPaidAmount);
    
    // Check if amount is reasonable
    const isReasonable = newPaymentAmount === remainingBalance || 
                        (newPaymentAmount > 0 && newPaymentAmount <= remainingBalance) ||
                        (newPaymentAmount > remainingBalance && newPaymentAmount <= remainingBalance + 1000); // Small tolerance for overpay
    
    // Check for suspicious amount
    let isSuspicious = false;
    let suspiciousReason = '';
    if (expectedAmount > 0) {
      const suspicious = detectSuspiciousPayment(expectedAmount, newPaymentAmount);
      isSuspicious = suspicious.isSuspicious;
      suspiciousReason = suspicious.reason || '';
    }
    
    // ALWAYS ask for confirmation (auto-approval flow)
    const confirmationKey = `${userId}:${orderId}`;
    pendingPaymentConfirmations.set(confirmationKey, {
      orderId,
      amountInput: newPaymentAmount,
      remainingBalance,
      timestamp: Date.now(),
      source: 'manual_entry',
      paymentMethod: 'manual', // 'manual' for /pay command, 'transfer' for evidence upload
    });
    
    // Build confirmation message
    let confirmationMessage = '✅ **Konfirmasi Pembayaran**\n\n';
    confirmationMessage += `📋 Order: \`${orderId}\`\n`;
    confirmationMessage += `💵 Nominal: ${formatCurrencyIDR(newPaymentAmount)}\n`;
    confirmationMessage += `💰 Sisa tagihan saat ini: ${formatCurrencyIDR(remainingBalance)}\n\n`;
    
    if (isSuspicious) {
      confirmationMessage += `⚠️ **Peringatan:** ${suspiciousReason}\n\n`;
      confirmationMessage += 'Apakah Anda yakin nominal pembayaran sudah benar?\n';
    } else {
      confirmationMessage += 'Apakah nominal pembayaran sudah benar?\n';
    }
    
    confirmationMessage += 'Balas: "Ya"/"Y" untuk lanjut, atau "Tidak"/"T" untuk batal.';
    
    await sendMessage(chatId, confirmationMessage);
    return;

    const message = formatPaymentStatusMessage({
      id: result.orderId,
      total_amount: result.totalAmount || result.finalTotal,
      final_total: result.finalTotal,
      paid_amount: result.paidAmount,
      payment_status: result.paymentStatus,
      remaining_balance: result.remainingBalance,
    });

    await sendMessage(chatId, message);
  } catch (error) {
    console.error('❌ [PAY] Error updating payment:', error);
    console.error('❌ [PAY] Stack:', error.stack);
    await sendMessage(chatId, `❌ Terjadi kesalahan: ${error.message || 'Gagal memperbarui pembayaran. Silakan coba lagi.'}`);
    return;
  }
}

/**
 * Handle /payment_status command
 * Show payment status only
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
