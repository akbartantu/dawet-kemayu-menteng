/**
 * Admin Bot Commands
 * Handles admin-specific bot commands for order and payment management
 * Implements PRD Admin Assistant requirements
 */

import logger from './logger.js';
import { 
  getAllOrders, 
  getOrderById, 
  saveOrder, 
  generateOrderId,
  getPriceList,
  getUserRole,
  upsertUserRole
} from './google-sheets.js';
import { 
  calculateOrderTotal, 
  formatPrice 
} from './price-calculator.js';
import { 
  parseOrderFromMessage,
  parseOrderFromMessageAuto,
  validateOrder 
} from './order-parser.js';
import { 
  calculatePaymentStatus, 
  calculateRemainingBalance, 
  calculateMinDP,
  formatPaymentStatusMessage,
  validatePaymentStatusTransition 
} from './payment-tracker.js';
import { updateOrderPayment } from './google-sheets.js';
import { 
  getJakartaTodayISO, 
  addDaysJakarta, 
  toISODateJakarta 
} from './date-utils.js';

/**
 * Handle /admin_auth command - Bootstrap admin using setup code
 * @param {string} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {string} messageText - Full message text
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleAdminAuth(chatId, userId, messageText, sendMessage) {
  try {
    const parts = messageText.split(' ');
    const code = parts[1];
    
    if (!code) {
      await sendMessage(chatId, '❌ Format: /admin_auth <CODE>\n\nMasukkan kode setup admin yang valid.');
      return;
    }
    
    const setupCode = process.env.ADMIN_SETUP_CODE;
    if (!setupCode) {
      await sendMessage(chatId, '❌ Admin setup tidak dikonfigurasi. Hubungi administrator sistem.');
      console.error('⚠️ ADMIN_SETUP_CODE not set in environment variables');
      return;
    }
    
    if (code !== setupCode) {
      await sendMessage(chatId, '❌ Kode tidak valid. Silakan coba lagi.');
      return;
    }
    
    // Get user info from Telegram message context
    // We need display name - try to get from message or use default
    const displayName = 'Admin User'; // Could be enhanced to get from message.from
    
    // Grant admin role
    await upsertUserRole('telegram', String(userId), displayName, 'admin', true);
    
    await sendMessage(
      chatId,
      '✅ **Akses Admin Diberikan!**\n\n' +
      'Anda sekarang memiliki akses admin. Perintah admin tersedia:\n' +
      '• /new_order\n' +
      '• /parse_order\n' +
      '• /order_detail <ORDER_ID>\n' +
      '• /status <ORDER_ID>\n' +
      '• /pay <ORDER_ID> <AMOUNT>\n' +
      '• /payment_status <ORDER_ID>\n' +
      '• /today_reminder'
    );
    
    console.log(`✅ Admin access granted to user ${userId} via /admin_auth`);
  } catch (error) {
    console.error('❌ Error in handleAdminAuth:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat memberikan akses admin. Silakan coba lagi.');
  }
}
/**
 * Check if user is authorized admin
 * Uses Users sheet for role lookup, falls back to env var for backward compatibility
 * Handles number/string mismatches and platform normalization
 * @param {number|string} telegramUserId - Telegram user ID (can be number or string)
 * @returns {Promise<boolean>} True if user is admin
 */
