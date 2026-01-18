/**
 * Order Commands
 * Handles order-related admin commands
 */

import { getAllOrders, getOrderById, saveOrder, generateOrderId, updateOrderStatus } from '../repos/orders.repo.js';
import { getPriceList } from '../repos/price-list.repo.js';
import { calculateOrderTotal } from '../services/price-calculator.js';
import { formatPrice, formatCurrencyIDR } from '../utils/formatting.js';
import { formatOrderHeader, formatOrderItems, formatPaymentSummary, formatNotes } from '../utils/order-message-formatter.js';
import { ORDER_STATUS } from '../utils/constants.js';
import {
  parseOrderFromMessageAuto,
  validateOrder,
} from '../services/order-parser.js';
import { requireAdmin, isAdmin } from '../middleware/adminGuard.js';
import logger from '../utils/logger.js';

/**
 * Handle /new_order command
 * Creates empty order with generated ID
 */
export async function handleNewOrder(chatId, userId, sendMessage) {
  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    return;
  }

  try {
    const orderId = await generateOrderId();
    await sendMessage(
      chatId,
      `✅ **Order Baru Dibuat**\n\n` +
      `📋 Order ID: ${orderId}\n\n` +
      `Silakan kirim template pesanan untuk di-parse, atau gunakan /parse_order untuk memulai.`
    );
  } catch (error) {
    console.error('❌ Error creating new order:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat membuat order baru.');
  }
}

/**
 * Handle /parse_order command
 * Parses order template and saves to database
 */
export async function handleParseOrder(chatId, userId, messageText, sendMessage, replyToMessage = null) {
  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    return;
  }

  try {
    let orderText = '';
    
    // Prefer reply_to_message if available
    if (replyToMessage && replyToMessage.text) {
      orderText = replyToMessage.text.trim();
      console.log(`🔍 [PARSE_ORDER] Using reply_to_message text (${orderText.length} chars)`);
    } else {
      // Extract payload from same message (everything after first newline or after command)
      const newlineIndex = messageText.indexOf('\n');
      if (newlineIndex >= 0) {
        orderText = messageText.substring(newlineIndex + 1).trim();
        console.log(`🔍 [PARSE_ORDER] Using payload from same message (${orderText.length} chars)`);
      } else {
        // Fallback: Remove /parse_order command from message
        orderText = messageText.replace(/^\/parse_order\s*/i, '').trim();
      }
    }
    
    if (!orderText) {
      await sendMessage(
        chatId,
        '❌ Format tidak valid.\n\n' +
        '**Cara penggunaan:**\n' +
        '1. Reply ke pesanan yang ingin di-parse, lalu ketik /parse_order\n' +
        '2. Atau ketik: /parse_order [template pesanan]\n' +
        '3. Atau kirim: /parse_order\\n[template pesanan]\n\n' +
        '**Rekomendasi:** Gunakan cara 1 (reply) untuk hasil yang lebih akurat.'
      );
      return;
    }

    // Parse order from template (use auto parser for better format detection)
    const parsedOrder = parseOrderFromMessageAuto(orderText);
    const validation = validateOrder(parsedOrder);

    if (!validation.valid) {
      await sendMessage(
        chatId,
        `❌ **Order tidak valid**\n\n` +
        `Kesalahan:\n${validation.errors.join('\n')}\n\n` +
        `Silakan perbaiki dan coba lagi.`
      );
      return;
    }

    // Check if this is an edit (order ID in form)
    // Look for "Invoice:" field or order ID pattern in the message (DKM/YYYYMMDD/000001)
    let orderId = null;
    let isEdit = false;
    
    // Try to extract Invoice from form (format: "Invoice: DKM/20260110/000005")
    const invoiceMatch = orderText.match(/Invoice\s*:\s*(DKM\/\d{8}\/\d{6})/i);
    if (invoiceMatch) {
      orderId = invoiceMatch[1];
    } else {
      // Fallback: Look for order ID pattern anywhere in the message
      const orderIdMatch = orderText.match(/(DKM\/\d{8}\/\d{6})/i);
      if (orderIdMatch) {
        orderId = orderIdMatch[1];
      }
    }
    
    if (orderId) {
      // Check if order exists
      const existingOrder = await getOrderById(orderId);
      if (existingOrder) {
        isEdit = true;
        logger.debug(`[PARSE_ORDER] Detected edit mode for existing order: ${orderId}`);
      } else {
        // Order ID found but doesn't exist - treat as new order with custom ID (not recommended)
        logger.warn(`[PARSE_ORDER] Order ID ${orderId} found in form but order doesn't exist. Creating new order.`);
        orderId = null; // Will generate new ID below
      }
    }
    
    // Generate new order ID if not editing
    if (!isEdit) {
      orderId = await generateOrderId();
    }
    
    // Create order data
    const orderData = {
      id: orderId,
      customer_name: parsedOrder.customer_name,
      phone_number: parsedOrder.phone_number,
      address: parsedOrder.address,
      event_name: parsedOrder.event_name,
      event_duration: parsedOrder.event_duration,
      event_date: parsedOrder.event_date,
      delivery_time: parsedOrder.delivery_time,
      items: parsedOrder.items,
      notes: parsedOrder.notes,
      delivery_method: parsedOrder.delivery_method,
      delivery_fee: parsedOrder.delivery_fee,
      // If editing, preserve existing status and created_at (don't overwrite)
      // If new, set default values
      status: isEdit ? undefined : 'pending',
      created_at: isEdit ? undefined : new Date().toISOString(),
    };

    // Save order (will update if exists, create if new)
    await saveOrder(orderData);

    // Get price list and calculate totals
    const priceList = await getPriceList();
    const calculation = calculateOrderTotal(orderData.items, priceList);

    // Format order summary
    let summary = isEdit 
      ? `✅ **ORDER UPDATED**\n\n`
      : `✅ **ORDER SUMMARY**\n\n`;
    summary += `📋 Order ID: ${orderId}\n`;
    summary += `👤 Customer: ${orderData.customer_name}\n`;
    summary += `📞 Phone: ${orderData.phone_number}\n`;
    summary += `📍 Address: ${orderData.address}\n`;
    if (orderData.event_date) {
      summary += `📅 Event Date: ${orderData.event_date}\n`;
    }
    if (orderData.delivery_time) {
      summary += `🕐 Delivery Time: ${orderData.delivery_time}\n`;
    }
    summary += `\n📦 **Items:**\n`;
    calculation.itemDetails.forEach((item, index) => {
      summary += `${index + 1}. ${item.name} (${item.quantity}x)\n`;
      summary += `   Subtotal: Rp ${formatPrice(item.itemTotal)}\n`;
    });
    summary += `\n💰 **Total: Rp ${formatPrice(calculation.subtotal)}**\n`;
    summary += `\n${isEdit ? '✅ Order berhasil diperbarui!' : '✅ Order berhasil disimpan!'}`;

    await sendMessage(chatId, summary);
  } catch (error) {
    console.error('❌ Error parsing order:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat memparse order. Silakan coba lagi.');
  }
}

