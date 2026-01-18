/**
 * Payment Tracker
 * Handles payment status tracking and updates for orders
 * Implements PRD payment workflow: UNPAID → DP PAID → FULL PAID
 */

import { PAYMENT_STATUS } from '../utils/constants.js';
import { formatRupiah, escapeMarkdown } from '../utils/formatting.js';
import { THANK_YOU_PAYMENT_COMPLETE } from '../utils/messages.js';

/**
 * Calculate payment status based on paid amount and total
 * @param {number} paidAmount - Amount paid so far
 * @param {number} finalTotal - Final total amount
 * @returns {string} Payment status: 'UNPAID' | 'DP PAID' | 'FULL PAID'
 */
export function calculatePaymentStatus(paidAmount, finalTotal) {
  if (!finalTotal || finalTotal === 0) {
    return PAYMENT_STATUS.UNPAID;
  }

  const percentage = (paidAmount / finalTotal) * 100;

  if (percentage >= 100) {
    return PAYMENT_STATUS.FULL_PAID;
  } else if (percentage >= 50) {
    return PAYMENT_STATUS.DP_PAID;
  } else {
    return PAYMENT_STATUS.UNPAID;
  }
}

/**
 * Calculate remaining balance
 * @param {number} finalTotal - Final total amount
 * @param {number} paidAmount - Amount paid so far
 * @returns {number} Remaining balance (min 0)
 */
export function calculateRemainingBalance(finalTotal, paidAmount) {
  const remaining = finalTotal - paidAmount;
  return Math.max(0, remaining);
}

/**
 * Calculate minimum DP amount (50% of total)
 * @param {number} finalTotal - Final total amount
 * @returns {number} Minimum DP amount
 */
export function calculateMinDP(finalTotal) {
  return Math.ceil(finalTotal * 0.5);
}

/**
 * Format payment status message for bot response
 * @param {Object} order - Order object with payment info
 * @returns {string} Formatted message
 */
// escapeMarkdownText is now imported from formatting.js

export function formatPaymentStatusMessage(order) {
  // Escape user-provided data to prevent markdown parsing errors
  const orderId = escapeMarkdown(order.id || 'N/A');
  // Use total_amount (canonical) with fallback to final_total (legacy)
  const totalAmount = order.total_amount || order.final_total || 0;
  const paidAmount = order.paid_amount || 0;
  const paymentStatus = order.payment_status || PAYMENT_STATUS.UNPAID;
  const remainingBalance = calculateRemainingBalance(totalAmount, paidAmount);
  const minDP = calculateMinDP(totalAmount);

  let message = `💰 **STATUS PEMBAYARAN**\n\n`;
  message += `📋 Order ID: \`${orderId}\`\n`;
  message += `💵 Total: Rp ${formatRupiah(totalAmount)}\n`;
  message += `💳 Total Dibayar: Rp ${formatRupiah(paidAmount)}\n`;
  message += `📊 Sisa: Rp ${formatRupiah(remainingBalance)}\n\n`;

  if (paymentStatus === PAYMENT_STATUS.FULL_PAID) {
    message += `✅ **Status: LUNAS**\n`;
    message += THANK_YOU_PAYMENT_COMPLETE;
  } else if (paymentStatus === PAYMENT_STATUS.DP_PAID) {
    message += `⚠️ **Status: DP PAID**\n`;
    message += `Sisa pembayaran: Rp ${formatRupiah(remainingBalance)}\n`;
    message += `DP minimum: Rp ${formatRupiah(minDP)}`;
  } else {
    message += `❌ **Status: UNPAID**\n`;
    if (paidAmount > 0 && paidAmount < minDP) {
      message += `⚠️ Pembayaran di bawah minimum DP\n`;
      message += `DP minimum: Rp ${formatRupiah(minDP)}\n`;
    } else if (paidAmount === 0) {
      message += `DP minimum: Rp ${formatRupiah(minDP)}\n`;
    }
    message += `Sisa pembayaran: Rp ${formatRupiah(remainingBalance)}`;
  }

  return message;
}

