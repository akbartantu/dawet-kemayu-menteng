/**
 * Order Formatter
 * Single source of truth for order confirmation text generation
 */

import { buildOrderDetailMessage } from './order-message-formatter.js';

/**
 * Calculate packaging fee from order data
 * @param {Array} items - Order items
 * @param {Array} notes - Order notes
 * @returns {Object} { packagingFee: number, packagingBoxes: number }
 */
function calculatePackagingFee(items, notes) {
  let packagingFee = 0;
  let packagingBoxes = 0;
  
  const hasPackaging = notes?.some(note => {
    const noteStr = String(note || '').toLowerCase();
    return noteStr.includes('packaging') && 
           (noteStr.includes('ya') || noteStr.includes('yes'));
  });
  
  if (hasPackaging) {
    const totalCups = items.reduce((sum, item) => {
      const name = (item.name || '').toLowerCase();
      if (name.includes('dawet') && 
          (name.includes('small') || name.includes('medium') || name.includes('large')) && 
          !name.includes('botol')) {
        return sum + (item.quantity || 0);
      }
      return sum;
    }, 0);
    packagingBoxes = Math.ceil(totalCups / 50);
    packagingFee = packagingBoxes * 40000;
  }
  
  return { packagingFee, packagingBoxes };
}

/**
 * Filter packaging-related notes from order notes
 * @param {Array} notes - Order notes
 * @returns {Array} Filtered notes
 */
function filterPackagingNotes(notes) {
  if (!notes || notes.length === 0) return [];
  
  return notes
    .map(note => {
      // Convert note to string - handle objects and other types
      if (note === null || note === undefined) return null;
      if (typeof note === 'object') {
        if (note.text) return String(note.text);
        if (note.note) return String(note.note);
        if (note.value) return String(note.value);
        if (note.message) return String(note.message);
        if (Array.isArray(note)) return note.map(n => String(n)).join(', ');
        try {
          return JSON.stringify(note);
        } catch (e) {
          return String(note);
        }
      }
      return String(note);
    })
    .filter(note => {
      if (!note || !note.trim()) return false;
      const noteLower = note.toLowerCase();
      // Filter out packaging-related notes
      return !(noteLower.includes('packaging') && 
              (noteLower.includes('styrofoam') || noteLower.includes('ya') || noteLower.includes('yes')));
    });
}

/**
 * Format order confirmation text
 * Single source of truth for order confirmation message generation
 * 
 * @param {Object} orderData - Order data object
 * @param {Object} calculation - Calculation result from calculateOrderTotal
 * @param {string} orderSummary - Formatted order summary (from formatOrderSummary) - DEPRECATED, kept for compatibility
 * @returns {Promise<string>} Formatted confirmation text
 */
export async function formatOrderConfirmation(orderData, calculation, orderSummary) {
  // Use shared formatter for consistency
  return await buildOrderDetailMessage(orderData, calculation, 'confirmation');
}
