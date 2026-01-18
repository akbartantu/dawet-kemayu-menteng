/**
 * Bot Menu Display
 * Shows menu items to customers when they ask for menu
 * Uses new PriceList schema: item_code, item_name, category, unit_price, unit_type, is_active
 */

import { getSheetsClient, getSpreadsheetId } from '../repos/sheets.client.js';
import { SHEET_NAMES } from './constants.js';

const PRICE_LIST_SHEET = SHEET_NAMES.PRICE_LIST;

/**
 * Format menu display message
 * Reads from new PriceList schema and displays only item_name (no duplicates)
 */
export async function formatMenuMessage() {
  try {
    const sheets = getSheetsClient();
    const SPREADSHEET_ID = getSpreadsheetId();
    
    // Read PriceList sheet with new schema
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${PRICE_LIST_SHEET}!A:F`,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return `📋 MENU DAWET KEMAYU MENTENG\n\nMenu sedang dalam proses update. Silakan hubungi admin.\n\n💡 Cara Pesan\nKirim pesanan dengan format:\nNama: [Nama Anda]\nNo hp: [Nomor HP]\nAlamat: [Alamat]\nDetail pesanan:\n- [Jumlah] x [Nama Item]\n\nKetik /help untuk contoh lengkap`;
    }

    // Detect schema by checking header row
    const headerRow = rows[0] || [];
    const hasNewSchema = headerRow[0]?.toLowerCase().includes('item_code') || 
                         headerRow[3]?.toLowerCase().includes('unit_price');
    
    if (!hasNewSchema) {
      // Fallback to old schema (2 columns)
      const { getPriceList } = await import('../repos/price-list.repo.js');
      const priceList = await getPriceList();
      return formatMenuFromPriceList(priceList);
    }

    // Parse new schema: A=item_code, B=item_name, C=category, D=unit_price, E=unit_type, F=is_active
    const menuItems = [];
    const seenItemNames = new Set(); // Track unique item names to prevent duplicates
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const itemCode = row[0]?.trim();
      const itemName = row[1]?.trim();
      const category = row[2]?.trim().toLowerCase();
      const unitPriceRaw = row[3]?.toString().trim();
      const isActive = row[5]?.toString().toUpperCase().trim();
      
      // Skip if missing required fields
      if (!itemName || !unitPriceRaw) {
        continue;
      }
      
      // Only include active items
      if (isActive && isActive !== 'TRUE' && isActive !== '1') {
        continue;
      }
      
      // Parse price
      const price = parseInt(unitPriceRaw.replace(/[.,]/g, '')) || 0;
      if (price <= 0) {
        continue;
      }
      
      // CRITICAL: Use item_name as unique key to prevent duplicates
      // If we've already seen this item_name, skip it (prevent duplicates)
      if (seenItemNames.has(itemName)) {
        console.warn(`⚠️ [MENU] Duplicate item_name skipped: "${itemName}" (item_code: "${itemCode}")`);
        continue;
      }
      seenItemNames.add(itemName);
      
      // Use item_name only (not item_code) to avoid duplicates
      menuItems.push({
        itemName: itemName,
        category: category || 'other',
        price: price,
      });
    }
    
    
    // Group by category with proper mapping
    const categoryGroups = {
      'Dawet': [],
      'Topping': [],
      'Botol': [],
      'Pack': [],
      'Minuman': [],
      'Snack': [],
    };
    
    for (const item of menuItems) {
      const categoryLower = item.category.toLowerCase();
      const itemNameLower = item.itemName.toLowerCase();
      
      // Map PriceList category to menu section
      if (categoryLower === 'minuman') {
        // Check if it's a Dawet item or other beverage
        if (itemNameLower.includes('dawet kemayu') && !itemNameLower.includes('botol')) {
          categoryGroups['Dawet'].push(item);
        } else {
          categoryGroups['Minuman'].push(item);
        }
      } else if (categoryLower === 'topping') {
        categoryGroups['Topping'].push(item);
      } else if (categoryLower === 'botol') {
        categoryGroups['Botol'].push(item);
      } else if (categoryLower === 'packaging' || categoryLower === 'paket') {
        categoryGroups['Pack'].push(item);
      } else if (categoryLower === 'snack') {
        categoryGroups['Snack'].push(item);
      } else {
        // Default: try to infer from item name
        if (itemNameLower.includes('dawet') && !itemNameLower.includes('botol')) {
          categoryGroups['Dawet'].push(item);
        } else if (itemNameLower.includes('topping')) {
          categoryGroups['Topping'].push(item);
        } else if (itemNameLower.includes('botol')) {
          categoryGroups['Botol'].push(item);
        } else if (itemNameLower.includes('pack') || itemNameLower.includes('packaging') || itemNameLower.includes('hampers')) {
          categoryGroups['Pack'].push(item);
        } else if (itemNameLower.includes('teh') || itemNameLower.includes('air mineral')) {
          categoryGroups['Minuman'].push(item);
        } else if (itemNameLower.includes('molen') || itemNameLower.includes('roti')) {
          categoryGroups['Snack'].push(item);
        } else {
          // Default to Minuman for unknown
          categoryGroups['Minuman'].push(item);
        }
      }
    }
    
    // Build menu message (NO markdown asterisks)
    let menu = `📋 MENU DAWET KEMAYU MENTENG\n\n`;
    
    // Define category order
    const categoryOrder = ['Dawet', 'Topping', 'Botol', 'Pack', 'Minuman', 'Snack'];
    
    for (const category of categoryOrder) {
      const items = categoryGroups[category];
      if (items.length > 0) {
        // Sort by price ascending, then by item name
        items.sort((a, b) => {
          if (a.price !== b.price) {
            return a.price - b.price;
          }
          return a.itemName.localeCompare(b.itemName);
        });
        
        menu += `${category}\n`;
        items.forEach(item => {
          menu += `• ${item.itemName} — Rp ${formatIDR(item.price)}\n`;
        });
        menu += `\n`;
      }
    }
    
    menu += `💡 Cara Pesan\n`;
    menu += `Kirim pesanan dengan format:\n`;
    menu += `Nama: [Nama Anda]\n`;
    menu += `No hp: [Nomor HP]\n`;
    menu += `Alamat: [Alamat]\n`;
    menu += `Detail pesanan:\n`;
    menu += `- [Jumlah] x [Nama Item]\n\n`;
    menu += `Ketik /help untuk contoh lengkap`;
    
    return menu;
  } catch (error) {
    console.error('❌ Error generating menu:', error.message);
    console.error('❌ Stack:', error.stack);
    // Fallback to simple message
    return `📋 MENU DAWET KEMAYU MENTENG\n\nMenu sedang dalam proses update. Silakan hubungi admin.\n\n💡 Cara Pesan\nKirim pesanan dengan format:\nNama: [Nama Anda]\nNo hp: [Nomor HP]\nAlamat: [Alamat]\nDetail pesanan:\n- [Jumlah] x [Nama Item]\n\nKetik /help untuk contoh lengkap`;
  }
}

/**
 * Fallback: Format menu from old price list format (2 columns)
 */
function formatMenuFromPriceList(priceList) {
  let menu = `📋 MENU DAWET KEMAYU MENTENG\n\n`;
  
  // Group items by category
  const categories = {
    'Dawet': [],
    'Topping': [],
    'Botol': [],
    'Pack': [],
    'Minuman': [],
    'Snack': [],
  };
  
  // Use a Set to track item names we've already added (avoid duplicates)
  const seenItems = new Set();
  
  // Categorize items (only add item_name, skip item_code)
  for (const [itemKey, price] of Object.entries(priceList)) {
    // CRITICAL: Skip if it's a snake_case code (item_code) - these are aliases, not display names
    // Pattern: contains underscore, no spaces, all lowercase (e.g., "dkm_small", "topping_nangka")
    const isItemCode = itemKey.includes('_') && 
                       !itemKey.includes(' ') && 
                       itemKey === itemKey.toLowerCase() &&
                       !itemKey.match(/[A-Z]/); // No uppercase letters
    
    if (isItemCode) {
      continue; // Skip item_code entries (aliases)
    }
    
    // Only process if we haven't seen this item name before (prevent duplicates)
    if (seenItems.has(itemKey)) {
      console.warn(`⚠️ [MENU_FALLBACK] Duplicate item skipped: "${itemKey}"`);
      continue;
    }
    seenItems.add(itemKey);
    
    const nameLower = itemKey.toLowerCase();
    
    if (nameLower.includes('dawet') && !nameLower.includes('botol')) {
      categories['Dawet'].push({ name: itemKey, price });
    } else if (nameLower.includes('topping')) {
      categories['Topping'].push({ name: itemKey, price });
    } else if (nameLower.includes('botol')) {
      categories['Botol'].push({ name: itemKey, price });
    } else if (nameLower.includes('pack') || nameLower.includes('packaging') || nameLower.includes('hampers')) {
      categories['Pack'].push({ name: itemKey, price });
    } else if (nameLower.includes('teh') || nameLower.includes('air mineral')) {
      categories['Minuman'].push({ name: itemKey, price });
    } else if (nameLower.includes('molen') || nameLower.includes('roti')) {
      categories['Snack'].push({ name: itemKey, price });
    }
  }
  
  // Format each category (NO markdown asterisks)
  for (const [category, items] of Object.entries(categories)) {
    if (items.length > 0) {
      // Sort by price ascending, then by name
      items.sort((a, b) => {
        if (a.price !== b.price) {
          return a.price - b.price;
        }
        return a.name.localeCompare(b.name);
      });
      
      menu += `${category}\n`;
      items.forEach(item => {
        menu += `• ${item.name} — Rp ${formatIDR(item.price)}\n`;
      });
      menu += `\n`;
    }
  }
  
  menu += `💡 Cara Pesan\n`;
  menu += `Kirim pesanan dengan format:\n`;
  menu += `Nama: [Nama Anda]\n`;
  menu += `No hp: [Nomor HP]\n`;
  menu += `Alamat: [Alamat]\n`;
  menu += `Detail pesanan:\n`;
  menu += `- [Jumlah] x [Nama Item]\n\n`;
  menu += `Ketik /help untuk contoh lengkap`;
  
  return menu;
}

/**
 * Format price as Indonesian Rupiah with thousand separators
 * @param {number} price - Price in IDR
 * @returns {string} Formatted price (e.g., "13.000")
 */
function formatIDR(price) {
  if (!price || price === 0) {
    return '0';
  }
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Check if message is asking for menu
 */
export function isMenuRequest(text) {
  const menuKeywords = [
    'menu', 'daftar', 'list', 'harga', 'price', 'apa saja',
    'ada apa', 'tersedia', 'jual', 'jualan'
  ];
  
  const textLower = text.toLowerCase();
  return menuKeywords.some(keyword => textLower.includes(keyword));
}

/**
 * Check if message is a FAQ question
 */
export function isFAQQuestion(text) {
  if (!text) return false;
  
  const textLower = text.toLowerCase().trim();
  
  // Check if this looks like an order format (contains order field labels)
  // If it does, it's NOT an FAQ question
  const orderFormatKeywords = [
    'nama pemesan', 'nama penerima', 'no hp penerima', 'alamat penerima',
    'nama event', 'durasi event', 'tanggal event', 'waktu kirim',
    'detail pesanan', 'packaging styrofoam', 'metode pengiriman',
    'biaya pengiriman', 'notes:', 'notes :'
  ];
  
  const isOrderFormat = orderFormatKeywords.some(keyword => textLower.includes(keyword));
  if (isOrderFormat) {
    return false; // This is an order, not an FAQ
  }
  
  // Check for explicit FAQ keywords (but not in order context)
  const faqKeywords = [
    'jam buka', 'jam tutup', 'buka jam', 'tutup jam',
    'ongkir', 'ongkos kirim', 'delivery', 'pengiriman',
    'bayar', 'pembayaran', 'payment', 'transfer',
    'bisa', 'boleh', 'apakah'
  ];
  
  // Location keywords - only match explicit commands
  const isLocationCommand = (
    textLower === '/lokasi' ||
    textLower === '/location' ||
    textLower === 'lokasi' ||
    textLower === 'location' ||
    (textLower.startsWith('/lokasi') && textLower.length <= 10) ||
    (textLower.startsWith('/location') && textLower.length <= 12)
  );
  
  if (isLocationCommand) {
    return true; // Explicit location command
  }
  
  // Don't match "alamat" or "dimana" if it's part of order format
  // Only match standalone location questions
  const isLocationQuestion = (
    (textLower.includes('lokasi') || textLower.includes('dimana')) &&
    !textLower.includes('alamat penerima') &&
    !textLower.includes('alamat:') &&
    textLower.length < 100 // Short questions only, not order forms
  );
  
  return faqKeywords.some(keyword => textLower.includes(keyword)) || isLocationQuestion;
}

/**
 * Get FAQ answer
 */
export function getFAQAnswer(text) {
  const textLower = text.toLowerCase();
  
  // Opening hours
  if (textLower.includes('jam buka') || textLower.includes('buka jam') || textLower.includes('jam tutup')) {
    return `🕐 **Jam Operasional:**\n\n` +
           `Senin - Minggu: 08:00 - 20:00 WIB\n\n` +
           `Kami siap melayani pesanan Anda setiap hari!`;
  }
  
  // Location (ONLY for explicit commands, not order messages)
  // Check if it's an explicit location command, not part of order format
  const isExplicitLocationCommand = (
    textLower.trim() === '/lokasi' ||
    textLower.trim() === '/location' ||
    textLower.trim() === 'lokasi' ||
    textLower.trim() === 'location' ||
    (textLower.startsWith('/lokasi') && textLower.length <= 10) ||
    (textLower.startsWith('/location') && textLower.length <= 12)
  );
  
  // Only send location if it's an explicit command, not if "alamat" appears in order format
  if (isExplicitLocationCommand) {
    return `📍 **Lokasi:**\n\n` +
           `Dawet Kemayu Menteng\n` +
           `Jl. Kemayu Menteng, Jakarta\n\n` +
           `Untuk informasi lebih detail, silakan hubungi kami!`;
  }
  
  // Delivery
  if (textLower.includes('ongkir') || textLower.includes('ongkos kirim') || textLower.includes('delivery') || textLower.includes('pengiriman')) {
    return `🚚 **Pengiriman:**\n\n` +
           `Kami melayani pengiriman ke seluruh Jakarta.\n` +
           `Ongkir tergantung jarak dan akan diinformasikan saat konfirmasi pesanan.\n\n` +
           `Minimum order: Rp 50.000`;
  }
  
  // Payment
  if (textLower.includes('bayar') || textLower.includes('pembayaran') || textLower.includes('payment') || textLower.includes('transfer')) {
    return `💳 **Metode Pembayaran:**\n\n` +
           `• QRIS\n` +
           `• Transfer Bank (BCA, Mandiri, BNI)\n` +
           `• E-Wallet (OVO, DANA, GoPay)\n\n` +
           `Pembayaran dilakukan setelah konfirmasi pesanan.`;
  }
  
  // General FAQ
  return `❓ **Pertanyaan Umum:**\n\n` +
         `• Jam buka: 08:00 - 20:00 WIB\n` +
         `• Lokasi: Jl. Kemayu Menteng, Jakarta\n` +
         `• Pengiriman: Tersedia untuk seluruh Jakarta\n` +
         `• Pembayaran: QRIS, Transfer Bank, E-Wallet\n\n` +
         `Ketik /menu untuk melihat menu lengkap.\n` +
         `Ketik /help untuk format pesanan.`;
}
