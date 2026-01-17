/**
 * Price Calculator
 * Calculates order totals from parsed items using price list
 */

import { daysUntilDelivery, getDaysDiffJakarta } from '../utils/date-utils.js';
import { calculateMinDP } from './payment-tracker.js';
import { formatPrice, escapeMarkdown } from '../utils/formatting.js';
import { THANK_YOU_TRUST, PAYMENT_DP_REQUIRED, PAYMENT_FULL_REQUIRED } from '../utils/messages.js';

/**
 * Parse item name to extract base item and toppings
 * Examples:
 * - "Dawet Medium + Nangka" → { base: "Dawet Kemayu Medium", toppings: ["Topping Nangka"] }
 * - "Dawet Medium + Nangka + Durian" → { base: "Dawet Kemayu Medium", toppings: ["Topping Nangka", "Topping Durian"] }
 * - "Dawet Medium Original" → { base: "Dawet Kemayu Medium", toppings: [] }
 */
export function parseItemName(itemName) {
  const cleanName = itemName.trim();
  const nameLower = cleanName.toLowerCase();
  
  // Normalize "toping" -> "topping" typo
  const normalizedName = nameLower.replace(/\btoping\b/g, 'topping');
  
  // Check if it contains "+" (has toppings separated by +)
  if (cleanName.includes('+')) {
    const parts = cleanName.split('+').map(p => p.trim());
    const basePart = parts[0];
    const toppings = parts.slice(1).map(t => t.trim());
    
    // Normalize base item name
    let baseItem = normalizeBaseItemName(basePart);
    
    // Normalize topping names
    const normalizedToppings = toppings.map(topping => {
      const lower = topping.toLowerCase().trim().replace(/\btoping\b/g, 'topping');
      if (lower.includes('durian')) {
        return 'Topping Durian';
      } else if (lower.includes('nangka')) {
        return 'Topping Nangka';
      }
      // Capitalize first letter for consistency
      const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
      return `Topping ${capitalized}`;
    });
    
    return {
      base: baseItem,
      toppings: normalizedToppings,
    };
  }
  
  // Check if item name contains topping keywords (e.g., "Dawet Kemayu Large Toping Nangka")
  // Extract base and topping from single string
  const toppingKeywords = ['topping', 'toping', 'nangka', 'durian'];
  const hasToppingKeyword = toppingKeywords.some(keyword => normalizedName.includes(keyword));
  
  if (hasToppingKeyword) {
    // Extract size and normalize base
    let baseItem = normalizeBaseItemName(cleanName);
    
    // Extract topping from the name
    const toppings = [];
    if (normalizedName.includes('nangka')) {
      toppings.push('Topping Nangka');
    }
    if (normalizedName.includes('durian')) {
      toppings.push('Topping Durian');
    }
    
    return {
      base: baseItem,
      toppings: toppings,
    };
  }
  
  // No toppings, just normalize the base item
  const normalizedBase = normalizeBaseItemName(cleanName);
  
  return {
    base: normalizedBase,
    toppings: [],
  };
}

/**
 * Normalize base item name (extract size and format consistently)
 * @param {string} itemName - Item name to normalize
 * @returns {string} Normalized base item name (e.g., "Dawet Kemayu Large")
 */
function normalizeBaseItemName(itemName) {
  const nameLower = itemName.toLowerCase().trim();
  
  // Extract size if present
  const sizeMatch = nameLower.match(/(small|medium|large)/i);
  if (sizeMatch) {
    const size = sizeMatch[1].toLowerCase();
    return `Dawet Kemayu ${size.charAt(0).toUpperCase() + size.slice(1)}`;
  }
  
  if (nameLower.match(/dawet\s+medium\s+original/i)) {
    return 'Dawet Kemayu Medium';
  }
  
  if (nameLower.includes('dawet')) {
    // Handle cases where size might be in the full name
    if (nameLower.includes('large')) {
      return 'Dawet Kemayu Large';
    } else if (nameLower.includes('medium')) {
      return 'Dawet Kemayu Medium';
    } else if (nameLower.includes('small')) {
      return 'Dawet Kemayu Small';
    }
  }
  
  // Return as-is if no pattern matches
  return itemName;
}

/**
 * Normalize product name for price lookup
 * Handles typos, spacing, casing, and common variations
 * @param {string} name - Product name to normalize
 * @returns {string} Normalized product name
 */
