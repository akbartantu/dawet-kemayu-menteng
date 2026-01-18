/**
 * Order Message Formatter
 * Shared formatter for all customer-facing order detail messages
 * Ensures consistent Indonesian labels and pricing display logic
 */

import { formatPrice } from './formatting.js';
import { calculatePaymentTotals } from '../services/payment.calculator.js';

/**
 * Format currency as Indonesian Rupiah (Rp XXX.XXX)
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
export function formatCurrencyIDR(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return 'Rp 0';
  }
  return `Rp ${formatPrice(amount)}`;
}

/**
 * Format order header (customer info, date, time, delivery method)
 * @param {Object} order - Order object
 * @returns {string} Formatted header section
 */
export function formatOrderHeader(order) {
  let header = '';
  
  // Customer info
  header += `👤 Customer: ${order.customer_name || '-'}\n`;
  header += `📞 HP: ${order.phone_number || '-'}\n`;
  header += `📍 Alamat: ${order.address || '-'}\n\n`;
  
  // Event/Date info
  if (order.event_date) {
    header += `📅 Tanggal Pengiriman: ${order.event_date}\n`;
  }
  if (order.delivery_time) {
    header += `🕐 Jam Pengiriman: ${order.delivery_time}\n`;
  }
  if (order.delivery_method && order.delivery_method !== '-') {
    header += `🚚 Metode Pengiriman: ${order.delivery_method}\n`;
  }
  
  header += `\n`;
  
  return header;
}

/**
 * Format order items list
 * @param {Array} items - Order items array
 * @returns {string} Formatted items section
 */
export function formatOrderItems(items) {
  if (!items || items.length === 0) {
    return `📦 Daftar Pesanan:\n-\n`;
  }
  
  let itemsList = `📦 Daftar Pesanan:\n`;
  items.forEach(item => {
    const itemName = (item.name || item.item || 'Unknown').trim();
    const qty = item.quantity || 0;
    itemsList += `• ${qty}x ${itemName}\n`;
  });
  
  return itemsList;
}

/**
 * Format order items with prices (for confirmation messages)
 * @param {Array} itemDetails - Item details from calculateOrderTotal
 * @param {number} packagingFee - Packaging fee
 * @param {number} packagingBoxes - Number of packaging boxes
 * @returns {string} Formatted items with prices
 */
export function formatOrderItemsWithPrices(itemDetails, packagingFee, packagingBoxes) {
  let itemsList = `📦 Daftar Pesanan & Rincian Harga:\n`;
  
  // Add regular items (skip packaging)
  itemDetails.forEach((detail) => {
    if (detail.priceFound && detail.itemTotal > 0) {
      const itemName = (detail.name || '').toLowerCase();
      if (!itemName.includes('packaging') && !itemName.includes('styrofoam')) {
        itemsList += `• ${detail.quantity}x ${detail.name}: ${formatCurrencyIDR(detail.itemTotal)}\n`;
      }
    }
  });
  
  // Add packaging if applicable
  if (packagingFee > 0) {
    itemsList += `• ${packagingBoxes}x Packaging Styrofoam (50 cup): ${formatCurrencyIDR(packagingFee)}\n`;
  }
  
  return itemsList;
}

/**
 * Format payment summary
 * Uses canonical values from Orders sheet: product_total, packaging_fee, delivery_fee, total_amount
 * @param {Object} order - Order object
 * @param {Object} calculation - Calculation result from calculateOrderTotal (optional, for fallback)
 * @param {number} packagingFee - Packaging fee (optional, fallback to order.packaging_fee)
 * @param {number} deliveryFee - Delivery fee (optional, fallback to order.delivery_fee)
 * @param {string} mode - Display mode: 'confirmation' (simple total only) or 'detail' (full breakdown)
 * @returns {string} Formatted payment summary
 */
export function formatPaymentSummary(order, calculation, packagingFee, deliveryFee, mode = 'detail') {
  // Use shared calculator for consistent totals
  const totals = calculatePaymentTotals(order, calculation, packagingFee, deliveryFee);
  
  const { subtotal, deliveryFee: finalDeliveryFee, packagingFee: finalPackagingFee, totalAmount } = totals;
  
  // Calculate expected total from components (for validation)
  const expectedTotal = subtotal + finalPackagingFee + finalDeliveryFee;
  
  // Validate total matches components (defensive check)
  const totalMismatch = Math.abs(totalAmount - expectedTotal) > 0.01;
  if (totalMismatch) {
    console.warn('⚠️ [PAYMENT_SUMMARY] Total mismatch detected:', {
      orderId: order.id,
      calculatedTotal: expectedTotal,
      storedTotal: totalAmount,
      difference: totalAmount - expectedTotal,
    });
    // Use calculated total for consistency (components are source of truth)
    console.warn('⚠️ [PAYMENT_SUMMARY] Using calculated total for display:', expectedTotal);
  }
  
  // Use calculated total if mismatch detected, otherwise use stored total
  const displayTotal = totalMismatch ? expectedTotal : totalAmount;
  
  // Both confirmation and detail modes now show full breakdown
  // Always show all three lines (even if 0) for clarity
  let paymentText = `\n💰 Rincian Pembayaran:\n`;
  paymentText += `Subtotal: ${formatCurrencyIDR(subtotal)}\n`;
  paymentText += `Ongkir: ${formatCurrencyIDR(finalDeliveryFee)}\n`;
  paymentText += `Biaya Kemasan: ${formatCurrencyIDR(finalPackagingFee)}\n`;
  
  // Check for adjustment (mismatch between calculated and stored total) - only for detail mode
  if (mode === 'detail') {
    const adjustment = totalAmount - expectedTotal;
    if (Math.abs(adjustment) > 0.01) {
      paymentText += `Penyesuaian: ${formatCurrencyIDR(adjustment)}\n`;
    }
  }
  
  // Add separator before total
  paymentText += `--------------------\n`;
  paymentText += `Total Pembayaran: ${formatCurrencyIDR(displayTotal)}\n`;
  
  return paymentText;
}