/**
 * Handle /order_detail command
 * Shows full order details
 */
export async function handleOrderDetail(chatId, userId, orderId, sendMessage) {
  logger.debug(`[ORDER_DETAIL] Command received - chatId: ${chatId}, userId: ${userId}, orderId: ${orderId || 'MISSING'}`);
  
  try {
    // Check admin access
    const isUserAdmin = await isAdmin(userId);
    logger.debug(`[ORDER_DETAIL] Admin check - userId: ${userId}, isAdmin: ${isUserAdmin}`);
    
    if (!isUserAdmin) {
      await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini. Perintah ini hanya untuk admin.');
      return;
    }

    if (!orderId || !orderId.trim()) {
      await sendMessage(chatId, '❌ Format: /order_detail <ORDER_ID>\n\nContoh: /order_detail DKM/20260110/000005');
      return;
    }

    const trimmedOrderId = orderId.trim();
    logger.debug(`[ORDER_DETAIL] Looking up order: ${trimmedOrderId}`);

    // CRITICAL: Always read fresh from Google Sheets (no cache)
    // This ensures /order_detail shows latest data after /edit
    const order = await getOrderById(trimmedOrderId);
    
    if (!order) {
      await sendMessage(chatId, `❌ Order ID "${trimmedOrderId}" tidak ditemukan.`);
      return;
    }

    logger.debug(`✅ [ORDER_DETAIL] Order found: ${order.id}`);

    // Get price list for calculation
    let priceList;
    let calculation;
    try {
      priceList = await getPriceList();
      calculation = calculateOrderTotal(order.items || [], priceList);
    } catch (error) {
      logger.error('[ORDER_DETAIL] Error calculating totals:', error);
      logger.error('[ORDER_DETAIL] Error message:', error?.message || 'Unknown error');
      throw new Error(`Failed to calculate order totals: ${error?.message || 'Unknown error'}`);
    }

    // Format order detail with comprehensive information (admin view)
    let detail = `📋 **DETAIL PESANAN**\n\n`;
    detail += `**Order ID:** ${order.id}\n`;
    detail += `**Status:** ${order.status || 'N/A'}\n`;
    
    // Payment info if available
    if (order.payment_status) {
      detail += `**Status Pembayaran:** ${order.payment_status}\n`;
      if (order.paid_amount) {
        detail += `**Dibayar:** ${formatCurrencyIDR(order.paid_amount)}\n`;
      }
      if (order.remaining_balance !== undefined) {
        detail += `**Sisa:** ${formatCurrencyIDR(order.remaining_balance)}\n`;
      }
    }
    
    // Use shared formatter for customer info section
    detail += `\n`;
    detail += formatOrderHeader(order);
    
    if (order.receiver_name && order.receiver_name !== order.customer_name) {
      detail += `👤 Nama Penerima: ${order.receiver_name}\n`;
    }
    
    if (order.event_name) {
      detail += `📅 Nama Event: ${order.event_name}\n`;
    }

    // Parse notes (handle both string and array formats)
    let notes = order.notes || [];
    if (typeof notes === 'string') {
      try {
        notes = JSON.parse(notes);
      } catch (e) {
        // If not valid JSON, treat as plain string
        if (notes.trim()) {
          notes = [notes.trim()];
        } else {
          notes = [];
        }
      }
    }
    // Ensure notes is an array
    if (!Array.isArray(notes)) {
      notes = notes ? [notes] : [];
    }

    // Use shared formatter for items
    detail += formatOrderItems(order.items || []);
    
    // Calculate packaging for payment summary
    const hasPackagingRequest = notes.some(note => {
      const noteLower = String(note || '').toLowerCase().trim();
      return noteLower.includes('packaging') && 
             (noteLower.includes('ya') || noteLower.includes('yes'));
    });
    
    const totalCups = (order.items || []).reduce((sum, item) => {
      const name = (item.name || '').toLowerCase();
      if (name.includes('dawet') && 
          (name.includes('small') || name.includes('medium') || name.includes('large')) && 
          !name.includes('botol')) {
        return sum + (item.quantity || 0);
      }
      return sum;
    }, 0);
    
    const packagingBoxes = hasPackagingRequest && totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
    const packagingFee = packagingBoxes * 40000;
    const deliveryFee = parseFloat(order.delivery_fee) || 0;
    
    // Use shared formatter for payment summary
    detail += formatPaymentSummary(order, calculation, packagingFee, deliveryFee);
    
    // Use shared formatter for notes
    detail += formatNotes(order.notes || []);
    
    // Removed Created/Updated timestamps from output (per requirements)

    await sendMessage(chatId, detail);
    logger.debug(`✅ [ORDER_DETAIL] Successfully sent order details for ${trimmedOrderId}`);
  } catch (error) {
    logger.error('[ORDER_DETAIL] Error getting order detail:', error);
    logger.error('[ORDER_DETAIL] Error message:', error?.message || 'Unknown error');
    logger.error('[ORDER_DETAIL] Error stack:', error?.stack || 'No stack trace');
    logger.error('[ORDER_DETAIL] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    await sendMessage(chatId, `❌ Maaf, ada error saat memproses perintah ini: ${error?.message || 'Unknown error'}. Silakan coba lagi.`);
  }
}

/**
 * Handle /status command
 * Quick status check
 */
export async function handleStatus(chatId, userId, orderId, sendMessage) {
  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
    return;
  }

  if (!orderId) {
    await sendMessage(chatId, '❌ Format: /status <order_id>');
    return;
  }

  try {
    const order = await getOrderById(orderId);
    
    if (!order) {
      await sendMessage(chatId, `❌ Order ${orderId} tidak ditemukan.`);
      return;
    }

    await sendMessage(
      chatId,
      `📋 **Order Status**\n\n` +
      `Order ID: ${order.id}\n` +
      `Status: ${order.status}\n` +
      `Customer: ${order.customer_name || 'N/A'}\n` +
      `Created: ${order.created_at ? new Date(order.created_at).toLocaleString('id-ID') : 'N/A'}`
    );
  } catch (error) {
    console.error('❌ Error getting status:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil status order.');
  }
}

