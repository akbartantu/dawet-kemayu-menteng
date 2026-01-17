/**
 * Order Message Formatter
 * Shared formatter for all customer-facing order detail messages
 * Ensures consistent Indonesian labels and pricing display logic
 */

import { formatPrice } from './formatting.js';

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
 * Format payment summary with subtotal suppression logic
 * @param {Object} order - Order object
 * @param {Object} calculation - Calculation result from calculateOrderTotal
 * @param {number} packagingFee - Packaging fee
 * @param {number} deliveryFee - Delivery fee
 * @returns {string} Formatted payment summary
 */
export function formatPaymentSummary(order, calculation, packagingFee, deliveryFee) {
  // Calculate subtotal (items + packaging)
  const subtotal = calculation.subtotal + packagingFee;
  
  // Get total from order (canonical: total_amount, fallback: final_total)
  const total = parseFloat(order.total_amount || order.final_total || 0);
  
  // If no total from order, calculate it
  const grandTotal = total > 0 ? total : (subtotal + deliveryFee);
  
  // Determine if we need to show breakdown
  const hasNonZeroComponents = deliveryFee > 0 || packagingFee > 0;
  const subtotalEqualsTotal = Math.abs(subtotal - grandTotal) < 0.01; // Account for floating point
  
  // If subtotal == total AND no non-zero components -> show only Total
  if (subtotalEqualsTotal && !hasNonZeroComponents) {
    return `\n💰 Total Pembayaran: ${formatCurrencyIDR(grandTotal)}\n`;
  }
  
  // Otherwise show breakdown
  let paymentText = `\n💰 Rincian Pembayaran:\n`;
  paymentText += `Subtotal: ${formatCurrencyIDR(subtotal)}\n`;
  
  if (deliveryFee > 0) {
    paymentText += `Ongkir: ${formatCurrencyIDR(deliveryFee)}\n`;
  }
  
  if (packagingFee > 0) {
    paymentText += `Biaya Kemasan: ${formatCurrencyIDR(packagingFee)}\n`;
  }
  
  // Add separator before total
  paymentText += `--------------------\n`;
  paymentText += `Total Pembayaran: ${formatCurrencyIDR(grandTotal)}\n`;
  
  return paymentText;
}

/**
 * Format notes section
 * @param {Array} notes - Order notes array
 * @returns {string} Formatted notes section
 */
export function formatNotes(notes) {
  if (!notes || notes.length === 0) {
    return `\n📝 Catatan:\n-\n`;
  }
  
  // Filter and format notes
  const validNotes = notes
    .map(note => {
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
  
  if (validNotes.length === 0) {
    return `\n📝 Catatan:\n-\n`;
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
    
    // Payment summary
    const deliveryFee = parseFloat(order.delivery_fee) || 0;
    message += formatPaymentSummary(order, calculation, packagingFee, deliveryFee);
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
