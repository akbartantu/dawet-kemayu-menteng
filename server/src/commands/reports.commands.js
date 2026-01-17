/**
 * Reports Commands
 * Handles reporting and recap commands
 */

import { getAllOrders } from '../repos/orders.repo.js';
import { formatPrice, formatCurrencyIDR } from '../utils/formatting.js';
import { getJakartaTodayISO, addDaysJakarta, toISODateJakarta } from '../utils/date-utils.js';
import { isAdmin } from '../middleware/adminGuard.js';
import { PAYMENT_STATUS } from '../utils/constants.js';

/**
 * Get orders by ISO date (centralized filter function)
 */
async function getOrdersByISODate(targetISO, paymentStatusFilter = null) {
  try {
    // Get all orders (we'll filter by date)
    const allOrders = await getAllOrders(10000); // Get large limit to ensure we get all orders
    
    // Filter by event_date using centralized normalization
    // Both targetISO and order.event_date are normalized to YYYY-MM-DD for comparison
    const filteredOrders = allOrders.filter(order => {
      const orderDate = order.event_date;
      if (!orderDate) return false;
      
      // Normalize order date to ISO format (handles DD/MM/YYYY, serial numbers, etc.)
      // CRITICAL: If already ISO YYYY-MM-DD, return as-is (no timezone shift)
      const normalizedOrderDate = toISODateJakarta(orderDate);
      
      if (!normalizedOrderDate) {
        // Log for debugging but don't fail the filter
        console.log(`[ORDERS_FILTER] raw="${orderDate}" normalized=null (skipping)`);
        return false;
      }
      
      // Compare normalized ISO dates
      const matches = normalizedOrderDate === targetISO;
      if (matches) {
        // Log for debugging
      }
      
      return matches;
    });

    // Remove duplicates by order_id (defensive - should not happen, but handle it)
    const uniqueOrders = [];
    const seenOrderIds = new Set();
    for (const order of filteredOrders) {
      const orderId = order.id || '';
      if (orderId && !seenOrderIds.has(orderId)) {
        seenOrderIds.add(orderId);
        uniqueOrders.push(order);
      } else if (!orderId) {
        // Include orders without ID (shouldn't happen, but be safe)
        uniqueOrders.push(order);
      } else {
        // Duplicate found - log warning
        console.warn(`⚠️ [GET_ORDERS_BY_ISO_DATE] Duplicate order_id found: ${orderId} (skipping duplicate)`);
      }
    }
    
    // Filter by payment status if specified
    let finalOrders = uniqueOrders;
    if (paymentStatusFilter) {
      const filterUpper = paymentStatusFilter.toUpperCase();
      finalOrders = uniqueOrders.filter(order => {
        const orderPaymentStatus = (order.payment_status || '').toUpperCase();
        // Match exact or common variations
        if (filterUpper === 'FULLPAID' || filterUpper === 'FULL PAID') {
          return orderPaymentStatus === 'FULLPAID' || orderPaymentStatus === 'FULL PAID' || orderPaymentStatus === 'PAID';
        }
        return orderPaymentStatus === filterUpper;
      });
    }
    
    // Sort by delivery_time (HH:MM format, lexicographically safe)
    finalOrders.sort((a, b) => {
      const timeA = (a.delivery_time || '').trim() || '99:99'; // Missing times go to bottom
      const timeB = (b.delivery_time || '').trim() || '99:99';
      return timeA.localeCompare(timeB);
    });
    
    return finalOrders;
  } catch (error) {
    console.error('❌ [GET_ORDERS_BY_ISO_DATE] Error:', error);
    throw error;
  }
}

/**
 * Get orders by event date (legacy wrapper - now uses getOrdersByISODate)
 */
