/**
 * Payment Tracker
 * Handles payment status tracking and updates for orders
 * Implements PRD payment workflow: UNPAID → DP PAID → FULL PAID
 */

// Payment tracking functions will be added to google-sheets.js

/**
 * Calculate payment status based on paid amount and total
 * @param {number} paidAmount - Amount paid so far
 * @param {number} finalTotal - Final total amount
 * @returns {string} Payment status: 'UNPAID' | 'DP PAID' | 'FULL PAID'
 */
export function calculatePaymentStatus(paidAmount, finalTotal) {
  if (!finalTotal || finalTotal === 0) {
    return 'UNPAID';
  }

  const percentage = (paidAmount / finalTotal) * 100;

  if (percentage >= 100) {
    return 'FULL PAID';
  } else if (percentage >= 50) {
    return 'DP PAID';
  } else {
    return 'UNPAID';
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
/**
 * Escape markdown special characters in user-provided text
 * @param {string} text - Text that may contain markdown special characters
 * @returns {string} Escaped text safe for markdown
 */
function escapeMarkdownText(text) {
  if (!text || typeof text !== 'string') {
    return text || '';
  }
  // Escape special markdown characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
  return text
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/_/g, '\\_')    // Escape underscores
    .replace(/\*/g, '\\*')   // Escape asterisks
    .replace(/\[/g, '\\[')   // Escape square brackets
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')   // Escape parentheses
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')    // Escape tildes
    .replace(/`/g, '\\`')    // Escape backticks
    .replace(/>/g, '\\>')    // Escape greater than
    .replace(/#/g, '\\#')    // Escape hash
    .replace(/\+/g, '\\+')   // Escape plus
    .replace(/-/g, '\\-')    // Escape minus
    .replace(/=/g, '\\=')    // Escape equals
    .replace(/\|/g, '\\|')   // Escape pipe
    .replace(/\{/g, '\\{')   // Escape curly braces
    .replace(/\}/g, '\\}');
}

export function formatPaymentStatusMessage(order) {
  // Escape user-provided data to prevent markdown parsing errors
  const orderId = escapeMarkdownText(order.id || 'N/A');
  // Use total_amount (canonical) with fallback to final_total (legacy)
  const totalAmount = order.total_amount || order.final_total || 0;
  const paidAmount = order.paid_amount || 0;
  const paymentStatus = order.payment_status || 'UNPAID';
  const remainingBalance = calculateRemainingBalance(totalAmount, paidAmount);
  const minDP = calculateMinDP(totalAmount);

  let message = `💰 **STATUS PEMBAYARAN**\n\n`;
  message += `📋 Order ID: ${orderId}\n`;
  message += `💵 Total: Rp ${formatRupiah(totalAmount)}\n`;
  message += `💳 Total Dibayar: Rp ${formatRupiah(paidAmount)}\n`;
  message += `📊 Sisa: Rp ${formatRupiah(remainingBalance)}\n\n`;

  if (paymentStatus === 'FULL PAID') {
    message += `✅ **Status: LUNAS**\n`;
    message += `Terima kasih! Pembayaran sudah lengkap.`;
  } else if (paymentStatus === 'DP PAID') {
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
function formatRupiah(amount) {
  return new Intl.NumberFormat('id-ID').format(amount);
}

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
  const statusOrder = ['UNPAID', 'DP PAID', 'FULL PAID'];
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
