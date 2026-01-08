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

/**
 * Get today's date in Asia/Jakarta timezone (date-only, YYYY-MM-DD)
 * @param {Date} now - Optional Date object (defaults to current time)
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getTodayJakarta(now = new Date()) {
  // Format date in Asia/Jakarta timezone using Intl API
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  // Format returns YYYY-MM-DD directly
  return formatter.format(now);
}

/**
 * Get days difference between event_date and today in Asia/Jakarta timezone
 * Returns integer day difference: event_date - today_date
 * 
 * @param {string} eventDateISO - Event date in YYYY-MM-DD format
 * @param {Date} now - Optional Date object (defaults to current time)
 * @returns {number|null} Days difference (positive = future, negative = past), or null if invalid
 */
export function getDaysDiffJakarta(eventDateISO, now = new Date()) {
  if (!eventDateISO || typeof eventDateISO !== 'string') {
    return null;
  }
  
  // Parse event_date (should be YYYY-MM-DD)
  const eventDateMatch = eventDateISO.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!eventDateMatch) {
    console.warn(`[getDaysDiffJakarta] Invalid event_date format: ${eventDateISO}`);
    return null;
  }
  
  const eventYear = parseInt(eventDateMatch[1], 10);
  const eventMonth = parseInt(eventDateMatch[2], 10) - 1; // Month is 0-indexed
  const eventDay = parseInt(eventDateMatch[3], 10);
  
  // Get today's date in Asia/Jakarta
  const todayStr = getTodayJakarta(now);
  const todayMatch = todayStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!todayMatch) {
    console.error(`[getDaysDiffJakarta] Failed to parse today's date: ${todayStr}`);
    return null;
  }
  
  const todayYear = parseInt(todayMatch[1], 10);
  const todayMonth = parseInt(todayMatch[2], 10) - 1;
  const todayDay = parseInt(todayMatch[3], 10);
  
  // Create date objects (date-only, no time)
  const eventDate = new Date(eventYear, eventMonth, eventDay);
  const todayDate = new Date(todayYear, todayMonth, todayDay);
  
  // Validate dates
  if (isNaN(eventDate.getTime()) || isNaN(todayDate.getTime())) {
    console.warn(`[getDaysDiffJakarta] Invalid date: event=${eventDateISO}, today=${todayStr}`);
    return null;
  }
  
  // Calculate difference in whole days
  const diffTime = eventDate.getTime() - todayDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

/**
 * Normalize any date value to ISO date string (YYYY-MM-DD) in Asia/Jakarta timezone
 * Handles multiple input formats:
 * - YYYY-MM-DD (already ISO)
 * - DD/MM/YYYY
 * - Google Sheets serial numbers
 * - ISO strings with time
 * - Date objects
 * 
 * @param {string|number|Date} value - Date value in various formats
 * @returns {string|null} Normalized date in YYYY-MM-DD format (Asia/Jakarta), or null if invalid
 */
export function toISODateJakarta(value) {
  if (!value && value !== 0) {
    return null;
  }
  
  // Handle Google Sheets serial numbers (numeric)
  if (typeof value === 'number') {
    // Google Sheets epoch is 1899-12-30, JavaScript epoch is 1970-01-01
    // Offset: 25569 days difference
    const sheetsEpochOffset = 25569;
    const jsTimestamp = (value - sheetsEpochOffset) * 86400 * 1000;
    const date = new Date(jsTimestamp);
    if (isNaN(date.getTime())) {
      return null;
    }
    // Format in Asia/Jakarta timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  }
  
  // Handle Date objects
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      return null;
    }
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(value);
  }
  
  // Handle strings
  if (typeof value !== 'string') {
    return null;
  }
  
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  
  // Already in YYYY-MM-DD format - return as-is (NO timezone conversion)
  // This is critical: ISO date strings should NOT be converted via new Date()
  // which can shift days due to timezone differences
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  
  // Handle DD/MM/YYYY format
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/').map(p => p.trim());
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      let year = parseInt(parts[2], 10);
      
      // Handle 2-digit years
      if (year < 100) {
        year += 2000;
      }
      
      // Validate
      if (isNaN(day) || isNaN(month) || isNaN(year) || day < 1 || day > 31 || month < 1 || month > 12) {
        return null;
      }
      
      // Format as YYYY-MM-DD
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  
  // Try parsing as ISO string (may include time)
  if (trimmed.includes('T') || trimmed.includes(' ')) {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return formatter.format(date);
    }
  }
  
  // Try standard Date parsing as last resort
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  }
  
  return null;
}

/**
 * Get today's date in Asia/Jakarta timezone as ISO string (YYYY-MM-DD)
 * @param {Date} now - Optional Date object (defaults to current time)
 * @returns {string} Today's date in YYYY-MM-DD format
 */
export function getJakartaTodayISO(now = new Date()) {
  return getTodayJakarta(now);
}

/**
 * Add days to a date in Asia/Jakarta timezone
 * @param {string} dateISO - Date in YYYY-MM-DD format
 * @param {number} days - Number of days to add (can be negative)
 * @returns {string|null} Result date in YYYY-MM-DD format, or null if invalid
 */
export function addDaysJakarta(dateISO, days) {
  if (!dateISO || typeof dateISO !== 'string') {
    return null;
  }
  
  const match = dateISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // Month is 0-indexed
  const day = parseInt(match[3], 10);
  
  // Create date in UTC to avoid timezone issues when adding days
  // Then format back in Asia/Jakarta
  const date = new Date(Date.UTC(year, month, day));
  if (isNaN(date.getTime())) {
    return null;
  }
  
  // Add days
  date.setUTCDate(date.getUTCDate() + days);
  
  // Format in Asia/Jakarta timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}