export async function isAdmin(telegramUserId) {
  if (!telegramUserId) {
    logger.warn('[ADMIN_CHECK] No userId provided');
    return false;
  }
  
  // Normalize userId to string and number for flexible matching
  const userIdString = String(telegramUserId);
  const userIdNumber = typeof telegramUserId === 'number' ? telegramUserId : parseInt(userIdString);
  
  logger.debug(`[ADMIN_CHECK] Checking admin status - userId: ${telegramUserId}`);
  
  try {
    // First check Users sheet - try both string and number formats
    let role = await getUserRole('telegram', userIdString);
    
    // If not found with string, try with number as string
    if (!role || role === 'customer') {
      role = await getUserRole('telegram', String(userIdNumber));
    }
    
    logger.debug(`[ADMIN_CHECK] Users sheet lookup - role: ${role || 'not found'}`);
    
    if (role === 'admin') {
      logger.debug(`[ADMIN_CHECK] User ${telegramUserId} is admin (from Users sheet)`);
      return true;
    }
    
    // Fallback to env var for backward compatibility
    const adminIds = process.env.ADMIN_TELEGRAM_USER_IDS 
      ? process.env.ADMIN_TELEGRAM_USER_IDS.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
      : [];
    
    const isEnvAdmin = adminIds.includes(userIdNumber);
    if (isEnvAdmin) {
      logger.debug(`[ADMIN_CHECK] User ${telegramUserId} is admin (from env var)`);
      return true;
    }
    
    logger.debug(`[ADMIN_CHECK] User ${telegramUserId} is NOT admin (role: ${role || 'customer'})`);
    return false;
  } catch (error) {
    logger.error('[ADMIN_CHECK] Error checking admin status:', error);
    
    // Fallback to env var on error
    const adminIds = process.env.ADMIN_TELEGRAM_USER_IDS 
      ? process.env.ADMIN_TELEGRAM_USER_IDS.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
      : [];
    
    const isEnvAdmin = adminIds.includes(userIdNumber);
    if (isEnvAdmin) {
      logger.debug(`[ADMIN_CHECK] User ${telegramUserId} is admin (from env var fallback)`);
      return true;
    }
    
    return false;
  }
}

/**
 * Require admin role - throws error if not admin
 * @param {number} userId - Telegram user ID
 * @param {Function} sendMessage - Function to send error message
 * @returns {Promise<boolean>} True if admin, false otherwise (sends error message)
 */
export async function requireAdmin(userId, sendMessage, chatId) {
  const isUserAdmin = await isAdmin(userId);
  if (!isUserAdmin) {
    await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini. Perintah ini hanya untuk admin.');
    return false;
  }
  return true;
}