async function getOrdersByDate(targetDate, paymentStatusFilter = null) {
  // Normalize target date to ISO format (YYYY-MM-DD) in Asia/Jakarta
  const targetDateISO = toISODateJakarta(targetDate);
  if (!targetDateISO) {
    console.error(`❌ [GET_ORDERS_BY_DATE] Invalid target date: ${targetDate}`);
    throw new Error(`Invalid target date: ${targetDate}`);
  }

  // Use centralized filter function
  return await getOrdersByISODate(targetDateISO, paymentStatusFilter);
}

/**
 * Format items list for recap (bullet list format)
 */
function formatItemsForRecap(itemsJson) {
  try {
    // Parse if string
    let items = itemsJson;
    if (typeof itemsJson === 'string') {
      items = JSON.parse(itemsJson);
    }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return '- (tidak ada)';
    }
    
    // Format as bullet list
    return items.map(item => {
      const name = item.name || item.item || 'Unknown';
      const qty = item.quantity || 0;
      return `- ${qty}x ${name}`;
    }).join('\n');
  } catch (error) {
    // Fallback: try to display raw value
    console.warn('⚠️ [FORMAT_ITEMS] Error parsing items_json:', error.message);
    if (typeof itemsJson === 'string' && itemsJson.trim()) {
      return `- ${itemsJson}`;
    }
    return '- (tidak ada)';
  }
}

/**
 * Format notes list for recap (bullet list format)
 * Uses sanitizeCustomerNotes to filter out JSON objects and payment evidence
 */
async function formatNotesForRecap(notesJson) {
  try {
    const { sanitizeCustomerNotes } = await import('../utils/order-message-formatter.js');
    const validNotes = sanitizeCustomerNotes(notesJson);
    
    if (validNotes.length === 0) {
      return '- (tidak ada)';
    }
    
    return validNotes.map(note => `- ${note.trim()}`).join('\n');
  } catch (error) {
    // Fallback: try to display raw value
    console.warn('⚠️ [FORMAT_NOTES] Error parsing notes_json:', error.message);
    if (typeof notesJson === 'string' && notesJson.trim()) {
      return `- ${notesJson}`;
    }
    return '- (tidak ada)';
  }
}

/**
 * Format order recap message (H-1 recap format)
 */