export function normalizeProductName(name) {
  if (!name || typeof name !== 'string') {
    return '';
  }
  
  let normalized = name
    .trim()
    .toLowerCase()
    .replace(/^[-•]\s*/, '') // Remove leading bullet
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .replace(/[^\w\s+]/g, '') // Remove punctuation (keep + for toppings)
    .trim();
  
  // Standardize common typos/variants
  normalized = normalized
    .replace(/\btoping\b/g, 'topping') // "toping" -> "topping"
    .replace(/\btopping\b/g, 'topping'); // Ensure consistent
  
  return normalized;
}

/**
 * Get unit price from PriceList with improved matching
 * Uses normalization and fuzzy matching for better price lookup
 * @param {string} itemName - Item name to look up
 * @param {Object} priceList - Price list object (key: product name, value: price)
 * @returns {number|null} Unit price, or null if not found
 */
export function getUnitPriceFromPriceList(itemName, priceList) {
  if (!itemName || !priceList || typeof priceList !== 'object') {
    return null;
  }
  
  const normalizedItemName = normalizeProductName(itemName);
  console.log(`🔍 [PRICE] Looking up price for item: "${itemName}" (normalized: "${normalizedItemName}")`);
  
  // Strategy A: Exact match on normalized name
  for (const [priceListKey, price] of Object.entries(priceList)) {
    const normalizedKey = normalizeProductName(priceListKey);
    if (normalizedKey === normalizedItemName) {

      return price;
    }
  }
  
  // Strategy B: Fuzzy match (contains/includes) for known patterns
  // Check if item contains key components (dawet, size, topping)
  const itemParts = normalizedItemName.split(/\s+/);
  const hasDawet = itemParts.some(p => p.includes('dawet'));
  const hasSize = itemParts.some(p => ['small', 'medium', 'large'].includes(p));
  const hasTopping = itemParts.some(p => ['nangka', 'durian', 'topping'].includes(p));
  
  if (hasDawet && hasSize) {
    // Try to match base product + topping
    for (const [priceListKey, price] of Object.entries(priceList)) {
      const normalizedKey = normalizeProductName(priceListKey);
      
      // Check if all key parts match
      let matches = true;
      if (hasSize) {
        const sizeMatch = itemParts.find(p => ['small', 'medium', 'large'].includes(p));
        if (sizeMatch && !normalizedKey.includes(sizeMatch)) {
          matches = false;
        }
      }
      if (hasTopping) {
        const toppingMatch = itemParts.find(p => ['nangka', 'durian'].includes(p));
        if (toppingMatch && !normalizedKey.includes(toppingMatch)) {
          matches = false;
        }
      }
      
      if (matches && normalizedKey.includes('dawet')) {

        return price;
      }
    }
  }
  
  // Strategy C: Try parsing item name (for items with toppings)
  try {
    const parsed = parseItemName(itemName);
    if (parsed.base) {
      const basePrice = priceList[parsed.base] || null;
      if (basePrice) {

        // Add topping prices if any
        let totalPrice = basePrice;
        for (const topping of parsed.toppings) {
          const toppingPrice = priceList[topping] || 0;
          if (toppingPrice > 0) {

            totalPrice += toppingPrice;
          }
        }
        return totalPrice;
      }
    }
  } catch (error) {
    // Parsing failed, continue to return null
    console.warn(`⚠️ [PRICE] Parsing failed for "${itemName}":`, error.message);
  }
  
  console.warn(`⚠️ [PRICE] Not found for: "${normalizedItemName}" (original: "${itemName}")`);
  return null;
}

/**
 * Calculate total price for an order
 */