/**
 * Handle /new_order command
 * Creates empty order with generated ID
 * @param {Function} sendMessage - Function to send Telegram message
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

    // Generate order ID
    const orderId = await generateOrderId();
    
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
      delivery_fee: parsedOrder.delivery_fee !== null && parsedOrder.delivery_fee !== undefined ? parsedOrder.delivery_fee : 0, // Biaya Pengiriman (Ongkir) - default to 0 if not provided
      delivery_method: parsedOrder.delivery_method || null, // Metode pengiriman (stored in Orders.delivery_method)
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    // Save order
    await saveOrder(orderData);

    // Get price list and calculate totals
    const priceList = await getPriceList();
    const calculation = calculateOrderTotal(orderData.items, priceList);

    // Format order summary
    let summary = `✅ **ORDER SUMMARY**\n\n`;
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
    summary += `\n✅ Order berhasil disimpan!`;

    await sendMessage(chatId, summary);
  } catch (error) {
    console.error('❌ Error parsing order:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat memparse order. Silakan coba lagi.');
  }
}

/**
 * Handle /order_detail command
 * Shows full order details
 * @param {string|number} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {string} orderId - Order ID to look up
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleOrderDetail(chatId, userId, orderId, sendMessage) {
  console.log(`🔍 [ORDER_DETAIL] Command received - chatId: ${chatId}, userId: ${userId}, orderId: ${orderId || 'MISSING'}`);
  
  try {
    // Check admin access
    const isUserAdmin = await isAdmin(userId);
    console.log(`🔍 [ORDER_DETAIL] Admin check - userId: ${userId}, isAdmin: ${isUserAdmin}`);
    
    if (!isUserAdmin) {
      await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini. Perintah ini hanya untuk admin.');
      return;
    }

    if (!orderId || !orderId.trim()) {
      await sendMessage(chatId, '❌ Format: /order_detail <ORDER_ID>\n\nContoh: /order_detail DKM/20260104/000001');
      return;
    }

    const trimmedOrderId = orderId.trim();
    console.log(`🔍 [ORDER_DETAIL] Looking up order: ${trimmedOrderId}`);

    const order = await getOrderById(trimmedOrderId);
    
    if (!order) {
      await sendMessage(chatId, `❌ Order ID "${trimmedOrderId}" tidak ditemukan.`);
      return;
    }

    console.log(`✅ [ORDER_DETAIL] Order found: ${order.id}`);

    // Get price list for calculation
    const priceList = await getPriceList();
    const calculation = calculateOrderTotal(order.items || [], priceList);

    // Format order detail with comprehensive information
    let detail = `📋 **ORDER DETAIL**\n\n`;
    detail += `**Order ID:** ${order.id}\n`;
    detail += `**Status:** ${order.status || 'N/A'}\n`;
    
    // Payment info if available
    if (order.payment_status) {
      detail += `**Payment Status:** ${order.payment_status}\n`;
      if (order.paid_amount) {
        detail += `**Paid:** Rp ${formatPrice(order.paid_amount)}\n`;
      }
      if (order.remaining_balance !== undefined) {
        detail += `**Remaining:** Rp ${formatPrice(order.remaining_balance)}\n`;
      }
    }
    
    detail += `\n👤 **Customer Info:**\n`;
    detail += `Nama Pemesan: ${order.customer_name || 'N/A'}\n`;
    if (order.receiver_name && order.receiver_name !== order.customer_name) {
      detail += `Nama Penerima: ${order.receiver_name}\n`;
    }
    detail += `Phone: ${order.phone_number || 'N/A'}\n`;
    detail += `Address: ${order.address || 'N/A'}\n`;
    
    if (order.event_name || order.event_date) {
      detail += `\n📅 **Event Info:**\n`;
      detail += `Event: ${order.event_name || 'N/A'}\n`;
      if (order.event_date) {
        detail += `Date: ${order.event_date}\n`;
      }
      if (order.delivery_time) {
        detail += `Time: ${order.delivery_time}\n`;
      }
      if (order.delivery_method || order.shipping_method) {
        detail += `🚚 Delivery Method: ${order.delivery_method || order.shipping_method}\n`;
      }
    }

    detail += `\n📦 **Items:**\n`;
    if (order.items && order.items.length > 0) {
      order.items.forEach((item, index) => {
        detail += `${index + 1}. ${item.quantity}x ${item.name}\n`;
      });
    } else {
      detail += `Tidak ada items\n`;
    }

    detail += `\n💰 **Total: Rp ${formatPrice(calculation.subtotal)}**\n`;
    
    // Use total_amount (canonical) with fallback to final_total (legacy)
    const totalAmount = order.total_amount || order.final_total;
    if (totalAmount && totalAmount !== calculation.subtotal) {
      detail += `**Total Amount: Rp ${formatPrice(totalAmount)}**\n`;
    }
    
    if (order.notes && order.notes.length > 0) {
      detail += `\n📝 **Notes:**\n${order.notes.join('\n')}\n`;
    }
    
    if (order.created_at) {
      detail += `\n📅 **Created:** ${new Date(order.created_at).toLocaleString('id-ID')}\n`;
    }
    if (order.updated_at) {
      detail += `**Updated:** ${new Date(order.updated_at).toLocaleString('id-ID')}\n`;
    }

    await sendMessage(chatId, detail);
    console.log(`✅ [ORDER_DETAIL] Successfully sent order details for ${trimmedOrderId}`);
  } catch (error) {
    console.error('❌ [ORDER_DETAIL] Error getting order detail:', error);
    console.error('❌ [ORDER_DETAIL] Stack:', error.stack);
    await sendMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
  }
}

/**
 * Handle /status command
 * Quick status check
 * @param {Function} sendMessage - Function to send Telegram message
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
 * Handle /pay command
 * Update payment for an order (accumulates with existing paid amount)
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handlePay(chatId, userId, orderId, amountInput, sendMessage) {
  console.log(`🔍 [PAY] Command received - chatId: ${chatId}, userId: ${userId}, orderId: ${orderId || 'MISSING'}, amountInput: ${amountInput || 'MISSING'}`);
  
  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
    return;
  }

  if (!orderId || !amountInput) {
    await sendMessage(chatId, '❌ Format: /pay <ORDER_ID> <AMOUNT>\n\nContoh: /pay DKM/20260104/000001 235.000\nAtau: /pay DKM/20260104/000001 Rp 235.000');
    return;
  }

  try {
    // Parse Indonesian currency format
    const { parseIDRAmount } = await import('./payment-tracker.js');
    const newPaymentAmount = parseIDRAmount(amountInput);
    
    if (newPaymentAmount === null) {
      await sendMessage(
        chatId,
        '❌ Format jumlah pembayaran tidak valid.\n\n' +
        'Format yang diterima:\n' +
        '• 235.000\n' +
        '• 235,000\n' +
        '• Rp 235.000\n' +
        '• 235000\n\n' +
        'Contoh: /pay DKM/20260104/000001 235.000'
      );
      return;
    }

    console.log(`🔍 [PAY] Parsed amount: ${newPaymentAmount} (from input: "${amountInput}")`);

    // Update payment (will accumulate with existing)
    const result = await updateOrderPayment(orderId, newPaymentAmount);
    
    console.log(`✅ [PAY] Payment updated - Order: ${orderId}, New Payment: ${newPaymentAmount}, Total Paid: ${result.paidAmount}, Status: ${result.paymentStatus}`);
    
    const message = formatPaymentStatusMessage({
      id: result.orderId,
      total_amount: result.totalAmount || result.finalTotal, // Use totalAmount (canonical)
      final_total: result.finalTotal, // Keep for backward compatibility
      paid_amount: result.paidAmount,
      payment_status: result.paymentStatus,
      remaining_balance: result.remainingBalance,
    });

    await sendMessage(chatId, message);
  } catch (error) {
    console.error('❌ [PAY] Error updating payment:', error);
    console.error('❌ [PAY] Stack:', error.stack);
    // Return early - do NOT show status card after error
    await sendMessage(chatId, `❌ Terjadi kesalahan: ${error.message || 'Gagal memperbarui pembayaran. Silakan coba lagi.'}`);
    return; // Early return to prevent any further processing
  }
}

/**
 * Handle /payment_status command
 * Show payment status only
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handlePaymentStatus(chatId, userId, orderId, sendMessage) {
  if (!(await requireAdmin(userId, sendMessage, chatId))) {
    await sendMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
    return;
  }

  if (!orderId) {
    await sendMessage(chatId, '❌ Format: /payment_status <order_id>');
    return;
  }

  try {
    const order = await getOrderById(orderId);
    
    if (!order) {
      await sendMessage(chatId, `❌ Order ${orderId} tidak ditemukan.`);
      return;
    }

    const message = formatPaymentStatusMessage(order);
    await sendMessage(chatId, message);
  } catch (error) {
    console.error('❌ Error getting payment status:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil status pembayaran.');
  }
}

/**
 * Get orders by event date
 * @param {string} targetDate - Date in YYYY-MM-DD format
 * @param {string} paymentStatusFilter - Optional payment status filter (e.g., 'FULLPAID', 'PAID', 'UNPAID')
 * @returns {Promise<Array>} Array of orders sorted by delivery_time
 */
