/**
 * System Commands
 * Handles system-level admin commands (authentication, etc.)
 */

import { upsertUserRole } from '../repos/users.repo.js';
import { requireAdmin } from '../middleware/adminGuard.js';

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

  } catch (error) {
    console.error('❌ Error in handleAdminAuth:', error);
    await sendMessage(chatId, '❌ Terjadi kesalahan saat memberikan akses admin. Silakan coba lagi.');
  }
}
