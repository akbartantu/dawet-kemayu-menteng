/**
 * State Store
 * Centralized in-memory state management for the Telegram bot
 * All state is shared across modules and persists for the lifetime of the server
 */

// Track processed order confirmations to prevent duplicates
export const processedConfirmations = new Set();

// Track invoices sent to prevent double-sending (10 second TTL)
// key: orderId, value: { sentAt: timestamp }
export const sentInvoices = new Map();

// Track processed command messages to prevent duplicate replies
// key: update_id or `${chatId}:${messageId}`
export const processedCommands = new Set();

// Track processed callbacks to prevent duplicate handling
export const processedCallbacks = new Set();

// Chat-scoped order state (prevents state bleeding between chats)
// key: chatId (string), value: { mode, startedAt, lastCommand, ... }
export const orderStateByChat = new Map();
export const ORDER_STATE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Pending payment confirmations
// key: userId:orderId, value: { orderId, expectedAmount, enteredAmount, timestamp }
export const pendingPaymentConfirmations = new Map();

// Concurrency lock for order finalization
// Prevents duplicate processing of the same order_id
// Key: orderId, Value: { timestamp, timeout }
export const orderFinalizationLocks = new Map();
export const LOCK_TTL_MS = 60000; // 60 seconds

const CALLBACK_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Get chat-scoped state key
 * For groups, include user_id to support per-user state within group
 * For private chats, chat_id is sufficient
 */
export function getChatStateKey(chatId, userId, chatType) {
  if (chatType === 'group' || chatType === 'supergroup') {
    // In groups, state is per-user to avoid conflicts
    return `${chatId}:${userId}`;
  }
  // Private chat: chat_id is unique per user
  return String(chatId);
}

/**
 * Get order state for a chat
 */
export function getOrderState(chatId, userId, chatType) {
  const key = getChatStateKey(chatId, userId, chatType);
  const state = orderStateByChat.get(key);
  
  // Check TTL
  if (state && (Date.now() - state.startedAt) > ORDER_STATE_TTL_MS) {
    orderStateByChat.delete(key);
    return null;
  }
  
  return state;
}

/**
 * Set order state for a chat
 */
export function setOrderState(chatId, userId, chatType, mode) {
  const key = getChatStateKey(chatId, userId, chatType);
  orderStateByChat.set(key, {
    mode,
    startedAt: Date.now(),
    chatId,
    userId,
    chatType,
  });
}

/**
 * Clear order state for a chat
 */
export function clearOrderState(chatId, userId, chatType) {
  const key = getChatStateKey(chatId, userId, chatType);
  const state = orderStateByChat.get(key);
  if (state) {
    orderStateByChat.delete(key);
  }
}

/**
 * Acquire lock for order finalization
 * @param {string} orderId - Order ID to lock
 * @returns {boolean} True if lock acquired, false if already locked
 */
export function acquireOrderLock(orderId) {
  const now = Date.now();
  const existingLock = orderFinalizationLocks.get(orderId);
  
  if (existingLock) {
    // Check if lock expired
    if (now - existingLock.timestamp < LOCK_TTL_MS) {
      console.log(`🔒 [ORDER_LOCK] Order ${orderId} is already being processed (locked ${Math.floor((now - existingLock.timestamp) / 1000)}s ago)`);
      return false; // Lock still active
    } else {
      // Lock expired, remove it
      orderFinalizationLocks.delete(orderId);
    }
  }
  
  // Acquire new lock
  orderFinalizationLocks.set(orderId, { timestamp: now });
  return true;
}

/**
 * Release lock for order finalization
 * @param {string} orderId - Order ID to unlock
 */
export function releaseOrderLock(orderId) {
  orderFinalizationLocks.delete(orderId);
}

/**
 * Clean up expired locks (periodic cleanup)
 */
export function cleanupExpiredLocks() {
  const now = Date.now();
  let cleaned = 0;
  for (const [orderId, lock] of orderFinalizationLocks.entries()) {
    if (now - lock.timestamp > LOCK_TTL_MS) {
      orderFinalizationLocks.delete(orderId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 [ORDER_LOCK] Cleaned up ${cleaned} expired locks`);
  }
}

// Clean up old states periodically
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, state] of orderStateByChat.entries()) {
    if (now - state.startedAt > ORDER_STATE_TTL_MS) {
      orderStateByChat.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 [ORDER_STATE] Cleaned up ${cleaned} expired order states`);
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Clean up old confirmations periodically (older than 1 hour)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, data] of pendingPaymentConfirmations.entries()) {
    if (now - data.timestamp > 60 * 60 * 1000) { // 1 hour
      pendingPaymentConfirmations.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 [PAYMENT_CONFIRMATIONS] Cleaned up ${cleaned} expired confirmations`);
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Clean up old callback IDs periodically
setInterval(() => {
  const before = processedCallbacks.size;
  // Keep only recent callbacks (this is a simple implementation)
  // In production, you might want to track timestamps
  if (before > 1000) {
    processedCallbacks.clear();
    console.log(`🧹 [CALLBACKS] Cleaned up ${before} processed callbacks`);
  }
}, CALLBACK_CLEANUP_INTERVAL);