export function calculateOrderTotal(items, priceList) {
  let subtotal = 0;
  const itemDetails = [];
  
  // Ensure items is an array (parse JSON string if needed)
  let itemsArray = items;
  if (typeof items === 'string') {
    try {
      itemsArray = JSON.parse(items);
    } catch (e) {
      console.error(`❌ [CALCULATE_TOTAL] Failed to parse items JSON:`, e.message);
      itemsArray = [];
    }
  }
  if (!Array.isArray(itemsArray)) {
    console.error(`❌ [CALCULATE_TOTAL] items is not an array:`, typeof itemsArray, itemsArray);
    itemsArray = [];
  }
  
  for (const item of itemsArray) {

    // Use improved price lookup with normalization
    let unitPrice = getUnitPriceFromPriceList(item.name, priceList);
    let parsed = null;
    let toppingPrices = [];
    
    // If not found via improved lookup, try direct lookup and parsing as fallback
    if (unitPrice === null) {
      // Fallback: Check if item name exists directly in price list
      unitPrice = priceList[item.name] || null;
      
      // If still not found, try parsing (for items with toppings like "Dawet Medium + Nangka")
      if (unitPrice === null) {
        parsed = parseItemName(item.name);
        const basePrice = priceList[parsed.base] || null;
        
        if (basePrice !== null) {
          unitPrice = basePrice;
          
          // Add topping prices
          toppingPrices = parsed.toppings.map(topping => {
            const toppingPrice = priceList[topping] || 0;
            if (toppingPrice > 0) {

            }
            return toppingPrice;
          });
          
          // Add topping prices to unit price
          const toppingsTotal = toppingPrices.reduce((sum, price) => sum + price, 0);
          unitPrice += toppingsTotal;
        }
      }
    }
    
    // Calculate item total
    let itemTotal = 0;
    if (unitPrice !== null && unitPrice > 0) {
      itemTotal = unitPrice * item.quantity;

    } else {
      console.warn(`⚠️ [PRICE] Price not found for item: "${item.name}" - will show "Harga belum tersedia"`);
    }
    
    subtotal += itemTotal;
    
    itemDetails.push({
      name: item.name,
      quantity: item.quantity,
      basePrice: unitPrice || 0, // 0 if not found (will show "Harga belum tersedia")
      toppings: parsed ? parsed.toppings : [],
      toppingPrices: toppingPrices,
      itemTotal: itemTotal,
      priceFound: unitPrice !== null && unitPrice > 0, // Flag to indicate if price was found
    });
  }
  
  return {
    subtotal: subtotal,
    itemDetails: itemDetails,
  };
}

/**
 * Normalize delivery time to HH:MM format for storage
 * Accepts various input formats and always outputs HH:MM (24-hour)
 * @param {string} timeStr - Time string in various formats
 * @returns {string} Normalized time in HH:MM format
 * @throws {Error} If time is invalid or cannot be parsed
 */
export function normalizeDeliveryTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    throw new Error(`Invalid delivery_time input: ${timeStr}`);
  }
  
  const trimmed = timeStr.trim();
  if (!trimmed) {
    throw new Error('Empty delivery_time string');
  }
  
  // Step 1: Remove markdown formatting (asterisks, bold, etc.)
  let cleaned = trimmed
    .replace(/\*+/g, '') // Remove asterisks
    .replace(/_+/g, '') // Remove underscores
    .replace(/~+/g, '') // Remove tildes
    .trim();
  
  // Step 2: Remove common timezone suffixes (WIB, WITA, WIT, etc.)
  cleaned = cleaned
    .replace(/\s*(WIB|WITA|WIT|AM|PM|am|pm)\s*$/i, '')
    .trim();
  
  // Step 3: Extract time pattern using regex (more flexible - finds time anywhere in string)
  // Look for patterns like: HH:MM, H:MM, HH.MM, H.MM, or single digits
  // This handles cases like "*Kirim dari outlet: 10.45 WIB*" by finding "10.45" anywhere
  
  let hours, minutes;
  let timeMatch = null;
  
  // Strategy: Use regex to find time pattern anywhere in the string
  // This works even with complex prefixes like "Kirim dari outlet:"
  
  // Try to match HH:MM or H:MM pattern (with colon) - find anywhere in string
  timeMatch = cleaned.match(/(\d{1,2}):(\d{1,2})/);
  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10);
    minutes = parseInt(timeMatch[2], 10);
  }
  // Try to match HH.MM or H.MM pattern (with dot) - find anywhere in string
  else {
    timeMatch = cleaned.match(/(\d{1,2})\.(\d{1,2})/);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2], 10);
    }
    // Try single hour digit (e.g., "9" → "09:00") - must be last
    // Only match if it's a standalone number (not part of a larger number)
    else {
      // Match single or double digit at word boundaries or end of string
      timeMatch = cleaned.match(/\b(\d{1,2})\b(?!\.|\:)/);
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = 0;
      }
    }
  }
  
  // If still no match, throw error
  if (!timeMatch) {
    throw new Error(`Cannot parse time format: ${trimmed}`);
  }
  
  // Validate parsed values
  if (isNaN(hours) || isNaN(minutes)) {
    throw new Error(`Invalid time parts - hours: ${hours}, minutes: ${minutes} from input: ${trimmed}`);
  }
  
  // Validate ranges
  if (hours < 0 || hours > 23) {
    throw new Error(`Invalid hours: ${hours} (must be 0-23) from input: ${trimmed}`);
  }
  if (minutes < 0 || minutes > 59) {
    throw new Error(`Invalid minutes: ${minutes} (must be 0-59) from input: ${trimmed}`);
  }
  
  // Format as HH:MM
  const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  return formatted;
}

