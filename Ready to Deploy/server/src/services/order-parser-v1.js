/**
 * Order Parser V1
 * Parses orders from the original format (V1)
 */

import { normalizeText, normalizeDeliveryMethod } from '../utils/text-normalizer.js';
import { extractDeliveryTimeFromMessage } from '../utils/delivery-time-extractor.js';
import { normalizeDeliveryTime } from './price-calculator.js';

/**
 * Parse order information from message text (V1 format)
 * Expected format:
 * Nama: ...
 * No hp: ...
 * Alamat: ...
 * ...
 */
export function parseOrderFromMessage(messageText) {
  // Normalize text first to remove invisible Unicode characters
  const normalizedText = normalizeText(messageText);
  const rawLength = messageText ? messageText.length : 0;
  const normalizedLength = normalizedText.length;
  if (rawLength !== normalizedLength) {
  }

  const order = {
    customer_name: null,
    receiver_name: null, // Nama Penerima (optional, falls back to customer_name)
    phone_number: null,
    address: null,
    event_name: null,
    event_duration: null,
    event_date: null,
    delivery_time: null,
    items: [],
    notes: [],
    shipping_fee: null, // Biaya Pengiriman (Ongkir) - canonical field
    shipping_fee_source: null, // 'USER_INPUT', 'USER_EMPTY', 'NOT_PROVIDED'
  };

  const lines = normalizedText.split('\n').map(line => line.trim()).filter(line => line);

  let currentSection = null;
  let addressLines = [];
  let orderDetailsStarted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse customer name - handles both "Nama:" and "Nama Pemesan:" formats
    // Must not be "Nama event" or "Nama Penerima"
    if (line.match(/^Nama\s+Pemesan\s*:?\s*(.+)$/i)) {
      const name = line.replace(/^Nama\s+Pemesan\s*:?\s*/i, '').trim();
      if (name && name.length > 0) {
        order.customer_name = name;
        continue;
      }
    }
    // Also handle simple "Nama:" format (not "Nama event")
    if (line.match(/^Nama\s*:?\s*(.+)$/i) && 
        !line.match(/^Nama\s+event/i) && 
        !line.match(/^Nama\s+Penerima/i) &&
        !line.match(/^Nama\s+Pemesan/i)) {
      const name = line.replace(/^Nama\s*:?\s*/i, '').trim();
      // Make sure it's not empty and doesn't start with "event"
      if (name && name.length > 0 && !name.toLowerCase().startsWith('event')) {
        order.customer_name = name;
        continue;
      }
    }

    // Parse receiver name (Nama Penerima) - optional, falls back to customer_name
    if (line.match(/^Nama\s+Penerima\s*:?\s*(.+)$/i)) {
      const name = line.replace(/^Nama\s+Penerima\s*:?\s*/i, '').trim();
      if (name && name.length > 0) {
        order.receiver_name = name;
        continue;
      }
    }

    // Parse phone number - handles both "No hp:" and "No HP Penerima:" formats
    if (line.match(/^No\s+HP\s+Penerima\s*:?\s*(.+)$/i)) {
      order.phone_number = line.replace(/^No\s+HP\s+Penerima\s*:?\s*/i, '').trim();
      continue;
    }
    if (line.match(/^No\s+hp\s*:?\s*(.+)$/i)) {
      order.phone_number = line.replace(/^No\s+hp\s*:?\s*/i, '').trim();
      continue;
    }

    // Parse address - handles both "Alamat:" and "Alamat Penerima:" formats
    if (line.match(/^Alamat\s+Penerima\s*:?\s*(.+)$/i)) {
      const addressText = line.replace(/^Alamat\s+Penerima\s*:?\s*/i, '').trim();
      if (addressText && addressText.length > 0) {
        order.address = addressText;
        currentSection = null;
        continue;
      } else {
        currentSection = 'address';
        addressLines = [];
        continue;
      }
    }
    if (line.match(/^Alamat\s*:?\s*(.+)$/i)) {
      // Address on same line
      const addressText = line.replace(/^Alamat\s*:?\s*/i, '').trim();
      if (addressText && addressText.length > 0) {
        order.address = addressText;
        currentSection = null;
        continue;
      } else {
        // Address on next line(s)
        currentSection = 'address';
        addressLines = [];
        continue;
      }
    }

    // Continue collecting address lines
    if (currentSection === 'address') {
      // Check if next section starts (Titik, Nama event, Waktu Kirim, etc.)
      if (line.match(/^\(Titik:/i) || line.match(/^Nama event/i) || line.match(/^Durasi event/i) || line.match(/^Tanggal/i) || line.match(/^Waktu Kirim/i) || line.match(/^Jam:/i) || line.match(/^Detail pesanan/i) || line.match(/^Notes:/i)) {
        if (addressLines.length > 0) {
          order.address = addressLines.join(', ').trim();
        }
        currentSection = null;
        // Process this line in next iteration
        i--;
        continue;
      }
      // Handle "Titik:" line (location point) - can be on same line or next line
      if (line.match(/^\(Titik:\s*(.+)\)$/i)) {
        const titik = line.match(/^\(Titik:\s*(.+)\)$/i)[1];
        addressLines.push(`Titik: ${titik}`);
        currentSection = null; // Address complete after Titik
        continue;
      }
      // If line is empty and we have address, finish address collection
      if (!line && addressLines.length > 0) {
        order.address = addressLines.join(', ').trim();
        currentSection = null;
        continue;
      }
      if (line) {
        addressLines.push(line);
      }
      continue;
    }

    // Parse event name
    if (line.match(/^Nama event\s*\(jika untuk event\)\s*:?\s*(.+)$/i)) {
      const eventName = line.replace(/^Nama event\s*\(jika untuk event\)\s*:?\s*/i, '').trim();
      if (eventName) {
        order.event_name = eventName;
      }
      continue;
    }

    // Parse event duration
    if (line.match(/^Durasi event\s*:?\s*(.+)$/i)) {
      const duration = line.replace(/^Durasi event\s*:?\s*/i, '').trim();
      if (duration) {
        order.event_duration = duration;
      }
      continue;
    }

    // Parse event date
    if (line.match(/^Tanggal\s*:?\s*(.+)$/i)) {
      order.event_date = line.replace(/^Tanggal\s*:?\s*/i, '').trim();
      continue;
    }

    // Parse delivery time - handles multiple formats
    // "Waktu Kirim (jam): HH:MM" or "Waktu Kirim: HH:MM"
    if (line.match(/^Waktu\s+Kirim\s*\(jam\)\s*:?\s*(.+)$/i)) {
      const timeText = line.replace(/^Waktu\s+Kirim\s*\(jam\)\s*:?\s*/i, '').trim();
      const cleanedTime = timeText.replace(/\s*(WIB|WITA|WIT)$/i, '').trim();
      // Normalize immediately to ensure HH:MM format
      try {
        order.delivery_time = normalizeDeliveryTime(cleanedTime);
      } catch (error) {
        // If normalization fails, store raw value (will be handled in fallback)
        order.delivery_time = cleanedTime;
      }
      continue;
    }
    if (line.match(/^Waktu\s+Kirim\s*:?\s*(.+)$/i)) {
      const timeText = line.replace(/^Waktu\s+Kirim\s*:?\s*/i, '').trim();
      const cleanedTime = timeText.replace(/\s*(WIB|WITA|WIT)$/i, '').trim();
      // Normalize immediately to ensure HH:MM format
      try {
        order.delivery_time = normalizeDeliveryTime(cleanedTime);
      } catch (error) {
        order.delivery_time = cleanedTime;
      }
      continue;
    }
    // "Jam kirim:" format (with or without asterisks)
    if (line.match(/^\*?Jam\s+kirim\s*:?\s*(.+)\*?$/i)) {
      const timeText = line.replace(/^\*?Jam\s+kirim\s*:?\s*/i, '').replace(/\*?$/, '').trim();
      const cleanedTime = timeText.replace(/\s*(WIB|WITA|WIT)$/i, '').trim();
      // Normalize immediately to ensure HH:MM format
      try {
        order.delivery_time = normalizeDeliveryTime(cleanedTime);
      } catch (error) {
        order.delivery_time = cleanedTime;
      }
      continue;
    }
    // "Jam:" format (without asterisks)
    if (line.match(/^Jam\s*:?\s*(.+)$/i)) {
      const timeText = line.replace(/^Jam\s*:?\s*/i, '').trim();
      // Remove "WIB" or other timezone indicators
      const cleanedTime = timeText.replace(/\s*(WIB|WITA|WIT)$/i, '').trim();
      // Normalize immediately to ensure HH:MM format
      try {
        order.delivery_time = normalizeDeliveryTime(cleanedTime);
      } catch (error) {
        order.delivery_time = cleanedTime;
      }
      continue;
    }

    // Parse Metode pengiriman (V1 format, robust regex with multiline support)
    if (line.match(/^Metode\s+pengiriman\s*:?\s*(.+)$/im)) {
      const originalLine = line;
      let method = line.replace(/^Metode\s+pengiriman\s*:?\s*/i, '').trim();
      
      // Normalize multiple spaces to single space
      method = method.replace(/\s+/g, ' ');
      if (!method || method === '-') {
        order.delivery_method = '-';
      } else {
        // Check if it's a placeholder (contains "/" AND all three options)
        const methodLower = method.toLowerCase();
        const isPlaceholder = method.includes('/') && 
                              methodLower.includes('pickup') && 
                              methodLower.includes('grabexpress') && 
                              methodLower.includes('custom');
        
        if (isPlaceholder) {
          // Placeholder menu - treat as not selected
          order.delivery_method = '-';
        } else {
          // Standardize capitalization for valid values, otherwise keep raw value
          const normalized = normalizeDeliveryMethod(method);
          order.delivery_method = normalized;
        }
      }
      continue;
    }

    // Parse order details (case-insensitive)
    if (line.match(/^Detail\s+[Pp]esanan\s*:?\s*$/i)) {
      orderDetailsStarted = true;
      continue;
    }

    // Parse order items and notes
    if (orderDetailsStarted) {
      // Line is already normalized by normalizeText() at the start
      // But ensure it's trimmed
      const cleanLine = line.trim();
      
      // Skip empty lines
      if (!cleanLine || cleanLine === '-') {
        continue;
      }
      
      // Check if we've reached the Notes section or other stop words
      if (cleanLine.match(/^Notes?\s*:?\s*$/i) ||
          cleanLine.match(/^Packaging/i) ||
          cleanLine.match(/^Metode/i) ||
          cleanLine.match(/^Biaya/i) ||
          cleanLine.match(/^Mendapatkan/i) ||
          cleanLine.match(/^Nama\s+Event/i) ||
          cleanLine.match(/^Durasi\s+Event/i) ||
          cleanLine.match(/^Tanggal/i) ||
          cleanLine.match(/^Waktu\s+Kirim/i)) {
        // Stop word reached, end Detail Pesanan section
        orderDetailsStarted = false;
        // Process this line in next iteration
        i--;
        continue;
      }
      
      // Flexible regex to match item formats:
      // - "• 80 x Dawet Kemayu Small" (with bullet and x)
      // - "80 x Dawet Kemayu Small" (no bullet, with x)
      // - "80x Dawet Kemayu Small" (no space before x)
      // - "80 Dawet Kemayu Small" (no x)
      // - "2 * Dawet Kemayu Large" (asterisk instead of x)
      // Pattern: optional bullet (•, -, *), optional spaces, number, optional spaces, optional x or *, optional spaces, item name
      // Use non-greedy match and ensure we capture the full item name
      const itemMatch = cleanLine.match(/^\s*(?:[•\-*]\s*)?(\d+)\s*(?:x|\*)?\s*(.+)$/i);
      if (itemMatch && itemMatch[1] && itemMatch[2]) {
        const quantity = parseInt(itemMatch[1], 10);
        const itemName = itemMatch[2].trim();
        if (itemName && itemName.length > 0 && quantity > 0 && !isNaN(quantity)) {
          order.items.push({
            quantity: quantity,
            name: itemName,
          });
          continue;
        }
      }
      
      // If no match, check if it's a note (doesn't start with number)
      if (!cleanLine.match(/^\d+/)) {
        const note = cleanLine.replace(/^[-•*]\s*/, '').trim();
        if (note && note.length > 0) {
          order.notes.push(note);
        }
      } else {
        // Line starts with number but didn't match - log for debugging
      }
    }
  }

  // Finalize address if still collecting
  if (currentSection === 'address' && addressLines.length > 0) {
    order.address = addressLines.join(', ').trim();
  }

  // Set delivery_fee_source if not provided (V1 format doesn't have Biaya Pengiriman field)
  if (order.delivery_fee_source === null) {
    order.delivery_fee = 0;
    order.delivery_fee_source = 'NOT_PROVIDED';
  }

  // Log parsing results
  // Fallback: If delivery_time is still empty, try extracting from natural language
  if (!order.delivery_time || order.delivery_time.trim() === '') {
    const extractedTime = extractDeliveryTimeFromMessage(normalizedText);
    if (extractedTime) {
      order.delivery_time = extractedTime;
    }
  } else {
    // Normalize existing delivery_time to ensure HH:MM format
    try {
      const originalTime = order.delivery_time;
      order.delivery_time = normalizeDeliveryTime(order.delivery_time);
      if (order.delivery_time !== originalTime) {
      }
    } catch (error) {
      console.warn(`⚠️ [PARSE_V1] Failed to normalize existing delivery_time "${order.delivery_time}":`, error.message);
      // Try natural language extraction as fallback
      const extractedTime = extractDeliveryTimeFromMessage(normalizedText);
      if (extractedTime) {
        order.delivery_time = extractedTime;
      }
    }
  }

  return order;
}
