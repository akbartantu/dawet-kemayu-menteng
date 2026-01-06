/**
 * Order Parser
 * Extracts structured order information from customer messages
 */

import { normalizeDeliveryTime } from './price-calculator.js';

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
 * Extract delivery time from natural language message text
 * Handles various formats like "*Kirim dari outlet: 10.45 WIB*", "kirim pukul 10.45", etc.
 * @param {string} messageText - Full message text
 * @returns {string|null} Normalized delivery time in HH:MM format, or null if not found
 */
export function extractDeliveryTimeFromMessage(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    return null;
  }

  // Step 1: Pre-clean the text
  let cleaned = messageText
    .replace(/\*+/g, '') // Remove markdown asterisks
    .replace(/_+/g, '') // Remove underscores
    .replace(/`+/g, '') // Remove backticks
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  if (!cleaned) {
    return null;
  }

  // Step 2: Search line-by-line (more reliable)
  const lines = cleaned.split('\n').map(line => line.trim()).filter(line => line);
  
  // Priority order for matching:
  // 1) explicit "Jam kirim:" / "Waktu kirim:"
  // 2) "Kirim dari outlet:"
  // 3) any "kirim" line containing a time
  
  let matchedLine = null;
  let timeToken = null;

  for (const line of lines) {
    const lineLower = line.toLowerCase();
    
    // Priority 1: Explicit "Jam kirim:" or "Waktu kirim:"
    if (lineLower.match(/^(jam|waktu)\s+kirim\s*:?\s*/i)) {
      matchedLine = line;
      console.log(`🔍 [PARSE] Found explicit delivery time line: "${line}"`);
      
      // Extract time token after the keyword
      const timeMatch = line.match(/(?:jam|waktu)\s+kirim\s*:?\s*(.+)/i);
      if (timeMatch && timeMatch[1]) {
        timeToken = timeMatch[1].trim();
        break; // Highest priority, stop searching
      }
    }
    // Priority 2: "Kirim dari outlet:"
    else if (lineLower.match(/kirim\s+dari\s+outlet\s*:?\s*/i) && !matchedLine) {
      matchedLine = line;
      console.log(`🔍 [PARSE] Found "Kirim dari outlet" line: "${line}"`);
      
      // Extract time token after "Kirim dari outlet:"
      const timeMatch = line.match(/kirim\s+dari\s+outlet\s*:?\s*(.+)/i);
      if (timeMatch && timeMatch[1]) {
        timeToken = timeMatch[1].trim();
        // Don't break - continue to check for Priority 1
      }
    }
    // Priority 3: Any line containing "kirim" and a time pattern
    else if (lineLower.includes('kirim') && !matchedLine) {
      // Check if line contains a time pattern
      const hasTimePattern = /(\d{1,2}[.:]\d{1,2}|\d{1,2}(?:\s*(?:wib|wita|wit|jam|pukul))?)/i.test(line);
      if (hasTimePattern) {
        matchedLine = line;
        console.log(`🔍 [PARSE] Found "kirim" line with time pattern: "${line}"`);
        
        // Extract time token - look for time pattern after "kirim"
        const timeMatch = line.match(/kirim(?:\s+(?:dari|pukul|jam))?\s*:?\s*(.+)/i);
        if (timeMatch && timeMatch[1]) {
          timeToken = timeMatch[1].trim();
        } else {
          // Fallback: extract time pattern from anywhere in the line
          const patternMatch = line.match(/(\d{1,2}[.:]\d{1,2}|\d{1,2})/);
          if (patternMatch) {
            timeToken = patternMatch[1];
          }
        }
      }
    }
  }

  // If no match found, try searching entire message for time patterns
  if (!timeToken) {
    // Look for time patterns anywhere in the message
    const globalTimeMatch = cleaned.match(/(\d{1,2}[.:]\d{1,2}|\d{1,2})/);
    if (globalTimeMatch) {
      console.log(`🔍 [PARSE] Found time pattern in message (no keyword match): "${globalTimeMatch[1]}"`);
      timeToken = globalTimeMatch[1];
    }
  }

  if (!timeToken) {
    console.log(`⚠️ [PARSE] delivery_time not found in message`);
    return null;
  }

  // Step 3: Clean the time token
  // Remove timezone suffixes, "jam", "pukul", etc.
  let cleanedToken = timeToken
    .replace(/\s*(wib|wita|wit|am|pm)\s*$/i, '') // Remove timezone at end
    .replace(/^(jam|pukul)\s+/i, '') // Remove "jam" or "pukul" at start
    .replace(/\s*(jam|pukul)\s*$/i, '') // Remove "jam" or "pukul" at end
    .trim();

  if (!cleanedToken) {
    console.log(`⚠️ [PARSE] Time token became empty after cleaning: "${timeToken}"`);
    return null;
  }

  console.log(`🔍 [PARSE] Extracted time token: "${cleanedToken}"`);

  // Step 4: Normalize using normalizeDeliveryTime()
  try {
    const normalized = normalizeDeliveryTime(cleanedToken);
    console.log(`✅ [PARSE] Normalized delivery_time: "${normalized}"`);
    return normalized;
  } catch (error) {
    console.warn(`⚠️ [PARSE] Failed to normalize delivery_time "${cleanedToken}":`, error.message);
    return null;
  }
}

/**
 * Parse order information from message text
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
  
  console.log(`🔍 [PARSE_V1] Text normalization: ${rawLength} → ${normalizedLength} chars`);
  if (rawLength !== normalizedLength) {
    console.log(`⚠️ [PARSE_V1] Invisible characters detected and removed (${rawLength - normalizedLength} chars)`);
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

    // Parse order details (case-insensitive)
    if (line.match(/^Detail\s+[Pp]esanan\s*:?\s*$/i)) {
      orderDetailsStarted = true;
      console.log(`🔍 [PARSE_V1] Found "Detail pesanan" section, starting item extraction`);
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
          console.log(`✅ [PARSE_V1] Extracted item: ${quantity}x ${itemName}`);
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
        console.log(`⚠️ [PARSE_V1] Line starts with number but didn't match item pattern: "${cleanLine}"`);
      }
    }
  }

  // Finalize address if still collecting
  if (currentSection === 'address' && addressLines.length > 0) {
    order.address = addressLines.join(', ').trim();
  }

  // Log parsing results
  console.log(`📊 [PARSE_V1] Parse summary:`, {
    customer_name: order.customer_name ? '✓' : '✗',
    phone_number: order.phone_number ? '✓' : '✗',
    address: order.address ? '✓' : '✗',
    items_count: order.items.length,
    items_sample: order.items.length > 0 ? `${order.items[0].quantity}x ${order.items[0].name}` : 'none',
    event_date: order.event_date ? '✓' : '✗',
    delivery_time: order.delivery_time ? '✓' : '✗',
  });

  // Fallback: If delivery_time is still empty, try extracting from natural language
  if (!order.delivery_time || order.delivery_time.trim() === '') {
    console.log(`🔍 [PARSE_V1] delivery_time not found in standard format, trying natural language extraction...`);
    const extractedTime = extractDeliveryTimeFromMessage(normalizedText);
    if (extractedTime) {
      order.delivery_time = extractedTime;
      console.log(`✅ [PARSE_V1] Extracted delivery_time from natural language: "${extractedTime}"`);
    }
  } else {
    // Normalize existing delivery_time to ensure HH:MM format
    try {
      const originalTime = order.delivery_time;
      order.delivery_time = normalizeDeliveryTime(order.delivery_time);
      if (order.delivery_time !== originalTime) {
        console.log(`🔍 [PARSE_V1] Normalized delivery_time: "${originalTime}" → "${order.delivery_time}"`);
      }
    } catch (error) {
      console.warn(`⚠️ [PARSE_V1] Failed to normalize existing delivery_time "${order.delivery_time}":`, error.message);
      // Try natural language extraction as fallback
      const extractedTime = extractDeliveryTimeFromMessage(normalizedText);
      if (extractedTime) {
        order.delivery_time = extractedTime;
        console.log(`✅ [PARSE_V1] Used natural language extraction as fallback: "${extractedTime}"`);
      }
    }
  }

  return order;
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
  let summary = `📋 **Order Summary**\n\n`;
  summary += `👤 **Customer:** ${order.customer_name || 'N/A'}\n`;
  summary += `📞 **Phone:** ${order.phone_number || 'N/A'}\n`;
  summary += `📍 **Address:** ${order.address || 'N/A'}\n\n`;

  if (order.event_name) {
    summary += `🎉 **Event:** ${order.event_name}\n`;
  }
  if (order.event_duration) {
    summary += `⏱️ **Duration:** ${order.event_duration}\n`;
  }
  if (order.event_date) {
    summary += `📅 **Date:** ${order.event_date}\n`;
  }
  if (order.delivery_time) {
    summary += `🕐 **Delivery Time:** ${order.delivery_time}\n`;
  }

  if (order.items.length > 0) {
    summary += `\n📦 **Items:**\n`;
    
    // Calculate total cups and required styrofoam boxes
    let totalCups = 0;
    let hasPackagingRequest = false;
    
    // Check notes for packaging request (e.g., "Packaging Styrofoam: YA")
    if (order.notes && order.notes.length > 0) {
      for (const note of order.notes) {
        const noteLower = (note || '').toLowerCase();
        if ((noteLower.includes('packaging') || noteLower.includes('styrofoam')) && 
            (noteLower.includes('ya') || noteLower.includes('yes')) && 
            !noteLower.includes('tidak')) {
          hasPackagingRequest = true;
          break;
        }
      }
    }
    
    // Count cups and check items for packaging
    order.items.forEach(item => {
      const itemName = (item.name || '').toLowerCase();
      
      // Check if packaging is requested in items
      if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
        hasPackagingRequest = true;
        return; // Skip packaging items in cup count
      }
      
      // Count cups from cup-based products (Dawet Small/Medium/Large)
      if (itemName.includes('dawet') && 
          (itemName.includes('small') || 
           itemName.includes('medium') || 
           itemName.includes('large'))) {
        // Exclude botol items (they're not cups)
        if (!itemName.includes('botol')) {
          totalCups += parseInt(item.quantity || 0);
        }
      }
    });
    
    // Calculate required styrofoam boxes (1 box per 50 cups, rounded up)
    const requiredStyrofoamBoxes = hasPackagingRequest && totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
    let packagingShown = false;
    
    // Display items, replacing packaging with calculated quantity
    order.items.forEach(item => {
      const itemName = (item.name || '').toLowerCase();
      
      // If this is a packaging item, show calculated quantity
      if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
        if (requiredStyrofoamBoxes > 0) {
          summary += `• ${requiredStyrofoamBoxes}x Packaging Styrofoam (50 cup)\n`;
          packagingShown = true;
        }
        // Skip the original packaging item (we've replaced it with calculated value)
        return;
      }
      
      // Display other items normally
      summary += `• ${item.quantity}x ${item.name}\n`;
    });
    
    // If packaging was requested (via notes) but not in items, add it
    if (hasPackagingRequest && !packagingShown) {
      if (requiredStyrofoamBoxes > 0) {
        summary += `• ${requiredStyrofoamBoxes}x Packaging Styrofoam (50 cup)\n`;
      } else if (totalCups === 0) {
        // If packaging requested but no cups found, show default 1 box
        summary += `• 1x Packaging Styrofoam (50 cup)\n`;
      }
    }
  }

  if (order.notes.length > 0) {
    summary += `\n📝 **Notes:**\n`;
    order.notes.forEach(note => {
      summary += `• ${note}\n`;
    });
  }

  return summary;
}

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
  
  console.log(`🔍 [PARSE_V2] Text normalization: ${rawLength} → ${normalizedLength} chars`);
  if (rawLength !== normalizedLength) {
    console.log(`⚠️ [PARSE_V2] Invisible characters detected and removed (${rawLength - normalizedLength} chars)`);
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
    delivery_fee: null, // Biaya Pengiriman (Ongkir)
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
      console.log(`🔍 [PARSE_V2] Found "Detail Pesanan" section, starting item extraction`);
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
          console.log(`✅ [PARSE_V2] Extracted item: ${quantity}x ${itemName}`);
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
        console.log(`⚠️ [PARSE_V2] Line starts with number but didn't match item pattern: "${cleanLine}"`);
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

    // Parse Metode pengiriman
    if (line.match(/^Metode\s+pengiriman\s*:?\s*(.+)$/i)) {
      const method = line.replace(/^Metode\s+pengiriman\s*:?\s*/i, '').trim();
      if (method && method !== '-') {
        // Normalize: pickup | grabexpress | custom
        const methodLower = method.toLowerCase();
        if (methodLower.includes('pickup')) {
          order.notes.push('Metode Pengiriman: Pickup');
        } else if (methodLower.includes('grab') || methodLower.includes('grabexpress')) {
          order.notes.push('Metode Pengiriman: GrabExpress');
        } else if (methodLower.includes('custom')) {
          order.notes.push('Metode Pengiriman: Custom');
        } else {
          order.notes.push(`Metode Pengiriman: ${method}`);
        }
      }
      continue;
    }

    // Parse Biaya Pengiriman (Rp) - store as delivery_fee
    if (line.match(/^Biaya\s+Pengiriman\s*\(Rp\)\s*:?\s*(.+)$/i)) {
      const cost = line.replace(/^Biaya\s+Pengiriman\s*\(Rp\)\s*:?\s*/i, '').trim();
      if (cost && cost !== '-') {
        // Extract numeric value
        const costNum = cost.replace(/[^\d]/g, '');
        if (costNum) {
          const deliveryFee = parseInt(costNum, 10);
          if (!isNaN(deliveryFee) && deliveryFee >= 0) {
            order.delivery_fee = deliveryFee;
            console.log(`✅ [PARSE_V2] Extracted delivery_fee: Rp ${deliveryFee}`);
          }
        }
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

  // Log parsing results
  console.log(`📊 [PARSE_V2] Parse summary:`, {
    customer_name: order.customer_name ? '✓' : '✗',
    phone_number: order.phone_number ? '✓' : '✗',
    address: order.address ? '✓' : '✗',
    items_count: order.items.length,
    items_sample: order.items.length > 0 ? `${order.items[0].quantity}x ${order.items[0].name}` : 'none',
    event_date: order.event_date ? '✓' : '✗',
    delivery_time: order.delivery_time ? '✓' : '✗',
    delivery_fee: order.delivery_fee !== null ? `Rp ${order.delivery_fee}` : '✗',
  });

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
    return parseOrderMessageV2(messageText);
  } else {
    // Default to V1 (original format) for backward compatibility
    return parseOrderFromMessage(messageText);
  }
}