/**
 * Format order data into editable form template (pre-filled with existing data)
 */
function formatOrderFormTemplate(order) {
  // Get items as formatted string
  const itemsText = (order.items || []).map(item => 
    `${item.quantity}x ${item.name}`
  ).join('\n') || '';

  // Get all notes first (to check for packaging)
  const allNotes = order.notes || [];
  
  // Check if packaging is requested (check original notes before filtering)
  const hasPackaging = allNotes.some(note => {
    const noteLower = String(note || '').toLowerCase().trim();
    return noteLower.includes('packaging styrofoam') && 
           (noteLower.includes(': ya') || noteLower.includes(': yes') || 
            noteLower === 'packaging styrofoam: ya' || noteLower === 'packaging styrofoam: yes');
  });
  
  // Filter out packaging notes for display
  const notes = allNotes.filter(note => {
    const noteLower = String(note || '').toLowerCase().trim();
    return !(noteLower.includes('packaging styrofoam') && 
             (noteLower.includes(': ya') || noteLower.includes(': yes') || 
              noteLower === 'packaging styrofoam: ya' || noteLower === 'packaging styrofoam: yes'));
  });
  const notesText = notes.join('\n') || '';

  // Format event date (convert YYYY-MM-DD to DD/MM/YYYY if needed)
  let eventDateFormatted = order.event_date || '';
  if (eventDateFormatted && eventDateFormatted.includes('-')) {
    const parts = eventDateFormatted.split('-');
    if (parts.length === 3) {
      eventDateFormatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }

  // Format delivery time (ensure HH:MM format)
  let deliveryTimeFormatted = order.delivery_time || '';
  if (deliveryTimeFormatted && !deliveryTimeFormatted.includes(':')) {
    // If time is in wrong format, try to fix it
    deliveryTimeFormatted = deliveryTimeFormatted.replace(/\./g, ':');
  }

  // Format delivery fee
  const deliveryFeeFormatted = order.delivery_fee 
    ? (typeof order.delivery_fee === 'number' ? order.delivery_fee.toString() : order.delivery_fee)
    : '';

  // Build form template (include Invoice field so parser can detect edit mode)
  let form = `📝 **EDIT ORDER**\n\n`;
  form += `**Invoice:** ${order.id || 'N/A'}\n\n`;
  form += `Silakan edit form berikut dan kirim kembali:\n\n`;
  form += `Invoice: ${order.id || 'N/A'}\n`;
  form += `Nama Pemesan: ${order.customer_name || ''}\n`;
  form += `Nama Penerima: ${order.receiver_name || order.customer_name || ''}\n`;
  form += `No HP Penerima: ${order.phone_number || ''}\n`;
  form += `Alamat Penerima: ${order.address || ''}\n\n`;
  form += `Nama Event (jika ada): ${order.event_name || ''}\n`;
  form += `Durasi Event (dalam jam): ${order.event_duration || ''}\n\n`;
  form += `Tanggal Event: ${eventDateFormatted}\n`;
  form += `Waktu Kirim (jam): ${deliveryTimeFormatted}\n\n`;
  form += `Detail Pesanan:\n${itemsText}\n\n`;
  form += `Packaging Styrofoam\n`;
  form += `(1 box Rp40.000 untuk 50 cup): ${hasPackaging ? 'YA' : 'TIDAK'}\n\n`;
  form += `Metode Pengiriman: ${order.delivery_method || 'Pickup'}\n\n`;
  form += `Biaya Pengiriman (Rp): ${deliveryFeeFormatted}\n\n`;
  form += `Notes:\n${notesText}\n\n`;
  form += `Mendapatkan info Dawet Kemayu Menteng dari:\n`;
  form += `${order.source || 'Teman / Instagram / Facebook / TikTok / Lainnya'}`;

  return form;
}

/**
 * Handle /edit command
 * Updates order with new data from form
 */
export async function handleEditOrder(chatId, userId, messageText, sendMessage, replyToMessage = null) {
  logger.debug(`[EDIT_ORDER] Command received - chatId: ${chatId}, userId: ${userId}`);
  
  try {
    // Check admin access
    if (!(await requireAdmin(userId, sendMessage, chatId))) {
      return;
    }

    // Extract order ID and form data
    let orderId = null;
    let formText = '';
    
    // Method 1: Check if form is in reply_to_message
    if (replyToMessage && replyToMessage.text) {
      formText = replyToMessage.text.trim();
      // Extract order ID from command message (first line)
      const commandMatch = messageText.match(/^\/edit\s+(DKM\/\d{8}\/\d{6})/i);
      if (commandMatch) {
        orderId = commandMatch[1];
      }
      logger.debug(`[EDIT_ORDER] Using reply_to_message - orderId: ${orderId}, form length: ${formText.length}`);
    } else {
      // Method 2: Extract from same message
      // Format: /edit ORDER_ID\n[form] - form starts after first newline
      const lines = messageText.split('\n');
      const firstLine = lines[0] || '';
      
      // Try to extract order ID from first line
      const orderIdMatch = firstLine.match(/^\/edit\s+(DKM\/\d{8}\/\d{6})/i);
      if (orderIdMatch) {
        orderId = orderIdMatch[1];
        // Form is everything after first line (remove empty lines at start)
        formText = lines.slice(1).join('\n').trim();
        logger.debug(`[EDIT_ORDER] Extracted from same message - orderId: ${orderId}, form length: ${formText.length}`);
      } else {
        // Fallback: Try to find order ID anywhere in message
        const orderIdPattern = /(DKM\/\d{8}\/\d{6})/i;
        const globalMatch = messageText.match(orderIdPattern);
        if (globalMatch) {
          orderId = globalMatch[1];
          // Remove command line and order ID from form text
          formText = messageText
            .replace(/^\/edit\s*/i, '')
            .replace(new RegExp(orderId, 'gi'), '')
            .trim();
          logger.debug(`[EDIT_ORDER] Found order ID in message - orderId: ${orderId}, form length: ${formText.length}`);
        }
      }
    }

    // Validate order ID
    if (!orderId || !orderId.trim()) {
      await sendMessage(
        chatId,
        '❌ Format: /edit <ORDER_ID>\n\n' +
        'Kemudian kirim form pesanan yang sudah diupdate.\n\n' +
        '**Contoh penggunaan (1 pesan):**\n' +
        '/edit DKM/20260110/000037\n\n' +
        'Nama Pemesan: Novi\n' +
        'No HP Penerima: 081234567\n' +
        'Alamat Penerima: ...\n' +
        '(form lengkap)\n\n' +
        '**Atau (2 pesan):**\n' +
        '1. Ketik: /edit DKM/20260110/000037\n' +
        '2. Reply pesan tersebut dengan form yang sudah diedit'
      );
      return;
    }

    const trimmedOrderId = orderId.trim();
    
    // Validate form text
    if (!formText || formText.length < 50) {
      await sendMessage(
        chatId,
        '❌ Form pesanan tidak ditemukan atau terlalu pendek.\n\n' +
        'Pastikan Anda mengirim form pesanan lengkap setelah perintah /edit.\n\n' +
        '**Format:**\n' +
        '/edit DKM/20260110/000037\n\n' +
        'Nama Pemesan: ...\n' +
        'No HP Penerima: ...\n' +
        'Alamat Penerima: ...\n' +
        '(form lengkap)'
      );
      return;
    }

    logger.debug(`[EDIT_ORDER] Looking up order: ${trimmedOrderId}`);

    // Fetch existing order
    const existingOrder = await getOrderById(trimmedOrderId);
    
    if (!existingOrder) {
      await sendMessage(chatId, `❌ Order ID "${trimmedOrderId}" tidak ditemukan.`);
      return;
    }

    logger.debug(`✅ [EDIT_ORDER] Order found: ${existingOrder.id}`);

    // Parse the updated form
    logger.debug(`[EDIT_ORDER] Parsing form text (${formText.length} chars)...`);
    const parsedOrder = parseOrderFromMessageAuto(formText);
    
    // Log parsed items for debugging
    logger.debug(`[EDIT_ORDER] Parsed items:`, JSON.stringify(parsedOrder.items, null, 2));
    logger.debug(`[EDIT_ORDER] Parsed items count: ${parsedOrder.items.length}`);
    parsedOrder.items.forEach((item, idx) => {
      logger.debug(`[EDIT_ORDER] Item ${idx + 1}: ${item.quantity}x ${item.name}`);
    });
    
    const validation = validateOrder(parsedOrder);

    if (!validation.valid) {
      await sendMessage(
        chatId,
        `❌ **Form tidak valid**\n\n` +
        `Kesalahan:\n${validation.errors.join('\n')}\n\n` +
        `Silakan perbaiki dan coba lagi.`
      );
      return;
    }

    // Prepare updated order data - merge parsed form with existing order
    // Support partial updates: only update fields that are provided in form
    // For fields not in form, keep existing values
    const updatedOrderData = {
      id: trimmedOrderId, // Keep same order ID (required for update)
    };
    
    // Track which fields changed (for logging)
    const changedFields = [];
    
    // Merge strategy: Use parsed value if provided, otherwise keep existing
    // Required fields (always update if provided in form)
    if (parsedOrder.customer_name) {
      if (parsedOrder.customer_name !== existingOrder.customer_name) {
        updatedOrderData.customer_name = parsedOrder.customer_name;
        changedFields.push('customer_name');
      } else {
        updatedOrderData.customer_name = existingOrder.customer_name;
      }
    } else {
      updatedOrderData.customer_name = existingOrder.customer_name;
    }
    
    if (parsedOrder.phone_number) {
      if (parsedOrder.phone_number !== existingOrder.phone_number) {
        updatedOrderData.phone_number = parsedOrder.phone_number;
        changedFields.push('phone_number');
      } else {
        updatedOrderData.phone_number = existingOrder.phone_number;
      }
    } else {
      updatedOrderData.phone_number = existingOrder.phone_number;
    }
    
    if (parsedOrder.address) {
      if (parsedOrder.address !== existingOrder.address) {
        updatedOrderData.address = parsedOrder.address;
        changedFields.push('address');
      } else {
        updatedOrderData.address = existingOrder.address;
      }
    } else {
      updatedOrderData.address = existingOrder.address;
    }
    
    // Optional fields - update if provided, keep existing if not
    updatedOrderData.receiver_name = parsedOrder.receiver_name !== null && parsedOrder.receiver_name !== undefined 
      ? parsedOrder.receiver_name 
      : (existingOrder.receiver_name || '');
    if (updatedOrderData.receiver_name !== (existingOrder.receiver_name || '')) {
      changedFields.push('receiver_name');
    }
    
    updatedOrderData.event_name = parsedOrder.event_name !== null && parsedOrder.event_name !== undefined 
      ? parsedOrder.event_name 
      : (existingOrder.event_name || '');
    if (updatedOrderData.event_name !== (existingOrder.event_name || '')) {
      changedFields.push('event_name');
    }
    
    updatedOrderData.event_duration = parsedOrder.event_duration !== null && parsedOrder.event_duration !== undefined 
      ? parsedOrder.event_duration 
      : (existingOrder.event_duration || '');
    if (updatedOrderData.event_duration !== (existingOrder.event_duration || '')) {
      changedFields.push('event_duration');
    }
    
    updatedOrderData.event_date = parsedOrder.event_date || (existingOrder.event_date || '');
    if (updatedOrderData.event_date !== (existingOrder.event_date || '')) {
      changedFields.push('event_date');
    }
    
    updatedOrderData.delivery_time = parsedOrder.delivery_time || (existingOrder.delivery_time || '');
    if (updatedOrderData.delivery_time !== (existingOrder.delivery_time || '')) {
      changedFields.push('delivery_time');
    }
    
    // Items - update if provided in form
    // CRITICAL: Always use parsed items if they exist (form was provided)
    if (parsedOrder.items && parsedOrder.items.length > 0) {
      const existingItemsJson = JSON.stringify(existingOrder.items || []);
      const parsedItemsJson = JSON.stringify(parsedOrder.items);
      
      logger.debug(`[EDIT_ORDER] Comparing items:`);
      logger.debug(`[EDIT_ORDER] Existing: ${existingItemsJson}`);
      logger.debug(`[EDIT_ORDER] Parsed: ${parsedItemsJson}`);
      
      if (parsedItemsJson !== existingItemsJson) {
        updatedOrderData.items = parsedOrder.items; // Use parsed items (from form)
        changedFields.push('items');
        logger.debug(`[EDIT_ORDER] Items changed - using parsed items:`, JSON.stringify(parsedOrder.items));
      } else {
        updatedOrderData.items = existingOrder.items;
        logger.debug(`[EDIT_ORDER] Items unchanged - keeping existing`);
      }
    } else {
      // No items in form - keep existing
      updatedOrderData.items = existingOrder.items;
      logger.debug(`[EDIT_ORDER] No items in parsed form - keeping existing items`);
    }
    
    // Notes - update if provided in form
    if (parsedOrder.notes && parsedOrder.notes.length > 0) {
      const existingNotesJson = JSON.stringify(existingOrder.notes || []);
      const parsedNotesJson = JSON.stringify(parsedOrder.notes);
      if (parsedNotesJson !== existingNotesJson) {
        updatedOrderData.notes = parsedOrder.notes;
        changedFields.push('notes');
      } else {
        updatedOrderData.notes = existingOrder.notes;
      }
    } else {
      updatedOrderData.notes = existingOrder.notes;
    }
    
    // Delivery method - update if provided
    updatedOrderData.delivery_method = parsedOrder.delivery_method || (existingOrder.delivery_method || 'Pickup');
    if (updatedOrderData.delivery_method !== (existingOrder.delivery_method || 'Pickup')) {
      changedFields.push('delivery_method');
    }
    
    // Delivery fee - update if provided (handle null/0 explicitly)
    const existingDeliveryFee = existingOrder.delivery_fee !== null && existingOrder.delivery_fee !== undefined ? existingOrder.delivery_fee : null;
    const parsedDeliveryFee = parsedOrder.delivery_fee !== null && parsedOrder.delivery_fee !== undefined ? parsedOrder.delivery_fee : null;
    
    // If delivery_fee is explicitly provided in form (even if 0), use it
    // Otherwise keep existing
    if (parsedOrder.delivery_fee !== null && parsedOrder.delivery_fee !== undefined) {
      updatedOrderData.delivery_fee = parsedDeliveryFee;
      if (parsedDeliveryFee !== existingDeliveryFee) {
        changedFields.push('delivery_fee');
      }
    } else {
      updatedOrderData.delivery_fee = existingDeliveryFee;
    }
    
    // Preserve existing metadata (don't change on edit)
    updatedOrderData.status = existingOrder.status || 'pending';
    updatedOrderData.created_at = existingOrder.created_at;
    updatedOrderData.conversation_id = existingOrder.conversation_id || '';
    
    // Log what changed
    if (changedFields.length > 0) {
      logger.debug(`[EDIT_ORDER] Changed fields: ${changedFields.join(', ')}`);
    } else {
      logger.debug(`[EDIT_ORDER] No fields changed (form matches existing order)`);
    }

    // Save updated order (saveOrder handles upsert - updates if exists, creates if new)
    // saveOrder will calculate totals including packaging fee and save to Google Sheets
    logger.debug(`[EDIT_ORDER] Saving order ${trimmedOrderId} to Google Sheets...`);
    
    // CRITICAL: Log what we're about to save
    logger.debug(`[EDIT_ORDER] About to save order with items:`, JSON.stringify(updatedOrderData.items, null, 2));
    logger.debug(`[EDIT_ORDER] Items JSON string:`, JSON.stringify(updatedOrderData.items));
    
    // CRITICAL: Save order to Google Sheets - this MUST persist the update
    const savedOrder = await saveOrder(updatedOrderData);
    
    logger.debug(`[EDIT_ORDER] Order saved successfully. Totals:`, {
      productTotal: savedOrder.productTotal,
      packagingFee: savedOrder.packagingFee,
      deliveryFee: savedOrder.deliveryFee,
      totalAmount: savedOrder.totalAmount
    });
    
    // CRITICAL: Re-read order from Google Sheets to verify update persisted
    // This ensures we display what's actually in the sheet, not what we think we saved
    logger.debug(`[EDIT_ORDER] Re-reading order from Google Sheets to verify update...`);
    
    // Wait a moment for Google Sheets to update (sometimes there's a slight delay)
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const verifiedOrder = await getOrderById(trimmedOrderId);
    
    if (!verifiedOrder) {
      logger.error(`[EDIT_ORDER] CRITICAL: Order ${trimmedOrderId} not found after save!`);
      await sendMessage(chatId, `❌ Error: Order tidak ditemukan setelah update. Silakan coba lagi.`);
      return;
    }
    
    logger.debug(`[EDIT_ORDER] Verified: Order ${trimmedOrderId} exists in Google Sheets`);
    logger.debug(`[EDIT_ORDER] Verified order items:`, JSON.stringify(verifiedOrder.items, null, 2));
    
    // Use verified order data for display (single source of truth)
    const displayOrder = verifiedOrder;

    // Get price list for display calculations
    const priceList = await getPriceList();
    
    // Use verified order from Google Sheets (single source of truth)
    const displayItems = displayOrder.items || [];
    
    // CRITICAL: Log what we're displaying
    logger.debug(`[EDIT_ORDER] Display items from verified order:`, JSON.stringify(displayItems, null, 2));
    displayItems.forEach((item, idx) => {
      logger.debug(`[EDIT_ORDER] Display item ${idx + 1}: ${item.quantity}x ${item.name}`);
    });
    
    const calculation = calculateOrderTotal(displayItems, priceList);

    // Calculate packaging info (for display) from verified order
    let totalCups = 0;
    let hasPackagingRequest = false;
    
    // Count total cups from items (Dawet Small/Medium/Large, excluding botol)
    displayItems.forEach(item => {
      const itemName = (item.name || '').toLowerCase();
      if (itemName.includes('dawet') && 
          (itemName.includes('small') || itemName.includes('medium') || itemName.includes('large'))) {
        if (!itemName.includes('botol')) {
          totalCups += parseInt(item.quantity || 0);
        }
      }
    });
    
    // Check if packaging is requested in notes
    const notes = displayOrder.notes || [];
    hasPackagingRequest = notes.some(note => {
      const noteLower = String(note || '').toLowerCase().trim();
      return noteLower.includes('packaging styrofoam') && 
             (noteLower.includes(': ya') || noteLower.includes(': yes') || 
              noteLower === 'packaging styrofoam: ya' || noteLower === 'packaging styrofoam: yes');
    });
    
    // Calculate required packaging boxes (1 box per 50 cups, rounded up)
    const packagingBoxes = hasPackagingRequest && totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
    
    // Use packaging fee from saved order (calculated by computeOrderTotals)
    const packagingFee = savedOrder.packagingFee || (packagingBoxes * 40000);

    // Format update summary using verified order data
    let summary = `✅ **ORDER UPDATED**\n\n`;
    summary += `📋 Order ID: ${trimmedOrderId}\n`;
    summary += `👤 Customer: ${displayOrder.customer_name || 'N/A'}\n`;
    summary += `📞 Phone: ${displayOrder.phone_number || 'N/A'}\n`;
    summary += `📍 Address: ${displayOrder.address || 'N/A'}\n`;
    if (displayOrder.event_name) {
      summary += `📅 Event: ${displayOrder.event_name}\n`;
    }
    if (displayOrder.event_date) {
      summary += `📅 Event Date: ${displayOrder.event_date}\n`;
    }
    if (displayOrder.delivery_time) {
      summary += `🕐 Delivery Time: ${displayOrder.delivery_time}\n`;
    }
    if (displayOrder.delivery_method) {
      summary += `🚚 Delivery Method: ${displayOrder.delivery_method}\n`;
    }
    summary += `\n📦 **Items:**\n`;
    
    // Display regular items (filter out any packaging items that might be in the list)
    let itemIndex = 1;
    calculation.itemDetails.forEach((item) => {
      const itemName = (item.name || '').toLowerCase();
      // Skip packaging items (we'll add calculated one below)
      if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
        return;
      }
      summary += `${itemIndex}. ${item.name} (${item.quantity}x)\n`;
      if (item.itemTotal > 0) {
        summary += `   Subtotal: Rp ${formatPrice(item.itemTotal)}\n`;
      }
      itemIndex++;
    });
    
    // Add packaging item if requested (use saved packaging fee from computeOrderTotals)
    if (hasPackagingRequest && packagingBoxes > 0 && packagingFee > 0) {
      summary += `${itemIndex}. Packaging Styrofoam (50 cup) (${packagingBoxes}x)\n`;
      summary += `   Subtotal: Rp ${formatPrice(packagingFee)}\n`;
    }
    
    // Use totals from savedOrder (which includes packaging fee calculated by computeOrderTotals)
    const productTotal = savedOrder.productTotal || calculation.subtotal;
    const totalWithPackaging = productTotal + packagingFee;
    const deliveryFee = savedOrder.deliveryFee || displayOrder.delivery_fee || 0;
    const grandTotal = savedOrder.totalAmount || (totalWithPackaging + deliveryFee);
    
    summary += `\n💰 **Product Total: Rp ${formatPrice(productTotal)}**\n`;
    if (packagingFee > 0) {
      summary += `📦 **Packaging Fee: Rp ${formatPrice(packagingFee)}**\n`;
    }
    summary += `💰 **Subtotal: Rp ${formatPrice(totalWithPackaging)}**\n`;
    if (deliveryFee > 0) {
      summary += `🚚 **Delivery Fee: Rp ${formatPrice(deliveryFee)}**\n`;
    }
    summary += `💰 **Grand Total: Rp ${formatPrice(grandTotal)}**\n`;
    summary += `\n✅ Order berhasil diperbarui!`;

    await sendMessage(chatId, summary);
    logger.debug(`✅ [EDIT_ORDER] Order ${trimmedOrderId} updated successfully in Google Sheets`);
  } catch (error) {
    logger.error('[EDIT_ORDER] Error:', error);
    logger.error('[EDIT_ORDER] Stack:', error.stack);
    await sendMessage(chatId, `❌ Maaf, ada error saat memproses perintah ini: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Handle /cancel command
 * Cancel an order (admin only)
 */
export async function handleCancel(chatId, userId, orderId, sendMessage) {
  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
    return;
  }

  if (!orderId) {
    await sendMessage(chatId, '❌ Format: `/cancel <ORDER_ID>`\n\nContoh: `/cancel DKM/20260110/000005`');
    return;
  }

  try {
    const order = await getOrderById(orderId);
    if (!order) {
      await sendMessage(chatId, `❌ Order \`${orderId}\` tidak ditemukan.`);
      return;
    }

    // Check if already cancelled or completed
    const currentStatus = order.status || '';
    if (currentStatus.toLowerCase() === ORDER_STATUS.CANCELLED || currentStatus.toLowerCase() === ORDER_STATUS.COMPLETED) {
      await sendMessage(
        chatId,
        `ℹ️ Order \`${orderId}\` sudah berstatus: **${currentStatus}**\n\n` +
        'Tidak dapat dibatalkan lagi.'
      );
      return;
    }

    // Update status to CANCELLED
    await updateOrderStatus(orderId, ORDER_STATUS.CANCELLED);
    
    // Try to notify customer (if conversation_id exists)
    // Note: sendMessage function is not available here, so we'll skip customer notification
    // Customer will see status update when they check order status
    console.log(`ℹ️ [CANCEL] Customer notification skipped (use order-status-notifications for full notification)`);

    await sendMessage(
      chatId,
      `✅ Order \`${orderId}\` berhasil dibatalkan.\n\n` +
      `Status: **CANCELLED**\n` +
      `Alasan: Dibatalkan oleh admin`
    );
  } catch (error) {
    console.error('❌ [CANCEL] Error cancelling order:', error);
    console.error('❌ [CANCEL] Stack:', error.stack);
    await sendMessage(chatId, `❌ Terjadi kesalahan: ${error.message || 'Gagal membatalkan pesanan.'}`);
  }
}