/**
 * Format time to HH:MM (remove any extra text like "kirim:", "WIB", etc.)
 * Helper function for formatting delivery time consistently across all messages
 * For display purposes (returns "-" if empty or invalid)
 */
function formatTime(timeStr) {
  // Handle empty, null, undefined, or invalid input gracefully
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.trim()) {
    return '-';
  }
  
  try {
    const normalized = normalizeDeliveryTime(timeStr);
    return normalized || '-';
  } catch (error) {
    // If normalization fails (invalid format), return "-" instead of crashing
    console.warn(`⚠️ [FORMAT_TIME] Failed to normalize delivery_time "${timeStr}":`, error.message);
    return '-';
  }
}

/**
 * Format invoice message
 */

/**
 * Generate recap message with H-4 threshold logic
 * @param {Object} order - Order object
 * @param {Object} priceList - Price list
 * @param {Object} options - Options: { todayDateOverride?: Date }
 * @returns {string} Formatted invoice/recap message
 */
export function formatInvoice(order, priceList, options = {}) {
  const { todayDateOverride } = options;
  
  // Calculate days difference to determine template
  let daysDiff = null;
  if (order.event_date) {
    daysDiff = getDaysDiffJakarta(order.event_date, todayDateOverride);

  }
  
  // Choose template: FULL PAYMENT if days_diff <= 4 (includes H-4), DP if days_diff > 4
  // H-4 (daysDiff === 4) requires full payment, so use full payment format
  const useFullPaymentFormat = daysDiff !== null && daysDiff <= 4;
  
  if (useFullPaymentFormat) {
    return formatFullPaymentRecap(order, priceList);
  } else {
    return formatDPRecap(order, priceList);
  }
}

/**
 * Format FULL PAYMENT recap (for orders within H-4)
 * No DP section, only one note line
 */