/**
 * Parse Indonesian Rupiah amount from string input
 * Handles formats: "235.000", "235,000", "Rp 235.000", "235000", etc.
 * @param {string} input - Amount string (may include "Rp", spaces, thousand separators)
 * @returns {number} Parsed amount as integer, or null if invalid
 */
export function parseIDRAmount(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }
  
  // Remove "Rp" or "rp" prefix (case-insensitive)
  let cleaned = input.trim().replace(/^rp\s*/i, '');
  
  // Remove all spaces
  cleaned = cleaned.replace(/\s+/g, '');
  
  // Remove thousand separators (both . and ,)
  cleaned = cleaned.replace(/[.,]/g, '');
  
  // Parse as integer (IDR has no decimals)
  const amount = parseInt(cleaned, 10);
  
  // Validate: must be a valid number, positive, and not NaN
  if (isNaN(amount) || amount <= 0) {
    return null;
  }
  
  return amount;
}

/**
 * Format Rupiah currency
 * @param {number} amount - Amount to format
 * @returns {string} Formatted amount
 */
// formatRupiah is now imported from formatting.js

/**
 * Validate payment update
 * @param {string} currentStatus - Current payment status
 * @param {string} newStatus - New payment status
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validatePaymentStatusTransition(currentStatus, newStatus) {
  // Same status is always valid (idempotent)
  if (currentStatus === newStatus) {
    return { valid: true };
  }

  // No backward transitions allowed
  const statusOrder = [PAYMENT_STATUS.UNPAID, PAYMENT_STATUS.DP_PAID, PAYMENT_STATUS.FULL_PAID];
  const currentIndex = statusOrder.indexOf(currentStatus);
  const newIndex = statusOrder.indexOf(newStatus);

  if (currentIndex === -1 || newIndex === -1) {
    return { 
      valid: false, 
      error: `Invalid payment status: ${currentStatus} → ${newStatus}` 
    };
  }

  if (newIndex < currentIndex) {
    return { 
      valid: false, 
      error: `Cannot regress payment status from ${currentStatus} to ${newStatus}. Payment status can only progress forward.` 
    };
  }

  return { valid: true };
}

/**
 * Detect suspicious payment amounts (typo mitigation)
 * @param {number} expectedAmount - Expected total amount
 * @param {number} enteredAmount - User-entered amount
 * @returns {Object} { isSuspicious: boolean, reason?: string }
 */
export function detectSuspiciousPayment(expectedAmount, enteredAmount) {
  if (!expectedAmount || expectedAmount <= 0) {
    return { isSuspicious: false };
  }
  
  if (!enteredAmount || enteredAmount <= 0) {
    return { isSuspicious: false };
  }
  
  const ratio = enteredAmount / expectedAmount;
  
  // Rule 1: Amount >= 1.5x expected (50% over)
  if (ratio >= 1.5) {
    return {
      isSuspicious: true,
      reason: `Jumlah pembayaran (Rp ${formatRupiah(enteredAmount)}) lebih besar dari total yang diharapkan (Rp ${formatRupiah(expectedAmount)}).`
    };
  }
  
  // Rule 2: Amount <= 0.5x expected (50% under)
  if (ratio <= 0.5) {
    return {
      isSuspicious: true,
      reason: `Jumlah pembayaran (Rp ${formatRupiah(enteredAmount)}) lebih kecil dari total yang diharapkan (Rp ${formatRupiah(expectedAmount)}).`
    };
  }
  
  // Rule 3: Order of magnitude off (ratio >= 9 or <= 0.11)
  if (ratio >= 9 || ratio <= 0.11) {
    return {
      isSuspicious: true,
      reason: `Jumlah pembayaran tampaknya memiliki kesalahan ketik (perbedaan terlalu besar).`
    };
  }
  
  // Rule 4: Extra zero group (heuristic: ratio is exactly 10 or 0.1)
  if (ratio === 10 || ratio === 0.1) {
    return {
      isSuspicious: true,
      reason: `Jumlah pembayaran mungkin memiliki nol ekstra atau kurang.`
    };
  }
  
  return { isSuspicious: false };
}