/**
 * Handle /complete command
 * Mark an order as completed (admin only)
 */
export async function handleComplete(chatId, userId, orderId, sendMessage) {
  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
    return;
  }

  if (!orderId) {
    await sendMessage(chatId, '❌ Format: `/complete <ORDER_ID>`\n\nContoh: `/complete DKM/20260110/000005`');
    return;
  }

  try {
    const order = await getOrderById(orderId);
    if (!order) {
      await sendMessage(chatId, `❌ Order \`${orderId}\` tidak ditemukan.`);
      return;
    }

    // Check if already cancelled
    const currentStatus = order.status || '';
    if (currentStatus.toLowerCase() === ORDER_STATUS.CANCELLED) {
      await sendMessage(
        chatId,
        `❌ Order \`${orderId}\` sudah dibatalkan. Tidak dapat diselesaikan.`
      );
      return;
    }

    // Check if already completed
    if (currentStatus.toLowerCase() === ORDER_STATUS.COMPLETED) {
      await sendMessage(
        chatId,
        `ℹ️ Order \`${orderId}\` sudah berstatus: **COMPLETED**`
      );
      return;
    }

    // Warn if not in delivered/confirmed state (preferred: require DELIVERED)
    if (currentStatus.toLowerCase() !== 'delivered' && currentStatus.toLowerCase() !== ORDER_STATUS.CONFIRMED) {
      console.warn(`⚠️ [COMPLETE] Order ${orderId} status is ${currentStatus}, not DELIVERED/CONFIRMED`);
      // Continue anyway but log warning
    }

    // Update status to COMPLETED
    await updateOrderStatus(orderId, ORDER_STATUS.COMPLETED);
    
    // Try to notify customer (if conversation_id exists)
    // Note: sendMessage function is not available here, so we'll skip customer notification
    // Customer will see status update when they check order status
    console.log(`ℹ️ [COMPLETE] Customer notification skipped (use order-status-notifications for full notification)`);

    await sendMessage(
      chatId,
      `✅ Order \`${orderId}\` berhasil ditandai sebagai selesai.\n\n` +
      `Status: **COMPLETED**`
    );
  } catch (error) {
    console.error('❌ [COMPLETE] Error completing order:', error);
    console.error('❌ [COMPLETE] Stack:', error.stack);
    await sendMessage(chatId, `❌ Terjadi kesalahan: ${error.message || 'Gagal menyelesaikan pesanan.'}`);
  }
}