function formatFullPaymentRecap(order, priceList) {
  const calculation = calculateOrderTotal(order.items, priceList);
  
  // Helper to format empty fields as "-"
  const formatField = (value) => value || '-';
  
  // Get invoice number (order ID)
  const invoiceNumber = order.id || 'N/A';
  
  // Get customer info
  const namaPemesan = order.customer_name || '-';
  const namaPenerima = order.receiver_name || order.customer_name || '-';
  const noHp = formatField(order.phone_number);
  const alamat = formatField(order.address);
  
  // Get event info
  const namaEvent = formatField(order.event_name);
  const tanggalEvent = formatField(order.event_date);
  const waktuKirim = formatTime(order.delivery_time);
  
  // Calculate totals
  const subtotal = calculation.subtotal;
  
  // Use packaging_fee from order and calculate packaging boxes
  let packagingPrice = 0;
  let packagingFound = false;
  let packagingBoxes = 0;
  
  if (order.packaging_fee !== undefined && order.packaging_fee !== null) {
    packagingPrice = parseFloat(order.packaging_fee) || 0;
    packagingFound = packagingPrice > 0;
    // Calculate boxes from price (1 box = 40,000)
    packagingBoxes = packagingFound ? Math.ceil(packagingPrice / 40000) : 0;
  } else {
    const packagingItem = calculation.itemDetails.find(detail => 
      detail.name.toLowerCase().includes('packaging') || 
      detail.name.toLowerCase().includes('styrofoam')
    );
    if (packagingItem) {
      packagingPrice = packagingItem.itemTotal;
      packagingFound = true;
      packagingBoxes = packagingItem.quantity || Math.ceil(packagingPrice / 40000);
    }
  }
  
  // If packaging found but boxes not calculated, calculate from total cups
  if (packagingFound && packagingBoxes === 0) {
    let totalCups = 0;
    (order.items || []).forEach(item => {
      const itemName = (item.name || '').toLowerCase();
      if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
        return; // Skip packaging items
      }
      if (itemName.includes('dawet') && 
          (itemName.includes('small') || itemName.includes('medium') || itemName.includes('large')) &&
          !itemName.includes('botol')) {
        totalCups += parseInt(item.quantity || 0);
      }
    });
    packagingBoxes = totalCups > 0 ? Math.ceil(totalCups / 50) : 1;
  }
  
  // Parse delivery_fee
  let shippingPrice = 0;
  const deliveryFeeSource = order.delivery_fee_source || 'NOT_PROVIDED';
  const rawDeliveryFee = order.delivery_fee;
  
  if (rawDeliveryFee !== undefined && rawDeliveryFee !== null && rawDeliveryFee !== '') {
    const parsedFee = typeof rawDeliveryFee === 'number' ? rawDeliveryFee : parseFloat(rawDeliveryFee);
    if (!isNaN(parsedFee) && parsedFee >= 0) {
      shippingPrice = parsedFee;
    }
  }

  order._delivery_fee_source = deliveryFeeSource;
  const totalAmount = order.total_amount || order.final_total || subtotal + packagingPrice + shippingPrice;
  // Use delivery_method (stored in Orders.delivery_method) with fallback for backward compatibility
  const pengiriman = order.delivery_method || order.shipping_method || '-';

  // Build item list
  let itemList = '';
  calculation.itemDetails.forEach((detail) => {
    if (packagingFound && (detail.name.toLowerCase().includes('packaging') || 
        detail.name.toLowerCase().includes('styrofoam'))) {
      return;
    }
    
    if (detail.priceFound && detail.itemTotal > 0) {
      itemList += `${detail.quantity}x ${detail.name}: Rp${formatPrice(detail.itemTotal)}\n`;
    } else {
      itemList += `${detail.quantity}x ${detail.name}: Harga belum tersedia\n`;
      console.warn(`⚠️ [INVOICE] Item "${detail.name}" has no price - showing "Harga belum tersedia"`);
    }
  });
  
  if (!itemList.trim()) {
    itemList = '-';
  }
  
  // Build FULL PAYMENT invoice (no DP section)
  let invoice = `🧾 REKAP PESANAN & PEMBAYARAN\n`;
  invoice += `Dawet Kemayu Menteng 🌿\n\n`;
  invoice += `Nomor Invoice:\n\`${invoiceNumber}\`\n\n`;
  invoice += `--------------------------------\n`;
  invoice += `👤 INFORMASI PEMESAN\n`;
  invoice += `Nama Pemesan: ${namaPemesan}\n`;
  invoice += `Nama Penerima: ${namaPenerima}\n`;
  invoice += `No HP Penerima: ${noHp}\n`;
  invoice += `Alamat Pengiriman:\n${alamat}\n\n`;
  invoice += `--------------------------------\n`;
  invoice += `🎉 DETAIL EVENT\n`;
  invoice += `Nama Event: ${namaEvent}\n`;
  invoice += `Tanggal Event: ${tanggalEvent}\n`;
  invoice += `Waktu Kirim: ${waktuKirim}\n\n`;
  invoice += `--------------------------------\n`;
  invoice += `Pesanan:\n${itemList}`;
  
  if (packagingFound && packagingBoxes > 0) {
    invoice += `${packagingBoxes}x Packaging Styrofoam: Rp${formatPrice(packagingPrice)}\n`;
  }
  
  // Display delivery_method (never "-" if provided)
  const displayPengiriman = pengiriman && pengiriman !== '-' ? pengiriman : '-';
  invoice += `\nPengiriman: ${displayPengiriman}\n`;
  
  if (shippingPrice > 0) {
    invoice += `Ongkir: Rp${formatPrice(shippingPrice)}\n\n`;
  } else if (deliveryFeeSource === 'NOT_PROVIDED') {
    invoice += `Ongkir: -\n\n`;
  } else {
    invoice += `Ongkir: -\n\n`;
  }
  invoice += `--------------------------------\n`;
  invoice += `TOTAL PEMBAYARAN:\n`;
  invoice += `Rp${formatPrice(totalAmount)}\n\n`;
  invoice += `--------------------------------\n`;
  invoice += `🏦 PEMBAYARAN TRANSFER BANK\n`;
  invoice += `Bank Jago\n`;
  invoice += `No. Rekening: 102730840011\n`;
  invoice += `a.n. Septina Eka Kartika Dewi\n\n`;
  invoice += `--------------------------------\n`;
  invoice += `Catatan:\n`;
  invoice += `• Silahkan lakukan pembayaran penuh untuk melanjutkan proses pesanan Anda\n\n`;
  invoice += `--------------------------------\n`;
  invoice += THANK_YOU_TRUST;
  
  return invoice;
}

/**
 * Format DP recap (for orders farther than H-4)
 * Includes DP section and pelunasan rules
 */
