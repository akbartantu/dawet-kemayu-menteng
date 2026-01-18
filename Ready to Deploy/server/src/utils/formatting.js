/**
 * Formatting Utilities
 * Shared formatting functions for currency, markdown, and text
 */

/**
 * Format number as Indonesian Rupiah currency
 * Uses Indonesian locale formatting (e.g., 1000000 -> "1.000.000")
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
export function formatRupiah(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return '0';
  }
  return new Intl.NumberFormat('id-ID').format(amount);
}

/**
 * Format price (uses dot separator for thousands, e.g., 1000000 -> "1.000.000")
 * Note: This matches the existing formatPrice implementation in price-calculator.js
 * @param {number} price - Price to format
 * @returns {string} Formatted price string
 */
export function formatPrice(price) {
  if (price === null || price === undefined || isNaN(price)) {
    return '0';
  }
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Escape markdown special characters in user-provided text
 * Prevents Telegram markdown parsing errors from user input
 * @param {string} text - Text that may contain markdown special characters
 * @returns {string} Escaped text safe for markdown
 */
export function escapeMarkdown(text) {
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

/**
 * Escape markdown text (alias for escapeMarkdown for backward compatibility)
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeMarkdownText(text) {
  return escapeMarkdown(text);
}

/**
 * Format currency as Indonesian Rupiah (Rp XXX.XXX)
 * Alias for compatibility - prefer using order-message-formatter.js
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
export function formatCurrencyIDR(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return 'Rp 0';
  }
  return `Rp ${formatPrice(amount)}`;
}