/**
 * Get orders by ISO date (centralized filter function)
 * @param {string} targetISO - Target date in YYYY-MM-DD format (must be normalized)
 * @param {string} paymentStatusFilter - Optional payment status filter
 * @returns {Promise<Array>} Array of orders matching the date
 */
async function getOrdersByISODate(targetISO, paymentStatusFilter = null) {
  try {
    logger.debug(`[ORDERS_FILTER] targetISO="${targetISO}"`);
    
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
        // Skip invalid dates silently in production
        logger.debug(`[ORDERS_FILTER] raw="${orderDate}" normalized=null (skipping)`);
        return false;
      }
      
      // Compare normalized ISO dates
      return normalizedOrderDate === targetISO;
    });
    
    logger.debug(`[ORDERS_FILTER] targetISO="${targetISO}" matched=${filteredOrders.length} total=${allOrders.length}`);
    
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
        logger.warn(`[GET_ORDERS_BY_ISO_DATE] Duplicate order_id found: ${orderId} (skipping duplicate)`);
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
      logger.debug(`[GET_ORDERS_BY_ISO_DATE] Filtered by payment_status="${paymentStatusFilter}": ${uniqueOrders.length} -> ${finalOrders.length} orders`);
    }
    
    // Sort by delivery_time (HH:MM format, lexicographically safe)
    finalOrders.sort((a, b) => {
      const timeA = (a.delivery_time || '').trim() || '99:99'; // Missing times go to bottom
      const timeB = (b.delivery_time || '').trim() || '99:99';
      return timeA.localeCompare(timeB);
    });
    
    return finalOrders;
  } catch (error) {
    logger.error('[GET_ORDERS_BY_ISO_DATE] Error:', error);
    throw error;
  }
}