function formatDPRecap(order, priceList) {
  const calculation = calculateOrderTotal(order.items, priceList);
  
  // Helper to format empty fields as "-"
  const formatField = (value) => value || '-';
  
  // Get invoice number (order ID)
  const invoiceNumber = order.id || 'N/A';
  
  // Get customer info
  const namaPemesan = order.customer_name || '-';
  const namaPenerima = order.receiver_name || order.customer_name || '-';
  const noHp = formatField(order.phone_number);
  const alamat = formatField(order.address);
  
  // Get event info
  const namaEvent = formatField(order.event_name);
  const tanggalEvent = formatField(order.event_date);
  const waktuKirim = formatTime(order.delivery_time);
  
  // Calculate totals
  const subtotal = calculation.subtotal;
  
  // Use packaging_fee from order and calculate packaging boxes
  let packagingPrice = 0;
  let packagingFound = false;
  let packagingBoxes = 0;
  
  if (order.packaging_fee !== undefined && order.packaging_fee !== null) {
    packagingPrice = parseFloat(order.packaging_fee) || 0;
    packagingFound = packagingPrice > 0;
    // Calculate boxes from price (1 box = 40,000)
    packagingBoxes = packagingFound ? Math.ceil(packagingPrice / 40000) : 0;
  } else {
    const packagingItem = calculation.itemDetails.find(detail => 
      detail.name.toLowerCase().includes('packaging') || 
      detail.name.toLowerCase().includes('styrofoam')
    );
    if (packagingItem) {
      packagingPrice = packagingItem.itemTotal;
      packagingFound = true;
      packagingBoxes = packagingItem.quantity || Math.ceil(packagingPrice / 40000);
    }
  }
  
  // If packaging found but boxes not calculated, calculate from total cups
  if (packagingFound && packagingBoxes === 0) {
    let totalCups = 0;
    (order.items || []).forEach(item => {
      const itemName = (item.name || '').toLowerCase();
      if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
        return; // Skip packaging items
      }
      if (itemName.includes('dawet') && 
          (itemName.includes('small') || itemName.includes('medium') || itemName.includes('large')) &&
          !itemName.includes('botol')) {
        totalCups += parseInt(item.quantity || 0);
      }
    });
    packagingBoxes = totalCups > 0 ? Math.ceil(totalCups / 50) : 1;
  }
  
  // Parse delivery_fee
  let shippingPrice = 0;
  const deliveryFeeSource = order.delivery_fee_source || 'NOT_PROVIDED';
  const rawDeliveryFee = order.delivery_fee;
  
  if (rawDeliveryFee !== undefined && rawDeliveryFee !== null && rawDeliveryFee !== '') {
    const parsedFee = typeof rawDeliveryFee === 'number' ? rawDeliveryFee : parseFloat(rawDeliveryFee);
    if (!isNaN(parsedFee) && parsedFee >= 0) {
      shippingPrice = parsedFee;
    }
  }

  order._delivery_fee_source = deliveryFeeSource;
  const totalAmount = order.total_amount || order.final_total || subtotal + packagingPrice + shippingPrice;
  const dpMinimum = calculateMinDP(totalAmount);
  // Use delivery_method (stored in Orders.delivery_method) with fallback for backward compatibility
  const pengiriman = order.delivery_method || order.shipping_method || '-';

  // Build item list
  let itemList = '';
  calculation.itemDetails.forEach((detail) => {
    if (packagingFound && (detail.name.toLowerCase().includes('packaging') || 
        detail.name.toLowerCase().includes('styrofoam'))) {
      return;
    }
    
    if (detail.priceFound && detail.itemTotal > 0) {
      itemList += `${detail.quantity}x ${detail.name}: Rp${formatPrice(detail.itemTotal)}\n`;
    } else {
      itemList += `${detail.quantity}x ${detail.name}: Harga belum tersedia\n`;
      console.warn(`⚠️ [INVOICE] Item "${detail.name}" has no price - showing "Harga belum tersedia"`);
    }
  });
  
  if (!itemList.trim()) {
    itemList = '-';
  }
  
  // Build DP invoice (with DP section)
  let invoice = `🧾 REKAP PESANAN & PEMBAYARAN\n`;
  invoice += `Dawet Kemayu Menteng 🌿\n\n`;
  invoice += `Nomor Invoice:\n\`${invoiceNumber}\`\n\n`;
  invoice += `--------------------------------\n`;
  invoice += `👤 INFORMASI PEMESAN\n`;
  invoice += `Nama Pemesan: ${namaPemesan}\n`;
  invoice += `Nama Penerima: ${namaPenerima}\n`;
  invoice += `No HP Penerima: ${noHp}\n`;
  invoice += `Alamat Pengiriman:\n${alamat}\n\n`;
  invoice += `--------------------------------\n`;
  invoice += `🎉 DETAIL EVENT\n`;
  invoice += `Nama Event: ${namaEvent}\n`;
  invoice += `Tanggal Event: ${tanggalEvent}\n`;
  invoice += `Waktu Kirim: ${waktuKirim}\n\n`;
  invoice += `--------------------------------\n`;
  invoice += `Pesanan:\n${itemList}`;
  
  if (packagingFound && packagingBoxes > 0) {
    invoice += `${packagingBoxes}x Packaging Styrofoam: Rp${formatPrice(packagingPrice)}\n`;
  }
  
  // Display delivery_method (never "-" if provided)
  const displayPengiriman = pengiriman && pengiriman !== '-' ? pengiriman : '-';
  invoice += `\nPengiriman: ${displayPengiriman}\n`;
  
  if (shippingPrice > 0) {
    invoice += `Ongkir: Rp${formatPrice(shippingPrice)}\n\n`;
  } else if (deliveryFeeSource === 'NOT_PROVIDED') {
    invoice += `Ongkir: -\n\n`;
  } else {
    invoice += `Ongkir: -\n\n`;
  }
  invoice += `--------------------------------\n`;
  invoice += `TOTAL PEMBAYARAN:\n`;
  invoice += `Rp${formatPrice(totalAmount)}\n\n`;
  invoice += `Minimal DP (50%):\n`;
  invoice += `Rp${formatPrice(dpMinimum)}\n\n`;
  invoice += `--------------------------------\n`;
  invoice += `🏦 PEMBAYARAN TRANSFER BANK\n`;
  invoice += `Bank Jago\n`;
  invoice += `No. Rekening: 102730840011\n`;
  invoice += `a.n. Septina Eka Kartika Dewi\n\n`;
  invoice += `--------------------------------\n`;
  invoice += `Catatan:\n`;
  invoice += `• Silahkan lakukan pembayaran untuk melanjutkan proses pesanan Anda\n`;
  invoice += `• DP minimal 50% dari total pesanan\n`;
  invoice += `• Pelunasan maksimal H-4 sebelum pengiriman\n\n`;
  invoice += `--------------------------------\n`;
  invoice += THANK_YOU_TRUST;
  
  return invoice;
}