async function formatRecapMessage(orders, date) {
  if (orders.length === 0) {
    return `Tidak ada pesanan untuk besok (${date}).`;
  }
  
  // Import sanitizer once at the top
  const { sanitizeCustomerNotes } = await import('../utils/order-message-formatter.js');
  
  let message = `📋REKAP PESANAN (${date})\n`;
  message += `Total: ${orders.length} pesanan\n\n`;
  
  for (let index = 0; index < orders.length; index++) {
    const order = orders[index];
    // Get delivery time (default to --:-- if missing/invalid)
    let deliveryTime = (order.delivery_time || '').trim();
    if (!deliveryTime || !/^\d{2}:\d{2}$/.test(deliveryTime)) {
      deliveryTime = '--:--';
    }
    
    // Get other fields with defaults
    const customerName = order.customer_name || '-';
    const phoneNumber = order.phone_number || '-';
    const address = order.address || '-';
    const paymentStatus = order.payment_status || 'UNPAID';
    const remainingBalance = order.remaining_balance || 0;
    
    // Get items: prefer parsed items array, fallback to items_json string
    const itemsData = order.items || order.items_json || '[]';
    
    // Get notes: prefer parsed notes array, fallback to notes_json string
    const notesData = order.notes || order.notes_json || '[]';
    
    // Calculate total cups and required styrofoam boxes
    let totalCups = 0;
    let hasPackagingInItems = false;
    
    try {
      const items = typeof itemsData === 'string' ? JSON.parse(itemsData) : itemsData;
      if (Array.isArray(items)) {
        items.forEach(item => {
          const qty = parseInt(item.quantity || 0);
          const itemName = (item.name || item.item || '').toLowerCase();
          
          // Check if packaging is in items
          if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
            hasPackagingInItems = true;
            return;
          }
          
          // Check if item is a cup-based product (Dawet Small/Medium/Large)
          if (itemName.includes('dawet') && 
              (itemName.includes('small') || 
               itemName.includes('medium') || 
               itemName.includes('large'))) {
            // Exclude botol items (they're not cups)
            if (!itemName.includes('botol')) {
              totalCups += qty;
            }
          }
        });
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_RECAP] Error calculating total cups:', e.message);
    }
    
    // Calculate styrofoam boxes needed (1 box per 50 cups, rounded up)
    const styrofoamBoxes = totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
    
    // Format items list (replace packaging with calculated quantity)
    let itemsList = '';
    try {
      const items = typeof itemsData === 'string' ? JSON.parse(itemsData) : itemsData;
      if (Array.isArray(items) && items.length > 0) {
        let packagingShown = false;
        items.forEach(item => {
          const itemName = (item.name || item.item || '').toLowerCase();
          
          // If this is a packaging item, show calculated quantity
          if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
            if (styrofoamBoxes > 0) {
              itemsList += `• ${styrofoamBoxes}x Packaging Styrofoam (50 cup)\n`;
              packagingShown = true;
            }
            return; // Skip original packaging item
          }
          
          // Display other items normally
          itemsList += `• ${item.quantity || 0}x ${item.name || item.item || 'Unknown'}\n`;
        });
        
        // If packaging needed but not in items, add it
        if (styrofoamBoxes > 0 && !packagingShown) {
          itemsList += `• ${styrofoamBoxes}x Packaging Styrofoam (50 cup)\n`;
        }
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_RECAP] Error formatting items:', e.message);
      itemsList = '- (tidak ada)\n';
    }
    
    if (!itemsList.trim()) {
      itemsList = '- (tidak ada)\n';
    }
    
    // Format notes (single line format, not bullet list)
    let notesStr = '';
    try {
      const validNotes = sanitizeCustomerNotes(notesData);
      
      if (validNotes.length > 0) {
        // Join all notes with newline (single line per note)
        notesStr = validNotes.join('\n');
      } else {
        notesStr = '-';
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_RECAP] Error formatting notes:', e.message);
      notesStr = '-';
    }
    
    // Format payment status
    let paymentStatusText = paymentStatus.toUpperCase();
    if (paymentStatus.toUpperCase() === 'FULLPAID' || paymentStatus.toUpperCase() === 'FULL PAID' || paymentStatus.toUpperCase() === 'PAID') {
      paymentStatusText = 'LUNAS';
    } else if (remainingBalance > 0) {
      paymentStatusText = `${paymentStatus} (Sisa: Rp ${formatPrice(remainingBalance)})`;
    }
    
    // Build order block (new format - Indonesian labels)
    message += `👤 Customer: ${customerName}\n`;
    message += `📞 HP: ${phoneNumber}\n`;
    message += `📍 Alamat: ${address}\n\n`;
    message += `🕐 Jam Pengiriman: ${deliveryTime}\n\n`;
    message += `📦 Daftar Pesanan:\n${itemsList}`;
    message += `\n📝 Catatan:\n${notesStr}\n\n`;
    message += `✅ Payment Status: ${paymentStatusText}\n\n`;
    
    // Add separator between orders (except for the last one)
    if (index < orders.length - 1) {
      message += `─────────────────\n\n`;
    }
  }
  
  return message;
}

/**
 * Format order list message (uses same detailed format as recap)
 */
