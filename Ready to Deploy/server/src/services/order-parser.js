/**
 * Order Parser
 * Main entry point for order parsing with automatic format detection
 * 
 * This file re-exports all parsing functions and provides the main entry point.
 * Implementation details are split into smaller modules:
 * - src/utils/text-normalizer.js - Text normalization utilities
 * - src/utils/delivery-time-extractor.js - Delivery time extraction
 * - src/services/order-parser-v1.js - V1 format parser
 * - src/services/order-parser-v2.js - V2 format parser
 */

// Re-export utilities
export { normalizeText, normalizeDeliveryMethod } from '../utils/text-normalizer.js';
export { extractDeliveryTimeFromMessage } from '../utils/delivery-time-extractor.js';

// Import parsers
import { parseOrderFromMessage as parseV1 } from './order-parser-v1.js';
import { parseOrderMessageV2 as parseV2 } from './order-parser-v2.js';

// Re-export parsers
export { parseOrderFromMessage } from './order-parser-v1.js';
export { parseOrderMessageV2 } from './order-parser-v2.js';

/**
 * Detect which order format the message uses
 * Returns: 'v1' (original format), 'v2' (Indonesian template), or null
 */
export function detectOrderFormat(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    return null;
  }

  const text = messageText.trim();
  
  // V2 indicators (Indonesian template format)
  const v2Indicators = [
    /^📝Untuk\s+memproses\s+pesanan/i,
    /Nama\s+Pemesan\s*:/i,
    /Nama\s+Penerima\s*:/i,
    /No\s+HP\s+Penerima\s*:/i,
    /Alamat\s+Penerima\s*:/i,
    /Nama\s+Event\s*\(jika\s+ada\)\s*:/i,
    /Durasi\s+Event\s*\(dalam\s+jam\)\s*:/i,
    /Tanggal\s+Event\s*:/i,
    /Waktu\s+Kirim\s*\(jam\)\s*:/i,
    /Detail\s+Pesanan\s*:/i,
    /Packaging\s+Styrofoam\s*\([^)]+\)\s*:/i,
    /Metode\s+pengiriman\s*:/i,
    /Biaya\s+Pengiriman\s*\(Rp\)\s*:/i,
    /Mendapatkan\s+info\s+Dawet\s+Kemayu\s+Menteng\s+dari\s*:/i,
  ];

  // Count V2 indicators
  let v2Count = 0;
  for (const indicator of v2Indicators) {
    if (indicator.test(text)) {
      v2Count++;
    }
  }

  // If 3+ V2 indicators found, it's likely V2 format
  if (v2Count >= 3) {
    return 'v2';
  }

  // V1 indicators (original format)
  const v1Indicators = [
    /^Nama\s*:/i,
    /^No\s+hp\s*:/i,
    /^Alamat\s*:/i,
    /^Tanggal\s*:/i,
    /^Waktu\s+Kirim\s*\(jam\)\s*:/i,
    /^Jam\s+kirim\s*:/i,
    /^Detail\s+pesanan\s*:/i,
  ];

  // Count V1 indicators
  let v1Count = 0;
  for (const indicator of v1Indicators) {
    if (indicator.test(text)) {
      v1Count++;
    }
  }

  // If V1 indicators found and no strong V2 match, use V1
  if (v1Count > 0 && v2Count < 3) {
    return 'v1';
  }

  // Default to V1 if we can't determine (backward compatibility)
  return v1Count > 0 ? 'v1' : null;
}

/**
 * Parse order from message with automatic format detection
 * This is the main entry point - it detects format and uses appropriate parser
 */
export function parseOrderFromMessageAuto(messageText) {
  const format = detectOrderFormat(messageText);
  
  if (format === 'v2') {
    return parseV2(messageText);
  } else {
    // Default to V1 (original format) for backward compatibility
    return parseV1(messageText);
  }
}

/**
 * Validate parsed order
 */
export function validateOrder(order) {
  const errors = [];

  if (!order.customer_name) {
    errors.push('Customer name is required');
  }

  if (!order.phone_number) {
    errors.push('Phone number is required');
  }

  if (!order.address) {
    errors.push('Address is required');
  }

  if (order.items.length === 0) {
    errors.push('At least one order item is required');
  }

  return {
    valid: errors.length === 0,
    errors: errors,
  };
}

/**
 * Format order as readable text
 */
export function formatOrderSummary(order) {
  // Format customer and order info (no bold, no Event/Duration fields)
  // Match exact format: Customer, HP, Alamat, empty line, Tanggal Pengiriman, Jam Pengiriman, Metode Pengiriman, empty line
  let summary = `👤 Customer: ${order.customer_name || '-'}\n`;
  summary += `📞 HP: ${order.phone_number || '-'}\n`;
  summary += `📍 Alamat: ${order.address || '-'}\n\n`;

  if (order.event_date) {
    summary += `📅 Tanggal Pengiriman: ${order.event_date}\n`;
  }
  if (order.delivery_time) {
    summary += `🕐 Jam Pengiriman: ${order.delivery_time}\n`;
  }
  if (order.delivery_method && order.delivery_method !== '-') {
    summary += `🚚 Metode Pengiriman: ${order.delivery_method}\n`;
  }
  
  // Add empty line after delivery method (before Items section)
  summary += `\n`;

  // Items and notes will be added separately with prices
  return summary;
}