/**
 * Separate items from notes by checking price list
 * If a note matches an item in the price list, treat it as an item (quantity 1)
 */
export function separateItemsFromNotes(items, notes, priceList) {
  const finalItems = [...items];
  const finalNotes = [];
  
  // Check each note against price list
  for (const note of notes) {
    const noteLower = note.toLowerCase().trim();
    let found = false;
    
    // Try to find match in price list (case-insensitive)
    for (const priceListKey of Object.keys(priceList)) {
      const keyLower = priceListKey.toLowerCase().trim();
      
      // Exact match (case-insensitive)
      if (keyLower === noteLower) {
        finalItems.push({
          quantity: 1,
          name: priceListKey, // Use the exact name from price list
        });
        console.log(`📦 Moved "${note}" from notes to items (exact match: "${priceListKey}")`);
        found = true;
        break;
      }
      
      // Smart partial match - normalize both strings for comparison
      // Remove common words and compare remaining words
      const normalize = (str) => {
        return str
          .toLowerCase()
          .replace(/\s+/g, ' ') // Normalize spaces
          .trim();
      };
      
      const normalizedNote = normalize(note);
      const normalizedKey = normalize(priceListKey);
      
      // Check if normalized strings are similar (one contains the other or vice versa)
      if (normalizedNote === normalizedKey || 
          normalizedNote.includes(normalizedKey) || 
          normalizedKey.includes(normalizedNote)) {
        // Additional check: make sure all significant words match
        const noteWords = normalizedNote.split(/\s+/).filter(w => w.length > 2);
        const keyWords = normalizedKey.split(/\s+/).filter(w => w.length > 2);
        
        // If most words match, consider it a match
        const matchingWords = noteWords.filter(w => keyWords.includes(w));
        const matchRatio = matchingWords.length / Math.max(noteWords.length, keyWords.length);
        
        if (matchRatio >= 0.6 || matchingWords.length >= 2) {
          finalItems.push({
            quantity: 1,
            name: priceListKey,
          });
          console.log(`📦 Moved "${note}" from notes to items (match: "${priceListKey}")`);
          found = true;
          break;
        }
      }
    }
    
    if (!found) {
      // Keep as note
      finalNotes.push(note);
      console.log(`📝 Keeping "${note}" as note (not found in price list)`);
    }
  }
  
  return {
    items: finalItems,
    notes: finalNotes,
  };
}

/**
 * Format price with thousand separators
 */
// formatPrice is now imported from formatting.js

/**
 * Format payment notification message based on delivery date
 * - If delivery date is more than 3 days away: 50% down payment
 * - If delivery date is 3 days or less: full payment
 */