async function formatOrderListMessage(orders, date) {
  if (orders.length === 0) {
    // Ensure consistent empty response format
    return `📅 Tidak ada pesanan untuk tanggal ${date}.`;
  }
  
  // Import sanitizer once at the top
  const { sanitizeCustomerNotes } = await import('../utils/order-message-formatter.js');
  
  // Remove duplicates by order_id (defensive)
  const uniqueOrders = [];
  const seenOrderIds = new Set();
  for (const order of orders) {
    const orderId = order.id || '';
    if (orderId && !seenOrderIds.has(orderId)) {
      seenOrderIds.add(orderId);
      uniqueOrders.push(order);
    } else if (!orderId) {
      // Include orders without ID (shouldn't happen, but be safe)
      uniqueOrders.push(order);
    }
  }
  
  // Use same format as recap message
  let message = `📋REKAP PESANAN (${date})\n`;
  message += `Total: ${uniqueOrders.length} pesanan\n\n`;
  
  for (let index = 0; index < uniqueOrders.length; index++) {
    const order = uniqueOrders[index];
    // Get delivery time (default to --:-- if missing/invalid)
    let deliveryTime = (order.delivery_time || '').trim();
    if (!deliveryTime || !/^\d{2}:\d{2}$/.test(deliveryTime)) {
      deliveryTime = '--:--';
    }
    
    // Get other fields with defaults
    const customerName = order.customer_name || '-';
    const phoneNumber = order.phone_number || '-';
    const address = order.address || '-';
    const paymentStatus = order.payment_status || 'UNPAID';
    const remainingBalance = order.remaining_balance || 0;
    const deliveryMethod = order.delivery_method || order.shipping_method || '-';
    
    // Get invoice totals
    const productTotal = parseFloat(order.product_total || 0);
    const packagingFee = parseFloat(order.packaging_fee || 0);
    const deliveryFee = parseFloat(order.delivery_fee || 0);
    const finalTotal = parseFloat(order.total_amount || order.final_total || 0);
    
    // Get items: prefer parsed items array, fallback to items_json string
    const itemsData = order.items || order.items_json || '[]';
    
    // Get notes: prefer parsed notes array, fallback to notes_json string
    const notesData = order.notes || order.notes_json || '[]';
    
    // Calculate total cups and required styrofoam boxes
    let totalCups = 0;
    let hasPackagingInItems = false;
    
    try {
      const items = typeof itemsData === 'string' ? JSON.parse(itemsData) : itemsData;
      if (Array.isArray(items)) {
        items.forEach(item => {
          const qty = parseInt(item.quantity || 0);
          const itemName = (item.name || item.item || '').toLowerCase();
          
          // Check if packaging is in items
          if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
            hasPackagingInItems = true;
            return;
          }
          
          // Check if item is a cup-based product (Dawet Small/Medium/Large)
          if (itemName.includes('dawet') && 
              (itemName.includes('small') || 
               itemName.includes('medium') || 
               itemName.includes('large'))) {
            // Exclude botol items (they're not cups)
            if (!itemName.includes('botol')) {
              totalCups += qty;
            }
          }
        });
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_ORDER_LIST] Error calculating total cups:', e.message);
    }
    
    // Calculate styrofoam boxes needed (1 box per 50 cups, rounded up)
    const styrofoamBoxes = totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
    
    // Format items list (replace packaging with calculated quantity)
    let itemsList = '';
    try {
      const items = typeof itemsData === 'string' ? JSON.parse(itemsData) : itemsData;
      if (Array.isArray(items) && items.length > 0) {
        let packagingShown = false;
        items.forEach(item => {
          const itemName = (item.name || item.item || '').toLowerCase();
          
          // If this is a packaging item, show calculated quantity
          if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
            if (styrofoamBoxes > 0) {
              itemsList += `• ${styrofoamBoxes}x Packaging Styrofoam (50 cup)\n`;
              packagingShown = true;
            }
            return; // Skip original packaging item
          }
          
          // Display other items normally
          itemsList += `• ${item.quantity || 0}x ${item.name || item.item || 'Unknown'}\n`;
        });
        
        // If packaging needed but not in items, add it
        if (styrofoamBoxes > 0 && !packagingShown) {
          itemsList += `• ${styrofoamBoxes}x Packaging Styrofoam (50 cup)\n`;
        }
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_ORDER_LIST] Error formatting items:', e.message);
      itemsList = '- (tidak ada)\n';
    }
    
    if (!itemsList.trim()) {
      itemsList = '- (tidak ada)\n';
    }
    
    // Format notes (single line format, not bullet list)
    let notesStr = '';
    try {
      const validNotes = sanitizeCustomerNotes(notesData);
      
      if (validNotes.length > 0) {
        // Join all notes with newline (single line per note)
        notesStr = validNotes.join('\n');
      } else {
        notesStr = '-';
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_ORDER_LIST] Error formatting notes:', e.message);
      notesStr = '-';
    }
    
    // Format payment status
    let paymentStatusText = paymentStatus.toUpperCase();
    if (paymentStatus.toUpperCase() === 'FULLPAID' || paymentStatus.toUpperCase() === 'FULL PAID' || paymentStatus.toUpperCase() === 'PAID') {
      paymentStatusText = 'LUNAS';
    } else if (remainingBalance > 0) {
      paymentStatusText = `${paymentStatus} (Sisa: Rp ${formatPrice(remainingBalance)})`;
    }
    
    // Build order block (new format - Indonesian labels)
    const invoiceNumber = order.id || '-';
    message += `🧾 Invoice: ${invoiceNumber}\n`;
    message += `👤 Customer: ${customerName}\n`;
    message += `📞 HP: ${phoneNumber}\n`;
    message += `📍 Alamat: ${address}\n\n`;
    message += `🕐 Jam Pengiriman: ${deliveryTime}\n`;
    message += `🚚 Metode Pengiriman: ${deliveryMethod}\n\n`;
    message += `📦 Daftar Pesanan:\n${itemsList}`;
    message += `\n📝 Catatan:\n${notesStr}\n\n`;
    message += `✅ Payment Status: ${paymentStatusText}\n\n`;
    
    // Add separator between orders (except for the last one)
    if (index < uniqueOrders.length - 1) {
      message += `─────────────────\n\n`;
    }
  }
  
  return message;
}

