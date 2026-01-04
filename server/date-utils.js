/**
 * Date Utilities
 * Helper functions for date parsing and comparison
 */

/**
 * Indonesian month names mapping
 */
const INDONESIAN_MONTHS = {
  'januari': 1, 'februari': 2, 'maret': 3, 'april': 4,
  'mei': 5, 'juni': 6, 'juli': 7, 'agustus': 8,
  'september': 9, 'oktober': 10, 'november': 11, 'desember': 12
};

/**
 * English month names mapping
 */
const ENGLISH_MONTHS = {
  'january': 1, 'february': 2, 'march': 3, 'april': 4,
  'may': 5, 'june': 6, 'july': 7, 'august': 8,
  'september': 9, 'october': 10, 'november': 11, 'december': 12
};

/**
 * Normalize event date to YYYY-MM-DD format for storage
 * Accepts various input formats and always outputs YYYY-MM-DD
 * @param {string} input - Date string in various formats
 * @returns {string} Normalized date in YYYY-MM-DD format
 * @throws {Error} If date is invalid or cannot be parsed
 */
export function normalizeEventDate(input) {
  if (!input || typeof input !== 'string') {
    throw new Error(`Invalid event_date input: ${input}`);
  }
  
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Empty event_date string');
  }
  
  let day, month, year;
  
  // Try DD/MM/YYYY or D/M/YYYY format
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/').map(p => p.trim());
    if (parts.length !== 3) {
      throw new Error(`Invalid date format (expected DD/MM/YYYY): ${trimmed}`);
    }
    
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
    
    // Handle 2-digit years (assume 2000-2099)
    if (year < 100) {
      year += 2000;
    }
  }
  // Try DD-MM-YYYY or D-M-YYYY format
  else if (trimmed.includes('-') && trimmed.match(/^\d{1,2}-\d{1,2}-\d{4}$/)) {
    const parts = trimmed.split('-').map(p => p.trim());
    if (parts.length !== 3) {
      throw new Error(`Invalid date format (expected DD-MM-YYYY): ${trimmed}`);
    }
    
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  }
  // Try format with month name (e.g., "18 Januari 2026", "18 January 2026")
  else {
    // Match patterns like "18 Januari 2026" or "18 January 2026"
    const monthNameMatch = trimmed.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/i);
    if (monthNameMatch) {
      day = parseInt(monthNameMatch[1], 10);
      const monthName = monthNameMatch[2].toLowerCase();
      year = parseInt(monthNameMatch[3], 10);
      
      // Check Indonesian months first
      if (INDONESIAN_MONTHS[monthName]) {
        month = INDONESIAN_MONTHS[monthName];
      }
      // Check English months
      else if (ENGLISH_MONTHS[monthName]) {
        month = ENGLISH_MONTHS[monthName];
      }
      else {
        throw new Error(`Unknown month name: ${monthNameMatch[2]} in date: ${trimmed}`);
      }
    }
    // Try standard Date parsing as last resort
    else {
      const date = new Date(trimmed);
      if (isNaN(date.getTime())) {
        throw new Error(`Cannot parse date: ${trimmed}`);
      }
      day = date.getDate();
      month = date.getMonth() + 1; // getMonth() returns 0-11
      year = date.getFullYear();
    }
  }
  
  // Validate parsed values
  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    throw new Error(`Invalid date parts - day: ${day}, month: ${month}, year: ${year} from input: ${trimmed}`);
  }
  
  // Validate ranges
  if (day < 1 || day > 31) {
    throw new Error(`Invalid day: ${day} (must be 1-31) from input: ${trimmed}`);
  }
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month} (must be 1-12) from input: ${trimmed}`);
  }
  if (year < 2000 || year > 2100) {
    throw new Error(`Invalid year: ${year} (must be 2000-2100) from input: ${trimmed}`);
  }
  
  // Construct Date to validate (catches invalid dates like Feb 30)
  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${day}/${month}/${year} from input: ${trimmed}`);
  }
  
  // Verify the date matches input (catch month/day overflow)
  if (date.getDate() !== day || date.getMonth() !== (month - 1) || date.getFullYear() !== year) {
    throw new Error(`Date mismatch - parsed ${day}/${month}/${year} but got ${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()} from input: ${trimmed}`);
  }
  
  // Format as YYYY-MM-DD
  const formatted = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  console.log(`✅ [NORMALIZE_EVENT_DATE] "${trimmed}" → "${formatted}"`);
  return formatted;
}

/**
 * Parse date string in DD/MM/YYYY format
 * @deprecated Use normalizeEventDate() for new code - this returns Date object, not normalized string
 */
export function parseDate(dateString) {
  if (!dateString) return null;
  
  // Handle format: DD/MM/YYYY or DD/MM/YY
  const parts = dateString.split('/');
  if (parts.length !== 3) return null;
  
  const day = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1; // Month is 0-indexed
  let year = parseInt(parts[2]);
  
  // Handle 2-digit years (assume 2000-2099)
  if (year < 100) {
    year += 2000;
  }
  
  const date = new Date(year, month, day);
  
  // Validate date
  if (isNaN(date.getTime())) return null;
  
  return date;
}

/**
 * Check if date is in the future
 */
export function isFutureDate(dateString) {
  const date = parseDate(dateString);
  if (!date) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  
  return date > today;
}

/**
 * Check if date is today
 */
export function isToday(dateString) {
  const date = parseDate(dateString);
  if (!date) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  
  return date.getTime() === today.getTime();
}

/**
 * Format date for display
 */
export function formatDate(dateString) {
  const date = parseDate(dateString);
  if (!date) return dateString;
  
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Calculate days until delivery date
 * Returns number of days between today and delivery date
 */
export function daysUntilDelivery(dateString) {
  const deliveryDate = parseDate(dateString);
  if (!deliveryDate) return null;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  deliveryDate.setHours(0, 0, 0, 0);
  
  // Calculate difference in milliseconds, then convert to days
  const diffTime = deliveryDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}
