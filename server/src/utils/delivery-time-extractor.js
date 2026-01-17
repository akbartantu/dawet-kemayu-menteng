/**
 * Delivery Time Extraction
 * Extracts delivery time from natural language message text
 */

import { normalizeDeliveryTime } from '../services/price-calculator.js';

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
    console.warn(`⚠️ [PARSE] Failed to normalize delivery_time "${cleanedToken}":`, error.message);
    return null;
  }
}