/**
 * Get today's date in Asia/Jakarta timezone as ISO string (YYYY-MM-DD)
 */
function getTodayDate() {
  return getJakartaTodayISO();
}

/**
 * Get tomorrow's date in Asia/Jakarta timezone as ISO string (YYYY-MM-DD)
 */
function getTomorrowDate() {
  const todayISO = getJakartaTodayISO();
  return addDaysJakarta(todayISO, 1);
}

/**
 * Handle /recap_h1 command - Show tomorrow's orders recap
 */
export async function handleRecapH1(chatId, userId, sendMessage) {
  try {
    // Check admin access
    if (!(await isAdmin(userId))) {
      await sendMessage(chatId, 'Maaf, command ini hanya untuk admin.');
      return;
    }
    
    // Get tomorrow's date
    const tomorrow = getTomorrowDate();

    // Get orders for tomorrow (filter by FULLPAID only)
    const orders = await getOrdersByDate(tomorrow, 'FULLPAID');

    // Log first 3 order IDs for sanity check
    if (orders.length > 0) {
      const orderIds = orders.slice(0, 3).map(o => o.id).join(', ');
      console.log(`🔍 [RECAP_H1] Found ${orders.length} order(s) for tomorrow (${tomorrow}), first 3 IDs: ${orderIds}`);
    }
    
    // Format and send recap message
    const message = await formatRecapMessage(orders, tomorrow);
    await sendMessage(chatId, message);

  } catch (error) {
    console.error('❌ [RECAP_H1] Error:', error);
    console.error('❌ [RECAP_H1] Stack:', error.stack);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil rekapan pesanan. Silakan coba lagi.');
  }
}

/**
 * Handle /orders_date command - Show orders for a specific date
 */
