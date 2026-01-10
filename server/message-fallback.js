/**
 * Message Fallback Helpers
 * Provides friendly fallback responses for unhandled messages
 */

// Cooldown map: chatId -> lastFallbackSent timestamp
const fallbackCooldown = new Map();
const FALLBACK_COOLDOWN_MS = 15000; // 15 seconds

/**
 * Check if message is in English
 */
function isEnglishMessage(text) {
  if (!text) return false;
  
  // Simple heuristic: check for common English words
  const englishWords = ['hello', 'hi', 'help', 'menu', 'order', 'thanks', 'thank you', 'yes', 'no', 'ok', 'okay'];
  const textLower = text.toLowerCase();
  return englishWords.some(word => textLower.includes(word));
}

/**
 * Convert validation error to user-friendly Indonesian text
 */
function translateErrorToIndonesian(error) {
  const translations = {
    'Customer name is required': 'Nama pelanggan',
    'Phone number is required': 'Nomor HP',
    'Address is required': 'Alamat',
    'At least one order item is required': 'Daftar pesanan (minimal 1 item)',
  };
  
  return translations[error] || error;
}

/**
 * Get friendly fallback message
 */
export function getFallbackMessage(isEnglish = false) {
  if (isEnglish) {
    return `Hello! 👋 I can help you place an order.\n\n` +
           `You can type:\n` +
           `• /menu to see the menu\n` +
           `• /help for order format guide\n\n` +
           `Or send your order directly using this format:\n\n` +
           `Name: Your Name\n` +
           `Phone: Your Phone Number\n` +
           `Address: Your Address\n` +
           `Order:\n` +
           `- 2x Dawet Kemayu Medium\n` +
           `- 1x Dawet Kemayu Large`;
  }
  
  return `Halo! 👋 Aku bisa bantu catat pesanan kamu.\n\n` +
         `Kamu bisa ketik:\n` +
         `• /menu untuk lihat menu\n` +
         `• /help untuk panduan format pesanan\n\n` +
         `Atau langsung kirim format pesanan ya 😊\n\n` +
         `**Contoh:**\n` +
         `Nama: Nama Anda\n` +
         `No HP: 081234567890\n` +
         `Alamat: Alamat lengkap\n` +
         `Pesanan:\n` +
         `- 2x Dawet Kemayu Medium\n` +
         `- 1x Dawet Kemayu Large`;
}

/**
 * Get incomplete order message
 */
export function getIncompleteOrderMessage(validationErrors, isEnglish = false) {
  // Translate errors to user-friendly Indonesian
  const friendlyErrors = validationErrors.map(translateErrorToIndonesian);
  
  if (isEnglish) {
    return `I can see you're trying to place an order, but some information is missing 😊\n\n` +
           `**Missing fields:**\n` +
           friendlyErrors.map(err => `• ${err}`).join('\n') +
           `\n\n**Please resend using this format:**\n\n` +
           `Name: Your Name\n` +
           `Phone: Your Phone Number\n` +
           `Address: Your Address\n` +
           `Order:\n` +
           `- 2x Dawet Kemayu Medium\n` +
           `- 1x Dawet Kemayu Large\n\n` +
           `Type /help for more details.`;
  }
  
  return `Siap! Format pesanan kamu sudah kebaca, tapi masih kurang ya 😊\n\n` +
         `**Yang masih kurang:**\n` +
         friendlyErrors.map(err => `• ${err}`).join('\n') +
         `\n\n**Coba kirim ulang pakai format ini:**\n\n` +
         `Nama: Nama Anda\n` +
         `No HP: 081234567890\n` +
         `Alamat: Alamat lengkap\n` +
         `Pesanan:\n` +
         `- 2x Dawet Kemayu Medium\n` +
         `- 1x Dawet Kemayu Large\n\n` +
         `Ketik /help untuk panduan lengkap.`;
}

/**
 * Check if fallback can be sent (cooldown check)
 */
export function canSendFallback(chatId) {
  const lastSent = fallbackCooldown.get(chatId);
  if (!lastSent) {
    return true;
  }
  
  const timeSinceLastSent = Date.now() - lastSent;
  return timeSinceLastSent >= FALLBACK_COOLDOWN_MS;
}

/**
 * Mark fallback as sent (update cooldown)
 */
export function markFallbackSent(chatId) {
  fallbackCooldown.set(chatId, Date.now());
  
  // Clean up old entries (keep only last 1000)
  if (fallbackCooldown.size > 1000) {
    const firstKey = fallbackCooldown.keys().next().value;
    fallbackCooldown.delete(firstKey);
  }
}

/**
 * Detect if message is in English
 */
export function detectLanguage(text) {
  return isEnglishMessage(text);
}
