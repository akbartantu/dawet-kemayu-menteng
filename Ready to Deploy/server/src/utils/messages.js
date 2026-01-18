/**
 * Message Templates
 * Single source of truth for all message templates used across the application
 * 
 * IMPORTANT: Keep all strings EXACTLY as they are (including emojis, spacing, punctuation)
 */

// Order Confirmation
export const ORDER_CONFIRMATION_PROMPT = `Apakah pesanan ini sudah benar?
Balas: "Ya"/"Y" untuk konfirmasi atau "Tidak"/"T" untuk membatalkan.`;

// Thank You Messages
export const THANK_YOU_TRUST = 'Terima kasih atas kepercayaan Anda!';
export const THANK_YOU_TRUST_EMOJI = 'Terima kasih atas kepercayaan Anda! 🙏';
export const THANK_YOU_ATTENTION = 'Terima kasih atas perhatiannya 🙏';
export const THANK_YOU_PAYMENT_COMPLETE = 'Terima kasih! Pembayaran sudah lengkap.';

// Payment Messages
export const PAYMENT_DP_REQUIRED = 'Silakan lakukan pembayaran DP untuk melanjutkan proses pesanan Anda. Terima kasih! 🙏';
export const PAYMENT_FULL_REQUIRED = 'Silakan lakukan pembayaran untuk melanjutkan proses pesanan Anda. Terima kasih! 🙏';

// Error Messages
export const ORDER_NOT_FOUND = '❌ Pesanan tidak ditemukan.';
export const INVOICE_ERROR = '❌ Terjadi kesalahan saat membuat invoice. Silakan hubungi admin.';