export async function handleOrdersDate(chatId, userId, dateStr, sendMessage) {
  try {
    // Check admin access
    if (!(await isAdmin(userId))) {
      await sendMessage(chatId, 'Maaf, command ini hanya untuk admin.');
      return;
    }
    
    // Determine target date (normalized to ISO in Asia/Jakarta)
    let targetDate;
    if (dateStr === 'today' || dateStr === 'hari ini') {
      targetDate = getTodayDate();
    } else if (dateStr === 'tomorrow' || dateStr === 'besok') {
      targetDate = getTomorrowDate();
    } else {
      // Validate and normalize date format
      // Accept YYYY-MM-DD, DD/MM/YYYY, or other formats (will be normalized)
      const normalized = toISODateJakarta(dateStr);
      if (!normalized) {
        await sendMessage(chatId, '❌ Format tanggal tidak valid. Gunakan: YYYY-MM-DD atau DD/MM/YYYY\n\nContoh: /orders_date 2026-01-18\nAtau: /orders_today, /orders_tomorrow');
        return;
      }
      targetDate = normalized;
    }
    
    console.log(`🔍 [ORDERS_DATE] Fetching orders for date: ${targetDate} (normalized)`);
    
    // Get orders for target date (filter by FULLPAID only)
    const orders = await getOrdersByDate(targetDate, 'FULLPAID');

    // Debug logging
    if (dateStr === 'today' || dateStr === 'hari ini') {
      console.log(`🔍 [ORDERS_DATE] Today's date: ${targetDate}`);
    } else if (dateStr === 'tomorrow' || dateStr === 'besok') {
      console.log(`🔍 [ORDERS_DATE] Tomorrow's date: ${targetDate}`);
    }
    
    // Log first 3 order IDs for sanity check
    if (orders.length > 0) {
      const orderIds = orders.slice(0, 3).map(o => o.id).join(', ');
      console.log(`🔍 [ORDERS_DATE] Found ${orders.length} order(s) for ${targetDate}, first 3 IDs: ${orderIds}`);
    }
    
    // Format and send list message
    const message = await formatOrderListMessage(orders, targetDate);
    await sendMessage(chatId, message);

  } catch (error) {
    console.error('❌ [ORDERS_DATE] Error:', error);
    console.error('❌ [ORDERS_DATE] Stack:', error.stack);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil daftar pesanan. Silakan coba lagi.');
  }
}

/**
 * Format unpaid orders message
 */
