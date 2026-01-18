/**
 * Order Parser V2
 * Parses orders from the Indonesian template format (V2)
 */

import { normalizeText, normalizeDeliveryMethod } from '../utils/text-normalizer.js';
import { extractDeliveryTimeFromMessage } from '../utils/delivery-time-extractor.js';
import { normalizeDeliveryTime } from './price-calculator.js';

/**
 * Parse order from Indonesian template format (V2)
 * Example format:
 * Nama Pemesan: Hera
 * Nama Penerima: Hera
 * No HP Penerima: 081244682739
 * Alamat Penerima: ...
 * Nama Event (jika ada): -
 * Durasi Event (dalam jam): -
 * Tanggal Event: 06/01/2026
 * Waktu Kirim (jam): 08.00
 * Detail Pesanan:
 * • 80 x Dawet Kemayu Small
 * Packaging Styrofoam (1 box 40K untuk 50 cup): YA
 * Metode pengiriman: Pickup / GrabExpress / Custom
 * Biaya Pengiriman (Rp): 100000
 * Notes:
 * Mendapatkan info Dawet Kemayu Menteng dari: Teman / Instagram / Facebook / TikTok / Lainnya (sebutkan)
 */
export function parseOrderMessageV2(messageText) {
  // Normalize text first to remove invisible Unicode characters
  const normalizedText = normalizeText(messageText);
  const rawLength = messageText ? messageText.length : 0;
  const normalizedLength = normalizedText.length;
  if (rawLength !== normalizedLength) {
  }

  const order = {
    customer_name: null,
    receiver_name: null,
    phone_number: null,
    address: null,
    event_name: null,
    event_duration: null,
    event_date: null,
    delivery_time: null,
    items: [],
    notes: [],
    delivery_fee: null, // Biaya Pengiriman (Ongkir) - canonical field for Google Sheets
    delivery_fee_source: null, // 'USER_INPUT', 'USER_EMPTY', 'NOT_PROVIDED'
    delivery_method: null, // Metode pengiriman (Pickup, GrabExpress, Custom, etc.) - stored in Orders.delivery_method
  };

  if (!normalizedText || normalizedText.length === 0) {
    return order;
  }

  const lines = normalizedText.split('\n').map(line => line.trim()).filter(line => line);
  
  let currentSection = null;
  let addressLines = [];
  let orderDetailsStarted = false;
  let notesStarted = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Remove emojis and bullet variants for parsing
    line = line.replace(/^[📝•\-\*1-9.]+\s*/, '').trim();

    // Parse Nama Pemesan
    if (line.match(/^Nama\s+Pemesan\s*:?\s*(.+)$/i)) {
      const name = line.replace(/^Nama\s+Pemesan\s*:?\s*/i, '').trim();
      if (name && name !== '-' && name.length > 0) {
        order.customer_name = name;
      }
      continue;
    }

    // Parse Nama Penerima
    if (line.match(/^Nama\s+Penerima\s*:?\s*(.+)$/i)) {
      const name = line.replace(/^Nama\s+Penerima\s*:?\s*/i, '').trim();
      if (name && name !== '-' && name.length > 0) {
        order.receiver_name = name;
      }
      continue;
    }

    // Parse No HP Penerima
    if (line.match(/^No\s+HP\s+Penerima\s*:?\s*(.+)$/i)) {
      const phone = line.replace(/^No\s+HP\s+Penerima\s*:?\s*/i, '').trim();
      if (phone && phone !== '-') {
        order.phone_number = phone;
      }
      continue;
    }

    // Parse Alamat Penerima
    if (line.match(/^Alamat\s+Penerima\s*:?\s*(.+)$/i)) {
      const addressText = line.replace(/^Alamat\s+Penerima\s*:?\s*/i, '').trim();
      if (addressText && addressText !== '-') {
        order.address = addressText;
        currentSection = null;
      } else {
        // Address on next line(s)
        currentSection = 'address';
        addressLines = [];
      }
      continue;
    }

    // Continue collecting address lines
    if (currentSection === 'address') {
      // Check if next section starts
      if (line.match(/^Nama\s+Event/i) || 
          line.match(/^Durasi\s+Event/i) || 
          line.match(/^Tanggal\s+Event/i) || 
          line.match(/^Waktu\s+Kirim/i) || 
          line.match(/^Detail\s+Pesanan/i) ||
          line.match(/^Packaging/i) ||
          line.match(/^Metode/i) ||
          line.match(/^Biaya/i) ||
          line.match(/^Notes/i) ||
          line.match(/^Mendapatkan/i)) {
        if (addressLines.length > 0) {
          order.address = addressLines.join(', ').trim();
        }
        currentSection = null;
        i--; // Reprocess this line
        continue;
      }
      if (line && line !== '-') {
        addressLines.push(line);
      }
      continue;
    }

    // Parse Nama Event (jika ada)
    if (line.match(/^Nama\s+Event\s*\(jika\s+ada\)\s*:?\s*(.+)$/i)) {
      const eventName = line.replace(/^Nama\s+Event\s*\(jika\s+ada\)\s*:?\s*/i, '').trim();
      if (eventName && eventName !== '-') {
        order.event_name = eventName;
      }
      continue;
    }

    // Parse Durasi Event (dalam jam)
    if (line.match(/^Durasi\s+Event\s*\(dalam\s+jam\)\s*:?\s*(.+)$/i)) {
      const duration = line.replace(/^Durasi\s+Event\s*\(dalam\s+jam\)\s*:?\s*/i, '').trim();
      if (duration && duration !== '-') {
        order.event_duration = duration;
      }
      continue;
    }

    // Parse Tanggal Event
    if (line.match(/^Tanggal\s+Event\s*:?\s*(.+)$/i)) {
      const dateText = line.replace(/^Tanggal\s+Event\s*:?\s*/i, '').trim();
      if (dateText && dateText !== '-') {
        order.event_date = dateText;
      }
      continue;
    }

    // Parse Waktu Kirim (jam) - handles both "08.00" and "08:00"
    if (line.match(/^Waktu\s+Kirim\s*\(jam\)\s*:?\s*(.+)$/i)) {
      const timeText = line.replace(/^Waktu\s+Kirim\s*\(jam\)\s*:?\s*/i, '').trim();
      if (timeText && timeText !== '-') {
        // Normalize "08.00" to "08:00" format
        const normalizedTime = timeText.replace(/\./g, ':');
        try {
          order.delivery_time = normalizeDeliveryTime(normalizedTime);
        } catch (error) {
          order.delivery_time = normalizedTime;
        }
      }
      continue;
    }

    // Parse Detail Pesanan section (case-insensitive, handles both "Detail Pesanan" and "Detail pesanan")
    if (line.match(/^Detail\s+[Pp]esanan\s*:?\s*$/i)) {
      orderDetailsStarted = true;
      continue;
    }

    // Parse items in Detail Pesanan
    if (orderDetailsStarted && !notesStarted) {
      // Check if we've reached Packaging, Metode, Biaya, Notes, or Mendapatkan section
      // Also check for other stop words that might appear
      if (line.match(/^Packaging/i) || 
          line.match(/^Metode/i) || 
          line.match(/^Biaya/i) || 
          line.match(/^Notes?\s*:?\s*$/i) ||
          line.match(/^Mendapatkan/i) ||
          line.match(/^Nama\s+Event/i) ||
          line.match(/^Durasi\s+Event/i) ||
          line.match(/^Tanggal/i) ||
          line.match(/^Waktu\s+Kirim/i)) {
        orderDetailsStarted = false;
        // Process this line in next iteration
        i--;
        continue;
      }

      // Skip empty lines
      if (!line || line === '-') {
        continue;
      }

      // Line is already normalized, but ensure it's trimmed
      const cleanLine = line.trim();
      
      // Flexible regex to match item formats:
      // - "• 80 x Dawet Kemayu Small" (with bullet and x)
      // - "•⁠  ⁠80 x Dawet Kemayu Small" (with bullet and zero-width spaces)
      // - "80 x Dawet Kemayu Small" (no bullet, with x)
      // - "80x Dawet Kemayu Small" (no space before x)
      // - "80 Dawet Kemayu Small" (no x)
      // - "2 * Dawet Kemayu Large" (asterisk instead of x)
      // Pattern: optional bullet (•, -, *), optional spaces (including zero-width), number, optional spaces, optional x or *, optional spaces, item name
      // Use non-greedy match and ensure we capture the full item name
      // CRITICAL: Handle zero-width spaces that might appear after bullet (•⁠)
      const itemMatch = cleanLine.match(/^\s*(?:[•\-*][\s\u200B-\u200D\uFEFF]*)?(\d+)\s*(?:x|\*)?\s*(.+)$/i);
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
      
      // Fallback: Try matching without bullet (in case bullet pattern failed)
      if (!itemMatch) {
        const fallbackMatch = cleanLine.match(/^(\d+)\s*(?:x|\*)?\s*(.+)$/i);
        if (fallbackMatch && fallbackMatch[1] && fallbackMatch[2]) {
          const quantity = parseInt(fallbackMatch[1], 10);
          const itemName = fallbackMatch[2].trim();
          if (itemName && itemName.length > 0 && quantity > 0 && !isNaN(quantity)) {
            order.items.push({
              quantity: quantity,
              name: itemName,
            });
            continue;
          }
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

    // Parse Packaging Styrofoam
    if (line.match(/^Packaging\s+Styrofoam\s*\([^)]+\)\s*:?\s*(.+)$/i)) {
      const packaging = line.replace(/^Packaging\s+Styrofoam\s*\([^)]+\)\s*:?\s*/i, '').trim();
      if (packaging && packaging.toUpperCase() === 'YA' || packaging.toUpperCase() === 'YES') {
        // Add packaging as a note (will be processed later)
        order.notes.push('Packaging Styrofoam: YA');
      }
      continue;
    }

    // Parse Metode pengiriman (robust regex with multiline support)
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

    // Parse Biaya Pengiriman (Rp) - store as delivery_fee with validation
    // Accepts: "Biaya Pengiriman (Rp):", "Biaya Pengiriman:", "Ongkir:", "Delivery Fee:"
    if (line.match(/^(?:Biaya\s+Pengiriman\s*\(Rp\)|Biaya\s+Pengiriman|Ongkir|Delivery\s+Fee)\s*:?\s*(.+)$/i)) {
      const originalLine = line;
      const cost = line.replace(/^(?:Biaya\s+Pengiriman\s*\(Rp\)|Biaya\s+Pengiriman|Ongkir|Delivery\s+Fee)\s*:?\s*/i, '').trim();
      if (!cost || cost === '-') {
        // Field exists but is empty
        order.delivery_fee = 0;
        order.delivery_fee_source = 'USER_EMPTY';
      } else {
        // Remove "Rp", spaces, dots, commas (thousand separators)
        const costNum = cost.replace(/Rp/gi, '').replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '');
        
        if (!costNum || costNum.length === 0) {
          // Non-numeric value - THROW ERROR
          const error = new Error(`Biaya Pengiriman harus berupa angka. Contoh: 100000`);
          error.field = 'delivery_fee';
          error.originalValue = cost;
          throw error;
        }
        
        const deliveryFee = parseInt(costNum, 10);
        if (isNaN(deliveryFee) || deliveryFee < 0) {
          // Invalid number - THROW ERROR
          const error = new Error(`Biaya Pengiriman harus berupa angka. Contoh: 100000`);
          error.field = 'delivery_fee';
          error.originalValue = cost;
          throw error;
        }
        
        order.delivery_fee = deliveryFee;
        order.delivery_fee_source = 'USER_INPUT';
      }
      continue;
    }

    // Parse Notes section
    if (line.match(/^Notes?\s*:?\s*$/i)) {
      notesStarted = true;
      continue;
    }

    // Collect notes
    if (notesStarted) {
      if (line.match(/^Mendapatkan/i)) {
        notesStarted = false;
        // Process this line
        i--;
        continue;
      }
      if (line && line !== '-') {
        order.notes.push(line);
      }
      continue;
    }

    // Parse referral source
    if (line.match(/^Mendapatkan\s+info\s+Dawet\s+Kemayu\s+Menteng\s+dari\s*:?\s*(.+)$/i)) {
      const source = line.replace(/^Mendapatkan\s+info\s+Dawet\s+Kemayu\s+Menteng\s+dari\s*:?\s*/i, '').trim();
      if (source && source !== '-') {
        order.notes.push(`Referral: ${source}`);
      }
      continue;
    }
  }

  // Finalize address if still collecting
  if (currentSection === 'address' && addressLines.length > 0) {
    order.address = addressLines.join(', ').trim();
  }

  // Set delivery_fee_source if not provided
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
    // Normalize existing delivery_time
    try {
      order.delivery_time = normalizeDeliveryTime(order.delivery_time);
    } catch (error) {
      // Keep original if normalization fails
    }
  }

  // Use receiver_name as customer_name if customer_name is missing
  if (!order.customer_name && order.receiver_name) {
    order.customer_name = order.receiver_name;
  }

  return order;
}