export function formatPaymentNotification(order, totalAmount) {
  let daysUntil = null;
  
  if (order.event_date) {
    // Parse date manually to avoid circular dependency
    const parts = order.event_date.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      let year = parseInt(parts[2]);
      if (year < 100) year += 2000;
      
      const deliveryDate = new Date(year, month, day);
      deliveryDate.setHours(0, 0, 0, 0);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (!isNaN(deliveryDate.getTime())) {
        const diffTime = deliveryDate.getTime() - today.getTime();
        daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }
    }
  }
  
  if (!order.event_date || daysUntil === null) {
    // No delivery date or invalid date, ask for full payment
    return formatFullPaymentMessage(order, totalAmount);
  }
  
  if (daysUntil > 3) {
    // More than 3 days away - 50% down payment
    const downPayment = Math.ceil(totalAmount * 0.5);
    return formatDownPaymentMessage(order, totalAmount, downPayment, daysUntil);
  } else {
    // 3 days or less - full payment
    return formatFullPaymentMessage(order, totalAmount, daysUntil);
  }
}

// escapeMarkdownText is now imported from formatting.js (as escapeMarkdown)

/**
 * Format down payment message (50%)
 */
function formatDownPaymentMessage(order, totalAmount, downPayment, daysUntil) {
  // Escape user-provided data to prevent markdown parsing errors
  const orderId = escapeMarkdown(order.id || 'N/A');
  const customerName = escapeMarkdown(order.customer_name || 'N/A');
  // Do NOT escape date - dates in YYYY-MM-DD format are safe in Telegram Markdown
  const eventDate = order.event_date || '-';
  const deliveryTime = formatTime(order.delivery_time);

  let message = `💰 **PEMBAYARAN DP (Down Payment)**\n\n`;
  message += `📋 **Order ID:** \`${orderId}\`\n`;
  message += `👤 **Customer:** ${customerName}\n`;
  message += `📅 **Tanggal Pengiriman:** ${eventDate}\n`;
  message += `Waktu Kirim: ${deliveryTime}\n\n`;
  message += `Karena tanggal pengiriman lebih dari 3 hari (${daysUntil} hari lagi), mohon melakukan pembayaran DP (Down Payment) sebesar **50%** dari total pesanan.\n\n`;
  message += `💵 **Total Pesanan:** Rp ${formatPrice(totalAmount)}\n`;
  message += `💳 **DP yang harus dibayar (50%):** Rp ${formatPrice(downPayment)}\n\n`;
  message += `**Metode Pembayaran:**\n`;
  message += `• QRIS\n`;
  message += `• Transfer Bank\n`;
  message += `• E-Wallet (OVO, DANA, GoPay)\n\n`;
  message += PAYMENT_DP_REQUIRED;
  
  return message;
}

/**
 * Format full payment message
 */
function formatFullPaymentMessage(order, totalAmount, daysUntil = null) {
  // Escape user-provided data to prevent markdown parsing errors
  const orderId = escapeMarkdown(order.id || 'N/A');
  const customerName = escapeMarkdown(order.customer_name || 'N/A');
  // Do NOT escape date - dates in YYYY-MM-DD format are safe in Telegram Markdown
  const eventDate = order.event_date || '-';
  const deliveryTime = formatTime(order.delivery_time);

  let message = `💰 **PEMBAYARAN PENUH**\n\n`;
  message += `📋 **Order ID:** \`${orderId}\`\n`;
  message += `👤 **Customer:** ${customerName}\n`;
  message += `📅 **Tanggal Pengiriman:** ${eventDate}\n`;
  message += `Waktu Kirim: ${deliveryTime}\n\n`;
  
  if (daysUntil !== null && daysUntil <= 3) {
    message += `Karena tanggal pengiriman ${daysUntil <= 0 ? 'sudah dekat' : `kurang dari 3 hari (${daysUntil} hari lagi)`}, mohon melakukan pembayaran penuh.\n\n`;
  } else {
    message += `Mohon melakukan pembayaran penuh untuk melanjutkan proses pesanan Anda.\n\n`;
  }
  
  message += `💵 **Total yang harus dibayar:** Rp ${formatPrice(totalAmount)}\n\n`;
  message += `**Metode Pembayaran:**\n`;
  message += `• QRIS\n`;
  message += `• Transfer Bank\n`;
  message += `• E-Wallet (OVO, DANA, GoPay)\n\n`;
  message += PAYMENT_FULL_REQUIRED;
  
  return message;
}