async function formatUnpaidOrdersMessage(orders, date) {
  if (orders.length === 0) {
    return `💰 Tidak ada pesanan belum lunas untuk tanggal ${date}.`;
  }
  
  // Import sanitizer once at the top
  const { sanitizeCustomerNotes } = await import('../utils/order-message-formatter.js');
  
  let message = `💰 PESANAN BELUM LUNAS (${date})\n`;
  message += `Total: ${orders.length} pesanan\n\n`;
  
  for (let index = 0; index < orders.length; index++) {
    const order = orders[index];
    // Get delivery time (default to --:-- if missing/invalid)
    let deliveryTime = (order.delivery_time || '').trim();
    if (!deliveryTime || !/^\d{2}:\d{2}$/.test(deliveryTime)) {
      deliveryTime = '--:--';
    }
    
    // Get other fields with defaults
    const customerName = order.customer_name || '-';
    const phoneNumber = order.phone_number || '-';
    const address = order.address || '-';
    const deliveryMethod = order.delivery_method || order.shipping_method || '-';
    
    // Get payment details
    const totalAmount = parseFloat(order.total_amount || order.final_total || 0);
    const paidAmount = parseFloat(order.paid_amount || 0);
    const remainingBalance = parseFloat(order.remaining_balance || 0);
    const paymentStatus = (order.payment_status || 'UNPAID').toUpperCase();
    
    // Get items: prefer parsed items array, fallback to items_json string
    const itemsData = order.items || order.items_json || '[]';
    
    // Get notes: prefer parsed notes array, fallback to notes_json string
    const notesData = order.notes || order.notes_json || '[]';
    
    // Format items list
    let itemsList = '';
    try {
      const items = typeof itemsData === 'string' ? JSON.parse(itemsData) : itemsData;
      if (Array.isArray(items) && items.length > 0) {
        items.forEach(item => {
          const itemName = (item.name || item.item || 'Unknown').trim();
          const qty = item.quantity || 0;
          itemsList += `• ${qty}x ${itemName}\n`;
        });
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_UNPAID] Error formatting items:', e.message);
    }
    
    if (!itemsList.trim()) {
      itemsList = '-\n';
    }
    
    // Format notes
    let notesStr = '';
    try {
      const validNotes = sanitizeCustomerNotes(notesData);
      
      if (validNotes.length > 0) {
        notesStr = validNotes.map(note => `• ${note.trim()}`).join('\n');
      } else {
        notesStr = '-';
      }
    } catch (e) {
      console.warn('⚠️ [FORMAT_UNPAID] Error formatting notes:', e.message);
      notesStr = '-';
    }
    
    // Build order block (using Indonesian labels)
    const invoiceNumber = order.id || '-';
    message += `🧾 Invoice: ${invoiceNumber}\n`;
    message += `👤 Customer: ${customerName}\n`;
    message += `📞 HP: ${phoneNumber}\n`;
    message += `📍 Alamat: ${address}\n\n`;
    message += `🕐 Jam Pengiriman: ${deliveryTime}\n`;
    message += `🚚 Metode Pengiriman: ${deliveryMethod}\n\n`;
    message += `📦 Daftar Pesanan:\n${itemsList}`;
    message += `\n📝 Catatan:\n${notesStr}\n\n`;
    message += `💰 Pembayaran:\n`;
    message += `• Total: ${formatCurrencyIDR(totalAmount)}\n`;
    message += `• Dibayar: ${formatCurrencyIDR(paidAmount)}\n`;
    message += `• Sisa: ${formatCurrencyIDR(remainingBalance)}\n`;
    message += `• Status: ${paymentStatus}\n`;
    
    // Add separator between orders (except for the last one)
    if (index < orders.length - 1) {
      message += `\n─────────────────\n\n`;
    }
  });
  
  return message;
}

/**
 * Handle /orders_unpaid command - Show all unpaid orders
 */
export async function handleOrdersUnpaid(chatId, userId, sendMessage) {
  try {
    // Check admin access
    if (!(await isAdmin(userId))) {
      await sendMessage(chatId, 'Maaf, command ini hanya untuk admin.');
      return;
    }
    
    // Get today's date
    const today = getTodayDate();
    
    // Get all orders
    const allOrders = await getAllOrders(10000);
    
    // Filter for UNPAID orders only
    const unpaidOrders = allOrders.filter(order => {
      const paymentStatus = (order.payment_status || 'UNPAID').toUpperCase();
      return paymentStatus === PAYMENT_STATUS.UNPAID || paymentStatus === 'UNPAID';
    });
    
    // Sort by event_date (ascending), then by delivery_time
    unpaidOrders.sort((a, b) => {
      const dateA = a.event_date || '';
      const dateB = b.event_date || '';
      if (dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }
      const timeA = (a.delivery_time || '').trim() || '99:99';
      const timeB = (b.delivery_time || '').trim() || '99:99';
      return timeA.localeCompare(timeB);
    });
    
    console.log(`🔍 [ORDERS_UNPAID] Found ${unpaidOrders.length} unpaid order(s)`);
    
    // Format and send message
    const message = await formatUnpaidOrdersMessage(unpaidOrders, today);
    await sendMessage(chatId, message);
    
  } catch (error) {
    console.error('❌ [ORDERS_UNPAID] Error:', error);
    console.error('❌ [ORDERS_UNPAID] Stack:', error.stack);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil daftar pesanan belum lunas. Silakan coba lagi.');
  }
}
