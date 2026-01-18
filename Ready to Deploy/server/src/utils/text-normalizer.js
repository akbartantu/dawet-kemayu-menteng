/**
 * Text Normalization Utilities
 * Handles text cleaning and normalization for order parsing
 */

/**
 * Normalize text to remove invisible Unicode characters and normalize whitespace
 * Handles zero-width spaces, NBSP, and other invisible characters from copy/paste
 * @param {string} raw - Raw text input
 * @returns {string} Normalized text
 */
export function normalizeText(raw) {
  if (!raw || typeof raw !== 'string') {
    return raw || '';
  }

  return raw
    .replace(/\r\n/g, '\n')                    // Normalize line endings
    .replace(/\r/g, '\n')                      // Handle old Mac line endings
    .replace(/\u00A0/g, ' ')                   // Replace NBSP with normal space
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '') // Remove zero-width characters
    .replace(/[ \t]+/g, ' ')                   // Collapse repeated spaces/tabs (but keep newlines)
    .trim();
}

/**
 * Normalize delivery method capitalization
 * Standardizes valid values: "Pickup", "GrabExpress", "Custom"
 * For other values, keeps original casing
 */
export function normalizeDeliveryMethod(method) {
  if (!method || typeof method !== 'string') {
    return '-';
  }
  
  const methodLower = method.toLowerCase().trim();
  
  // Standardize valid values
  if (methodLower === 'pickup') {
    return 'Pickup';
  } else if (methodLower === 'grabexpress' || methodLower === 'grab express') {
    return 'GrabExpress';
  } else if (methodLower === 'custom') {
    return 'Custom';
  }
  
  // For unknown values (e.g., "Gojek", "Kurir"), keep original casing
  return method.trim();
}