/**
 * Sanitize customer notes - filter out JSON objects and payment evidence
 * @param {string|Array} notesJson - Notes as JSON string or array
 * @returns {Array<string>} Array of human-readable note strings
 */
export function sanitizeCustomerNotes(notesJson) {
  if (!notesJson) {
    return [];
  }
  
  // Parse if string
  let notes = notesJson;
  if (typeof notesJson === 'string') {
    try {
      notes = JSON.parse(notesJson);
    } catch (e) {
      // If not valid JSON, treat as plain string
      if (notesJson.trim()) {
        notes = [notesJson.trim()];
      } else {
        notes = [];
      }
    }
  }
  
  // Ensure array
  if (!Array.isArray(notes)) {
    notes = notes ? [notes] : [];
  }
  
  // Filter and sanitize
  const validNotes = notes
    .map(note => {
      if (note === null || note === undefined) return null;
      
      // Filter out payment evidence objects
      if (typeof note === 'object') {
        const noteType = (note.type || '').toLowerCase();
        if (noteType === 'payment_evidence' || noteType === 'paymentevidence') {
          return null; // Skip payment evidence
        }
        
        // Try to extract human-readable text from object
        if (note.text) return String(note.text).trim();
        if (note.note) return String(note.note).trim();
        if (note.value) return String(note.value).trim();
        if (note.message) return String(note.message).trim();
        
        // If it's an array, join it
        if (Array.isArray(note)) {
          return note.map(n => String(n)).join(', ').trim();
        }
        
        // Skip raw JSON objects (don't stringify them for customers)
        return null;
      }
      
      // Convert to string
      const noteStr = String(note).trim();
      
      // Filter out raw JSON strings (containing { or [ at start)
      if (noteStr.startsWith('{') || noteStr.startsWith('[')) {
        try {
          const parsed = JSON.parse(noteStr);
          // If it's an object/array, skip it
          if (typeof parsed === 'object') {
            return null;
          }
        } catch (e) {
          // Not valid JSON, keep as string
        }
      }
      
      return noteStr;
    })
    .filter(note => {
      if (!note || !note.trim()) return false;
      
      const noteLower = note.toLowerCase();
      
      // Filter out packaging-related notes (already shown in breakdown)
      if (noteLower.includes('packaging') && 
          (noteLower.includes('styrofoam') || noteLower.includes('ya') || noteLower.includes('yes'))) {
        return false;
      }
      
      // Filter out JSON-looking strings
      if (noteLower.startsWith('{') || noteLower.startsWith('[')) {
        return false;
      }
      
      return true;
    });
  
  return validNotes;
}

/**
 * Format notes section
 * @param {string|Array} notes - Order notes (JSON string or array)
 * @returns {string} Formatted notes section
 */
export function formatNotes(notes) {
  const validNotes = sanitizeCustomerNotes(notes);
  
  // If no notes, return empty string (don't show notes block)
  if (validNotes.length === 0) {
    return '';
  }
  
  let notesText = `\n📝 Catatan:\n`;
  validNotes.forEach(note => {
    notesText += `• ${note.trim()}\n`;
  });
  
  return notesText;
}

/**
 * Build complete order detail message
 * @param {Object} order - Order object
 * @param {Object} calculation - Calculation result from calculateOrderTotal (optional)
 * @param {string} mode - Message mode: 'confirmation', 'detail', 'unpaid_line'
 * @returns {Promise<string>} Complete formatted message
 */
export async function buildOrderDetailMessage(order, calculation = null, mode = 'detail') {
  let message = '';
  
  // Header
  if (mode === 'confirmation') {
    message += `📋 KONFIRMASI PESANAN\n\n`;
  } else if (mode === 'unpaid_line') {
    // For unpaid list, show invoice number first
    message += `🧾 Invoice: ${order.id || '-'}\n`;
  }
  
  // Order header (customer, HP, alamat, tanggal, jam, metode)
  message += formatOrderHeader(order);
  
  // Items
  if (mode === 'confirmation' && calculation) {
    // Calculate packaging
    const hasPackaging = (order.notes || []).some(note => {
      const noteStr = String(note || '').toLowerCase();
      return noteStr.includes('packaging') && 
             (noteStr.includes('ya') || noteStr.includes('yes'));
    });
    
    const totalCups = (order.items || []).reduce((sum, item) => {
      const name = (item.name || '').toLowerCase();
      if (name.includes('dawet') && 
          (name.includes('small') || name.includes('medium') || name.includes('large')) && 
          !name.includes('botol')) {
        return sum + (item.quantity || 0);
      }
      return sum;
    }, 0);
    
    const packagingBoxes = hasPackaging && totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
    const packagingFee = packagingBoxes * 40000;
    
    message += formatOrderItemsWithPrices(calculation.itemDetails, packagingFee, packagingBoxes);
    
    // Payment summary (confirmation mode: simple total only)
    const deliveryFee = parseFloat(order.delivery_fee) || 0;
    message += formatPaymentSummary(order, calculation, packagingFee, deliveryFee, 'confirmation');
  } else {
    // Simple items list (no prices)
    message += formatOrderItems(order.items || []);
  }
  
  // Notes
  message += formatNotes(order.notes || []);
  
  // Confirmation prompt (only for confirmation mode)
  if (mode === 'confirmation') {
    const { ORDER_CONFIRMATION_PROMPT } = await import('./messages.js');
    message += `\n${ORDER_CONFIRMATION_PROMPT}\n`;
  }
  
  return message;
}
