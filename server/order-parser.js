/**
 * Order Parser
 * Extracts structured order information from customer messages
 */
import { normalizeDeliveryTime } from './price-calculator.js';
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
      : "${globalTimeMatch[1]}"`);
      timeToken = globalTimeMatch[1];
    }
  }
  if (!timeToken) {
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
    return null;
  }
  // Step 4: Normalize using normalizeDeliveryTime()
  try {
    const normalized = normalizeDeliveryTime(cleanedToken);
    return normalized;
  } catch (error) {
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
  const lines = messageText.split('\n').map(line => line.trim()).filter(line => line);
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
    // Parse order details
    if (line.match(/^Detail pesanan\s*:?\s*$/i)) {
      orderDetailsStarted = true;
      continue;
    }
    // Parse order items and notes
    if (orderDetailsStarted) {
      // Clean line first - remove zero-width spaces and other invisible characters
      const cleanLine = line.replace(/[⁠\u200B-\u200D\uFEFF]/g, '').trim();
      // Skip empty lines
      if (!cleanLine) {
        continue;
      }
      // Check if we've reached the Notes section
      if (cleanLine.match(/^Notes?\s*:?\s*$/i)) {
        // Notes section started, continue to next line
        continue;
      }
      // Match item format with "x": "- 20 x Dawet Medium + Nangka" or "20 x Dawet Medium"
      // Pattern: optional "-" or "•", optional spaces, number, spaces, "x", spaces, item name
      const itemMatchWithX = cleanLine.match(/^[-•]?\s*(\d+)\s+x\s+(.+)$/i);
      if (itemMatchWithX) {
        const quantity = parseInt(itemMatchWithX[1]);
        const itemName = itemMatchWithX[2].trim();
        if (itemName && itemName.length > 0) {
          order.items.push({
            quantity: quantity,
            name: itemName,
          });
        }
        continue;
      }
      // Match item format without "x": "20 dawet medium ori" or "15 dawet medium topping durian"
      // Pattern: starts with number, then item name (no "x")
      const itemMatchNoX = cleanLine.match(/^[-•]?\s*(\d+)\s+([a-zA-Z].+)$/i);
      if (itemMatchNoX) {
        const quantity = parseInt(itemMatchNoX[1]);
        const itemName = itemMatchNoX[2].trim();
        // Normalize item name
        let normalizedName = itemName;
        // Handle common variations
        if (itemName.match(/dawet\s+medium\s+ori/i)) {
          normalizedName = 'Dawet Medium Original';
        } else if (itemName.match(/dawet\s+medium\s+topping\s+durian/i)) {
          normalizedName = 'Dawet Medium + Durian';
        } else if (itemName.match(/dawet\s+medium\s+topping\s+nangka/i)) {
          normalizedName = 'Dawet Medium + Nangka';
        } else if (itemName.match(/dawet\s+medium/i)) {
          normalizedName = itemName.replace(/dawet\s+medium/i, 'Dawet Medium');
        }
        if (normalizedName && normalizedName.length > 0) {
          order.items.push({
            quantity: quantity,
            name: normalizedName,
          });
        }
        continue;
      }
      // Match notes/instructions: "- Packaging styrofoam" or "Packaging Styrofoam" (no quantity)
      // Notes are lines that don't start with a number
      if (cleanLine.match(/^[-•]?\s*(.+)$/i)) {
        const note = cleanLine.replace(/^[-•]\s*/, '').trim();
        // Only add as note if it doesn't look like an item (doesn't start with number)
        if (note && !note.match(/^\d+/)) {
          order.notes.push(note);
        }
        continue;
      }
    }
  }
  // Finalize address if still collecting
  if (currentSection === 'address' && addressLines.length > 0) {
    order.address = addressLines.join(', ').trim();
  }
  // Fallback: If delivery_time is still empty, try extracting from natural language
  if (!order.delivery_time || order.delivery_time.trim() === '') {
    const extractedTime = extractDeliveryTimeFromMessage(messageText);
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
      // Try natural language extraction as fallback
      const extractedTime = extractDeliveryTimeFromMessage(messageText);
      if (extractedTime) {
        order.delivery_time = extractedTime;
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