/**
 * Get orders by event date (legacy wrapper - now uses getOrdersByISODate)
 * @param {string} targetDate - Date in YYYY-MM-DD format or other formats
 * @param {string} paymentStatusFilter - Optional payment status filter
 * @returns {Promise<Array>} Array of orders sorted by delivery_time
 */
async function getOrdersByDate(targetDate, paymentStatusFilter = null) {
  // Normalize target date to ISO format (YYYY-MM-DD) in Asia/Jakarta
  const targetDateISO = toISODateJakarta(targetDate);
  if (!targetDateISO) {
    logger.error(`[GET_ORDERS_BY_DATE] Invalid target date: ${targetDate}`);
    throw new Error(`Invalid target date: ${targetDate}`);
  }
  
  logger.debug(`[ORDERS_DATE] targetDate="${targetDate}" normalized="${targetDateISO}"`);
  
  // Use centralized filter function
  return await getOrdersByISODate(targetDateISO, paymentStatusFilter);
}

/**
 * Format items list for recap (bullet list format)
 * @param {Array|string} itemsJson - Order items array or JSON string
 * @returns {string} Formatted items string with bullet points
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
 * @param {Array|string} notesJson - Order notes array or JSON string
 * @returns {string} Formatted notes string with bullet points
 */
function formatNotesForRecap(notesJson) {
  try {
    // Handle empty/null/undefined
    if (!notesJson || notesJson === '' || notesJson === '[]' || notesJson === 'null') {
      return '- (tidak ada)';
    }
    
    // Parse if string
    let notes = notesJson;
    if (typeof notesJson === 'string') {
      // Try parsing as JSON
      try {
        notes = JSON.parse(notesJson);
      } catch (e) {
        // If not valid JSON, treat as plain string
        if (notesJson.trim()) {
          return `- ${notesJson}`;
        }
        return '- (tidak ada)';
      }
    }
    
    // Handle array
    if (Array.isArray(notes)) {
      if (notes.length === 0) {
        return '- (tidak ada)';
      }
      return notes.map(note => {
        const noteStr = typeof note === 'string' ? note : String(note || '');
        return noteStr.trim() ? `- ${noteStr.trim()}` : '- (tidak ada)';
      }).join('\n');
    }
    
    // Handle single string
    if (typeof notes === 'string' && notes.trim()) {
      return `- ${notes.trim()}`;
    }
    
    return '- (tidak ada)';
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
 * @param {Array} orders - Array of orders sorted by delivery_time
 * @param {string} date - Date string (YYYY-MM-DD)
 * @returns {string} Formatted recap message
 */
function formatRecapMessage(orders, date) {
  if (orders.length === 0) {
    return `Tidak ada pesanan untuk besok (${date}).`;
  }
  
  let message = `📋REKAP PESANAN (${date})\n`;
  message += `Total: ${orders.length} pesanan\n\n`;
  
  orders.forEach((order, index) => {
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
      let notes = notesData;
      if (typeof notesData === 'string') {
        try {
          notes = JSON.parse(notesData);
        } catch (e) {
          // If not valid JSON, treat as plain string
          if (notesData.trim()) {
            notes = [notesData.trim()];
          } else {
            notes = [];
          }
        }
      }
      
      if (Array.isArray(notes) && notes.length > 0) {
        // Filter out empty notes
        const validNotes = notes.filter(note => note && String(note).trim());
        if (validNotes.length > 0) {
          // Join all notes with newline (single line per note)
          notesStr = validNotes.map(note => String(note).trim()).join('\n');
        } else {
          notesStr = '-';
        }
      } else if (typeof notes === 'string' && notes.trim()) {
        notesStr = notes.trim();
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
    
    // Build order block (new format)
    message += `👤 Customer: ${customerName}\n`;
    message += `📞 Phone: ${phoneNumber}\n`;
    message += `📍 Address: ${address}\n\n`;
    message += `🕐 Delivery Time: ${deliveryTime}\n`;
    message += `🚚 Delivery Method: ${deliveryMethod}\n\n`;
    message += `📦 Items:\n${itemsList}`;
    message += `\n📝 Notes:\n${notesStr}\n\n`;
    message += `✅ Payment Status: ${paymentStatusText}\n\n`;
    
    // Add separator between orders (except for the last one)
    if (index < orders.length - 1) {
      message += `─────────────────\n\n`;
    }
  });
  
  return message;
}

/**
 * Format order list message (uses same detailed format as recap)
 * @param {Array} orders - Array of orders sorted by delivery_time
 * @param {string} date - Date string (YYYY-MM-DD)
 * @returns {string} Formatted list message
 */
function formatOrderListMessage(orders, date) {
  if (orders.length === 0) {
    // Ensure consistent empty response format
    return `📅 Tidak ada pesanan untuk tanggal ${date}.`;
  }
  
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
  
  uniqueOrders.forEach((order, index) => {
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
      let notes = notesData;
      if (typeof notesData === 'string') {
        try {
          notes = JSON.parse(notesData);
        } catch (e) {
          // If not valid JSON, treat as plain string
          if (notesData.trim()) {
            notes = [notesData.trim()];
          } else {
            notes = [];
          }
        }
      }
      
      if (Array.isArray(notes) && notes.length > 0) {
        // Filter out empty notes
        const validNotes = notes.filter(note => note && String(note).trim());
        if (validNotes.length > 0) {
          // Join all notes with newline (single line per note)
          notesStr = validNotes.map(note => String(note).trim()).join('\n');
        } else {
          notesStr = '-';
        }
      } else if (typeof notes === 'string' && notes.trim()) {
        notesStr = notes.trim();
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
    
    // Build order block (new format)
    message += `👤 Customer: ${customerName}\n`;
    message += `📞 Phone: ${phoneNumber}\n`;
    message += `📍 Address: ${address}\n\n`;
    message += `🕐 Delivery Time: ${deliveryTime}\n`;
    message += `🚚 Delivery Method: ${deliveryMethod}\n\n`;
    message += `📦 Items:\n${itemsList}`;
    message += `\n📝 Notes:\n${notesStr}\n\n`;
    message += `✅ Payment Status: ${paymentStatusText}\n\n`;
    
    // Add separator between orders (except for the last one)
    if (index < uniqueOrders.length - 1) {
      message += `─────────────────\n\n`;
    }
  });
  
  return message;
}

/**
 * Get today's date in YYYY-MM-DD format (local timezone)
 * @returns {string} Today's date
 */
/**
 * Get today's date in Asia/Jakarta timezone as ISO string (YYYY-MM-DD)
 * @returns {string} Today's date in YYYY-MM-DD format
 */
function getTodayDate() {
  return getJakartaTodayISO();
}

/**
 * Get tomorrow's date in Asia/Jakarta timezone as ISO string (YYYY-MM-DD)
 * @returns {string} Tomorrow's date in YYYY-MM-DD format
 */
function getTomorrowDate() {
  const todayISO = getJakartaTodayISO();
  return addDaysJakarta(todayISO, 1);
}

/**
 * Handle /recap_h1 command - Show tomorrow's orders recap
 * @param {string} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleRecapH1(chatId, userId, sendMessage) {
  try {
    logger.debug(`[RECAP_H1] Command received - userId: ${userId}, chatId: ${chatId}`);
    
    // Check admin access
    if (!(await isAdmin(userId))) {
      await sendMessage(chatId, 'Maaf, command ini hanya untuk admin.');
      return;
    }
    
    // Get tomorrow's date
    const tomorrow = getTomorrowDate();
    logger.debug(`[RECAP_H1] Fetching orders for tomorrow: ${tomorrow}`);
    
    // Get orders for tomorrow (filter by FULLPAID only)
    const orders = await getOrdersByDate(tomorrow, 'FULLPAID');
    logger.debug(`[RECAP_H1] Found ${orders.length} FULLPAID orders for ${tomorrow}`);
    
    // Format and send recap message
    const message = formatRecapMessage(orders, tomorrow);
    await sendMessage(chatId, message);
    
    logger.debug(`[RECAP_H1] Recap sent successfully`);
  } catch (error) {
    logger.error('[RECAP_H1] Error:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil rekapan pesanan. Silakan coba lagi.');
  }
}

/**
 * Handle /orders_date command - Show orders for a specific date
 * @param {string} chatId - Telegram chat ID
 * @param {number} userId - Telegram user ID
 * @param {string} dateStr - Date string (YYYY-MM-DD) or 'today' or 'tomorrow'
 * @param {Function} sendMessage - Function to send Telegram message
 */
export async function handleOrdersDate(chatId, userId, dateStr, sendMessage) {
  try {
    logger.debug(`[ORDERS_DATE] Command received - userId: ${userId}, dateStr: "${dateStr}"`);
    
    // Check admin access
    if (!(await isAdmin(userId))) {
      await sendMessage(chatId, 'Maaf, command ini hanya untuk admin.');
      return;
    }
    
    // Determine target date (normalized to ISO in Asia/Jakarta)
    let targetDate;
    if (dateStr === 'today' || dateStr === 'hari ini') {
      targetDate = getTodayDate();
      logger.debug(`[ORDERS_TODAY] todayISO=${targetDate}`);
    } else if (dateStr === 'tomorrow' || dateStr === 'besok') {
      targetDate = getTomorrowDate();
      logger.debug(`[ORDERS_TOMORROW] tomorrowISO=${targetDate}`);
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
    
    logger.debug(`[ORDERS_DATE] Fetching orders for date: ${targetDate} (normalized)`);
    
    // Get orders for target date (filter by FULLPAID only)
    const orders = await getOrdersByDate(targetDate, 'FULLPAID');
    logger.debug(`[ORDERS_DATE] Found ${orders.length} FULLPAID orders for ${targetDate}`);
    
    // Format and send list message
    const message = formatOrderListMessage(orders, targetDate);
    await sendMessage(chatId, message);
    
    logger.debug(`[ORDERS_DATE] Order list sent successfully`);
  } catch (error) {
    logger.error('[ORDERS_DATE] Error:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil daftar pesanan. Silakan coba lagi.');
  }
}
