/**
 * Order Status Notifications & Validation
 * Handles status transitions, validation, and customer notifications
 */

import { getConversationById } from '../repos/conversations.repo.js';
import { THANK_YOU_TRUST_EMOJI } from '../utils/messages.js';

/**
 * Valid status transitions (for system/customer actions)
 * Maps each status to allowed next statuses
 */
const STATUS_TRANSITIONS = {
  'pending': ['pending_confirmation', 'cancelled'],
  'pending_confirmation': ['confirmed', 'cancelled'],
  'confirmed': ['processing', 'cancelled'],
  'processing': ['ready', 'cancelled'],
  'ready': ['delivering', 'cancelled'],
  'delivering': ['completed', 'cancelled'],
  'completed': [], // Terminal state - no transitions allowed
  'cancelled': [], // Terminal state - no transitions allowed
  'waiting': ['pending_confirmation', 'cancelled'], // Waiting list orders
};

/**
 * Status transitions allowed for merchant actions only
 * Note: 'completed' should be set by customer, not merchant
 */
const MERCHANT_STATUS_TRANSITIONS = {
  'pending': ['pending_confirmation', 'cancelled'],
  'pending_confirmation': ['confirmed', 'cancelled'],
  'confirmed': ['processing', 'cancelled'],
  'processing': ['ready', 'cancelled'],
  'ready': ['delivering', 'cancelled'],
  'delivering': ['cancelled'], // Merchant can only cancel, customer marks as completed
  'completed': [], // Terminal state
  'cancelled': [], // Terminal state
  'waiting': ['pending_confirmation', 'cancelled'],
};

/**
 * Status display names in Indonesian
 */
const STATUS_DISPLAY_NAMES = {
  'pending': 'Menunggu',
  'pending_confirmation': 'Menunggu Konfirmasi',
  'confirmed': 'Dikonfirmasi',
  'processing': 'Sedang Diproses',
  'ready': 'Siap Dikirim',
  'delivering': 'Sedang Dikirim',
  'completed': 'Selesai',
  'cancelled': 'Dibatalkan',
  'waiting': 'Menunggu',
};

/**
 * Validate status transition
 * @param {string} currentStatus - Current order status
 * @param {string} newStatus - Desired new status
 * @param {boolean} isMerchantAction - Whether this is a merchant action (default: true)
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validateStatusTransition(currentStatus, newStatus, isMerchantAction = true) {
  // Same status is always valid (idempotent)
  if (currentStatus === newStatus) {
    return { valid: true };
  }

  // Use merchant transitions if this is a merchant action
  const transitions = isMerchantAction ? MERCHANT_STATUS_TRANSITIONS : STATUS_TRANSITIONS;

  // Check if current status exists
  if (!transitions[currentStatus]) {
    return { 
      valid: false, 
      error: `Invalid current status: ${currentStatus}` 
    };
  }

  // Check if transition is allowed
  const allowedTransitions = transitions[currentStatus];
  if (!allowedTransitions.includes(newStatus)) {
    const allowedStatuses = allowedTransitions.length > 0 
      ? allowedTransitions.join(', ') 
      : 'none (terminal state)';
    const actor = isMerchantAction ? 'merchant' : 'system';
    return { 
      valid: false, 
      error: `Cannot transition from "${currentStatus}" to "${newStatus}" (${actor} action). Allowed transitions: ${allowedStatuses}` 
    };
  }

  return { valid: true };
}

/**
 * Get status notification message in Indonesian
 * @param {string} status - Order status
 * @param {Object} order - Order object
 * @returns {string} Notification message
 */
export function getStatusNotificationMessage(status, order) {
  const statusName = STATUS_DISPLAY_NAMES[status] || status;
  const orderId = order.id || 'N/A';
  const customerName = order.customer_name || 'Pelanggan';

  switch (status) {
    case 'processing':
      return `🔄 **Status Pesanan Diperbarui**\n\n` +
        `📋 Order ID: ${orderId}\n` +
        `👤 Pelanggan: ${customerName}\n\n` +
        `✅ Pesanan Anda sedang diproses.\n` +
        `Kami akan menginformasikan Anda saat pesanan siap dikirim.`;
    
    case 'ready':
      return `✅ **Pesanan Siap Dikirim!**\n\n` +
        `📋 Order ID: ${orderId}\n` +
        `👤 Pelanggan: ${customerName}\n\n` +
        `🎉 Pesanan Anda sudah siap dan akan segera dikirim.\n` +
        `Mohon pastikan Anda siap menerima pesanan.`;
    
    case 'delivering':
      return `🚚 **Pesanan Sedang Dikirim!**\n\n` +
        `📋 Order ID: ${orderId}\n` +
        `👤 Pelanggan: ${customerName}\n\n` +
        `📦 Pesanan Anda sedang dalam perjalanan ke alamat Anda.\n` +
        `Mohon pastikan Anda siap menerima pesanan.\n\n` +
        `✅ **Setelah menerima pesanan, balas dengan:**\n` +
        `"received" atau "selesai" atau "done"\n` +
        `untuk menandai pesanan sebagai selesai.`;
    
    case 'completed':
      return `🎉 **Pesanan Selesai!**\n\n` +
        `📋 Order ID: ${orderId}\n` +
        `👤 Pelanggan: ${customerName}\n\n` +
        `✅ Pesanan Anda telah diterima dan selesai.\n` +
        `${THANK_YOU_TRUST_EMOJI}\n\n` +
        `💬 Jika ada pertanyaan atau keluhan, silakan hubungi kami.`;
    
    case 'cancelled':
      return `❌ **Pesanan Dibatalkan**\n\n` +
        `📋 Order ID: ${orderId}\n` +
        `👤 Pelanggan: ${customerName}\n\n` +
        `Pesanan Anda telah dibatalkan.\n` +
        `Jika Anda memiliki pertanyaan, silakan hubungi kami.`;
    
    default:
      return `📋 **Status Pesanan Diperbarui**\n\n` +
        `📋 Order ID: ${orderId}\n` +
        `👤 Pelanggan: ${customerName}\n\n` +
        `Status: ${statusName}`;
  }
}

/**
 * Get Telegram chat ID from order
 * @param {Object} order - Order object with conversation_id
 * @returns {Promise<number|null>} Telegram chat ID or null
 */
export async function getTelegramChatIdFromOrder(order) {
  try {
    if (!order.conversation_id) {
      return null;
    }

    const conversation = await getConversationById(order.conversation_id);
    
    if (!conversation) {
      return null;
    }

    // Check if it's a Telegram conversation
    if (conversation.platform_reference !== 'telegram') {
      return null;
    }

    // Parse Telegram chat ID from external_user_id
    const chatId = parseInt(conversation.external_user_id);
    if (isNaN(chatId)) {
      return null;
    }

    return chatId;
  } catch (error) {
    console.error('❌ Error getting Telegram chat ID from order:', error);
    return null;
  }
}
