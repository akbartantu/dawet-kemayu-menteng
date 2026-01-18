/**
 * Admin Guard Middleware
 * Centralized admin access control for Telegram bot commands
 */

import { getUserRole } from '../repos/users.repo.js';

/**
 * Check if a Telegram user is an admin
 * Checks both Users sheet and environment variable fallback
 * @param {number|string} telegramUserId - Telegram user ID
 * @returns {Promise<boolean>} True if user is admin
 */
export async function isAdmin(telegramUserId) {
  if (!telegramUserId) {
    return false;
  }
  
  // Normalize userId to string and number for flexible matching
  const userIdString = String(telegramUserId);
  const userIdNumber = typeof telegramUserId === 'number' ? telegramUserId : parseInt(userIdString);
  
  console.log(`🔍 [ADMIN_CHECK] Checking admin status - userId: ${telegramUserId} (string: "${userIdString}", number: ${userIdNumber})`);
  
  try {
    // First check Users sheet - try both string and number formats
    let role = await getUserRole('telegram', userIdString);
    
    // If not found with string, try with number as string
    if (!role || role === 'customer') {
      role = await getUserRole('telegram', String(userIdNumber));
    }

    if (role === 'admin') {
      console.log(`✅ [ADMIN_CHECK] User ${telegramUserId} is admin (from Users sheet)`);
      return true;
    }
    
    // Fallback to env var for backward compatibility
    const adminIds = process.env.ADMIN_TELEGRAM_USER_IDS 
      ? process.env.ADMIN_TELEGRAM_USER_IDS.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
      : [];
    
    const isEnvAdmin = adminIds.includes(userIdNumber);
    if (isEnvAdmin) {
      console.log(`✅ [ADMIN_CHECK] User ${telegramUserId} is admin (from env var)`);
      return true;
    }
    
    console.log(`❌ [ADMIN_CHECK] User ${telegramUserId} is NOT admin (role: ${role || 'customer'})`);
    return false;
  } catch (error) {
    console.error('❌ [ADMIN_CHECK] Error checking admin status:', error);
    console.error('❌ [ADMIN_CHECK] Stack:', error.stack);
    
    // Fallback to env var on error
    const adminIds = process.env.ADMIN_TELEGRAM_USER_IDS 
      ? process.env.ADMIN_TELEGRAM_USER_IDS.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
      : [];
    
    const isEnvAdmin = adminIds.includes(userIdNumber);
    if (isEnvAdmin) {
      console.log(`✅ [ADMIN_CHECK] User ${telegramUserId} is admin (from env var fallback)`);
      return true;
    }
    
    return false;
  }
}

/**
 * Require admin role - sends error message if not admin
 * @param {number|string} userId - Telegram user ID
 * @param {Function} sendMessage - Function to send error message
 * @param {number|string} chatId - Telegram chat ID
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
 * Assert admin role - throws error if not admin (for use in async functions that need to throw)
 * @param {number|string} userId - Telegram user ID
 * @param {number|string} chatId - Telegram chat ID
 * @param {Object} message - Telegram message object (optional, for logging)
 * @throws {Error} If user is not admin
 */
export async function assertAdmin(userId, chatId, message = null) {
  const isUserAdmin = await isAdmin(userId);
  if (!isUserAdmin) {
    const error = new Error('Admin access required');
    error.userId = userId;
    error.chatId = chatId;
    error.message = message;
    throw error;
  }
}
