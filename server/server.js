/**
 * DAWET Backend Server
 * Handles Telegram bot and manual WhatsApp message input
 * (Temporary solution while waiting for WhatsApp API access)
 */
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initializeStorage,
  saveMessage,
  getOrCreateConversation,
  getAllMessages,
  getMessagesByConversation,
  getAllConversations,
  saveOrder,
  getAllOrders,
  generateOrderId,
  updateOrderStatus,
  saveToWaitingList,
  checkWaitingList,
  markReminderSent,
  getWaitingListOrders,
  getPriceList,
  updateWaitingListOrderStatus,
  getConversationById,
} from './google-sheets.js';
import {
  validateStatusTransition,
  getStatusNotificationMessage,
  getTelegramChatIdFromOrder,
} from './order-status-notifications.js';
import {
  parseOrderFromMessage,
  validateOrder,
  formatOrderSummary,
} from './order-parser.js';
import {
  formatInvoice,
  calculateOrderTotal,
  formatPrice,
  separateItemsFromNotes,
  formatPaymentNotification,
} from './price-calculator.js';
import {
  formatMenuMessage,
  isMenuRequest,
  isFAQQuestion,
  getFAQAnswer,
} from './bot-menu.js';
import {
  isFutureDate,
  formatDate,
  daysUntilDelivery,
} from './date-utils.js';
import {
  isAdmin,
  handleNewOrder,
  handleParseOrder,
  handleOrderDetail,
  handleStatus,
  handlePay,
  handlePaymentStatus,
  handleAdminAuth,
  handleRecapH1,
  handleOrdersDate,
} from './admin-bot-commands.js';
import {
  checkAndSendRemindersForToday,
  createOrderReminders,
  ensureRemindersSheet,
} from './reminder-system.js';
import {
  getFallbackMessage,
  getIncompleteOrderMessage,
  canSendFallback,
  markFallbackSent,
  detectLanguage,
} from './message-fallback.js';
// Load environment variables
dotenv.config();
// Get directory paths for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3001;
// Middleware to parse JSON
app.use(express.json());
// CORS middleware (allow frontend to call API)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
// Serve static files from the frontend build directory
// The dist folder is one level up from the server directory
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
// Telegram Bot API base URL
const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';
// For polling (local development)
let lastUpdateId = 0;
let pollingInterval = null;
// Track processed order confirmations to prevent duplicates
const processedConfirmations = new Set();
/**
 * Step 1: Receive Messages from Telegram Bot
 * Option A: Webhook (for production)
 * Telegram sends messages to this endpoint when customers message the bot
 */
app.post('/api/webhooks/telegram', (req, res) => {
  // Always respond 200 OK to Telegram immediately
  res.status(200).send('OK');
  // Process the webhook
  try {
    const update = req.body;
    // Telegram sends updates in this structure
    if (update.message) {
      handleTelegramMessage(update.message);
    }
  } catch (error) {
  }
});
/**
 * Delete webhook (needed before polling)
 * Telegram doesn't allow webhook and polling at the same time
 */
let webhookDeleted = false;
async function deleteWebhook() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return;
  }
  // Only delete once at startup
  if (webhookDeleted) {
    return;
  }
  try {
    const url = `${TELEGRAM_API_BASE}${botToken}/deleteWebhook?drop_pending_updates=true`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.ok) {
      webhookDeleted = true;
    } else {
      webhookDeleted = true;
    }
  } catch (error) {
  }
}
/**
 * Step 1B: Polling Mode (for local development)
 * Instead of webhook, we ask Telegram for new messages every few seconds
 */
async function startPolling() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return;
  }
  ...');
  // First, remove any existing webhook (required!)
  await deleteWebhook();
  // Wait a moment for webhook removal to process
  await new Promise(resolve => setTimeout(resolve, 1000));
  // Poll every 2 seconds
  pollingInterval = setInterval(async () => {
    try {
      const url = `${TELEGRAM_API_BASE}${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=1`;
      const response = await fetch(url);
      if (!response.ok) {
        // Handle 409 error specifically (only log once, don't spam)
        if (response.status === 409 && !webhookDeleted) {
          await deleteWebhook();
          await new Promise(resolve => setTimeout(resolve, 3000));
          return; // Will retry on next poll
        } else if (response.status === 409) {
          // Already tried to delete, just skip this poll
          return;
        }
        const errorText = await response.text();
        return;
      }
      const data = await response.json();
      if (!data.ok) {
        return;
      }
      if (data.result && data.result.length > 0) {
        data.result.forEach((update) => {
          if (update.message) {
            handleTelegramMessage(update.message);
          }
          // Handle callback queries (button clicks)
          if (update.callback_query) {
            handleCallbackQuery(update.callback_query);
          }
          lastUpdateId = update.update_id;
        });
      }
    } catch (error) {
    }
  }, 2000); // Poll every 2 seconds
}
/**
 * Stop polling (cleanup)
 */
function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}
/**
 * Step 2: Manual WhatsApp Message Input
 * Merchant manually inputs WhatsApp messages they received
 */
app.post('/api/messages/whatsapp-manual', async (req, res) => {
  try {
    const { from, text, timestamp } = req.body;
    if (!from || !text) {
      return res.status(400).json({ error: 'Missing "from" or "text" field' });
    }
    // Create conversation ID from phone number
    const conversationId = `conv_whatsapp_${from.replace(/\D/g, '')}`;
    // Store message in storage
    const messageData = {
      id: `whatsapp_manual_${Date.now()}`,
      conversationId: conversationId,
      from: from,
      fromName: 'Customer',
      text: text,
      messageType: 'text',
      direction: 'inbound',
      source: 'whatsapp_manual',
      status: 'delivered',
    };
    await saveMessage(messageData);
    res.json({
      success: true,
      messageId: messageData.id,
      message: 'WhatsApp message stored successfully',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to store message', details: error.message });
  }
});
/**
 * Handle incoming Telegram message from customer
 */
async function handleTelegramMessage(message) {
  try {
    // Get or create conversation
    const conversation = await getOrCreateConversation(
      message.chat.id,
      message.from?.first_name || message.from?.username,
      message.from?.id
    // Prepare message data
    const messageData = {
      id: `telegram_${message.message_id}`,
      conversationId: conversation.id,
      telegramChatId: message.chat.id,
      from: String(message.from?.id),
      fromName: message.from?.first_name || message.from?.username || 'Unknown',
      fromId: message.from?.id,
      text: message.text || '',
      messageType: 'text',
      direction: 'inbound',
      source: 'telegram',
      status: 'delivered',
      telegramMessageId: message.message_id,
    };
    // Save to storage
    await saveMessage(messageData);
    // Handle bot commands
    if (message.text?.startsWith('/')) {
      handleTelegramCommand(message);
      return;
    }
    // Try to parse order from message FIRST (before menu/FAQ)
    // This ensures orders are processed even if they contain FAQ keywords
    let orderProcessed = false;
    try {
      const parsedOrder = parseOrderFromMessage(message.text);
      // Get price list to check if notes are actually items
      const priceList = await getPriceList();
      // Move price list items from notes to items
      const { items, notes } = separateItemsFromNotes(parsedOrder.items, parsedOrder.notes, priceList);
      parsedOrder.items = items;
      parsedOrder.notes = notes;
      const validation = validateOrder(parsedOrder);
      if (validation.valid) {
        // Mark as processed IMMEDIATELY to prevent fall-through
        orderProcessed = true;
        // Generate order ID (MUST be done before any operations)
        const orderId = await generateOrderId();
        if (!orderId) {
          throw new Error('Failed to generate order ID');
        }
        // Create order
        const orderData = {
          id: orderId,
          conversation_id: conversation.id,
          customer_name: parsedOrder.customer_name,
          phone_number: parsedOrder.phone_number,
          address: parsedOrder.address,
          event_name: parsedOrder.event_name,
          event_duration: parsedOrder.event_duration,
          event_date: parsedOrder.event_date,
          delivery_time: parsedOrder.delivery_time,
          items: parsedOrder.items,
          notes: parsedOrder.notes,
          status: 'pending',
          created_at: new Date().toISOString(),
        };
        // Check if order date is in the future
        const isFuture = isFutureDate(orderData.event_date);
        if (isFuture) {
          // Save to waiting list for future orders (owner/admin tracking - customer still needs to confirm)
          // Note: saveToWaitingList and saveOrder now check for duplicates internally
          orderData.status = 'waiting';
          try {
            await saveToWaitingList(orderData);
          } catch (error) {
            throw error; // Re-throw to be caught by outer handler
          }
          // Also save to Orders sheet with "pending_confirmation" status for confirmation flow
          orderData.status = 'pending_confirmation';
          try {
            await saveOrder(orderData);
          } catch (error) {
            throw error; // Re-throw to be caught by outer handler
          }
          // Get price list and calculate order summary
          const priceList = await getPriceList();
          const orderSummary = formatOrderSummary(orderData);
          const calculation = calculateOrderTotal(orderData.items, priceList);
          // Create confirmation message with order summary (without total - total shown in invoice after confirmation)
          let confirmationText = `📋 **KONFIRMASI PESANAN**\n\n`;
          confirmationText += orderSummary;
          confirmationText += `\n\nApakah pesanan ini sudah benar?`;
          // Create inline keyboard with Yes/No buttons
          const replyMarkup = {
            inline_keyboard: [
              [
                { text: '✅ Ya, Benar', callback_data: `confirm_order_${orderData.id}` },
                { text: '❌ Tidak, Perbaiki', callback_data: `cancel_order_${orderData.id}` }
              ]
            ]
          };
          // Send confirmation message with buttons
          await sendTelegramMessage(message.chat.id, confirmationText, replyMarkup);
          // orderProcessed already set above, but ensure it's still true
          orderProcessed = true;
          , orderProcessed=true, returning early`);
          return; // CRITICAL: Return immediately to prevent fall-through
        } else {
          // Save order to Google Sheets with status "pending_confirmation" (current date or past)
          orderData.status = 'pending_confirmation';
          try {
            await saveOrder(orderData);
          } catch (error) {
            throw error; // Re-throw to be caught by outer handler
          }
          // Create reminders for future orders (H-4, H-3, H-1)
          // Reminder creation is based ONLY on Event Date (not payment status, order status, etc.)
          if (orderData.event_date) {
            // Normalize today for comparison
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            // Parse event date
            const { parseDate } = await import('./date-utils.js');
            const eventDateParsed = parseDate(orderData.event_date);
            if (eventDateParsed) {
              // Normalize event date to start of day
              eventDateParsed.setHours(0, 0, 0, 0);
              .split('T')[0]}, Today: ${today.toISOString().split('T')[0]}`);
              // STRICT comparison: eventDate > today (not >=)
              if (eventDateParsed > today) {
                try {
                  const reminders = await createOrderReminders(orderData.id, orderData.event_date, orderData);
                  if (reminders.length > 0) {
                    for order ${orderData.id}`);
                  } else {
                    `);
                  }
                } catch (error) {
                  :', error);
                  // Don't fail order creation if reminder creation fails
                }
              } else {
                .split('T')[0]} <= ${today.toISOString().split('T')[0]}), skipping reminder creation`);
              }
            } else {
            }
          } else {
          }
          // Get price list and calculate order summary
          const priceList = await getPriceList();
          const orderSummary = formatOrderSummary(orderData);
          const calculation = calculateOrderTotal(orderData.items, priceList);
          // Create confirmation message with order summary (without total - total shown in invoice after confirmation)
          let confirmationText = `📋 **KONFIRMASI PESANAN**\n\n`;
          confirmationText += orderSummary;
          confirmationText += `\n\nApakah pesanan ini sudah benar?`;
          // Create inline keyboard with Yes/No buttons
          const replyMarkup = {
            inline_keyboard: [
              [
                { text: '✅ Ya, Benar', callback_data: `confirm_order_${orderData.id}` },
                { text: '❌ Tidak, Perbaiki', callback_data: `cancel_order_${orderData.id}` }
              ]
            ]
          };
          // Send confirmation message with buttons
          await sendTelegramMessage(message.chat.id, confirmationText, replyMarkup);
          // orderProcessed already set above, but ensure it's still true
          orderProcessed = true;
          return; // CRITICAL: Return immediately to prevent fall-through
        }
      } else {
        // Order format detected but incomplete
        // Always send helpful incomplete order message if it looks like an order attempt
        if (parsedOrder.customer_name || parsedOrder.phone_number || parsedOrder.items.length > 0) {
          const isEnglish = detectLanguage(message.text);
          const incompleteMessage = getIncompleteOrderMessage(validation.errors, isEnglish);
          await sendTelegramMessage(message.chat.id, incompleteMessage);
          orderProcessed = true; // Mark as processed (even if incomplete)
          return; // CRITICAL: Return immediately to prevent fall-through
        }
      }
    } catch (error) {
      // Check if this is a parse error (not an order) or a save error (order was parsed but save failed)
      if (error.message && (
        error.message.includes('Unable to parse range') ||
        error.message.includes('Error saving') ||
        error.message.includes('Error saving order') ||
        error.message.includes('Error saving to')
      )) {
        // This is a save error - order was parsed correctly but save failed
        // Send error message to user
        const errorMessage = '❌ Maaf, terjadi kesalahan saat menyimpan pesanan Anda. Silakan coba lagi atau hubungi admin.';
        await sendTelegramMessage(message.chat.id, errorMessage);
        orderProcessed = true; // Mark as processed to prevent fall-through
        return; // Exit handler
      } else {
        // This is a parse error - not an order format, continue to other handlers
        // But only log if orderProcessed is still false (meaning it's truly not an order)
        if (!orderProcessed) {
        } else {
        }
      }
    }
    // CRITICAL: Return early if order was processed to prevent fall-through to menu/FAQ
    if (orderProcessed) {
      return; // Exit handler to prevent extra messages
    }
    // Only handle menu/FAQ/completion if order was not processed
    if (!orderProcessed) {
      // Handle customer order completion keywords
      const completionKeywords = ['received', 'selesai', 'done', 'sudah diterima', 'complete'];
      const messageTextLower = message.text?.toLowerCase().trim() || '';
      const isCompletionKeyword = completionKeywords.some(keyword => 
        messageTextLower === keyword || messageTextLower.includes(keyword)
      if (isCompletionKeyword) {
        await handleCustomerOrderCompletion(message.chat.id, message.from?.id, message.text);
        return;
      }
      // Handle menu request
      if (isMenuRequest(message.text)) {
        const menuMessage = await formatMenuMessage();
        await sendTelegramMessage(message.chat.id, menuMessage);
        return;
      }
      // Handle FAQ questions (ONLY if not an order)
      // Double-check: if orderProcessed is true, skip FAQ
      if (!orderProcessed && isFAQQuestion(message.text)) {
        }...`);
        const faqAnswer = getFAQAnswer(message.text);
        await sendTelegramMessage(message.chat.id, faqAnswer);
        return;
      } else if (orderProcessed) {
      }
      // Fallback: Send friendly message for unhandled messages (NEVER send location)
      // Only send fallback if order was NOT processed
      if (!orderProcessed && canSendFallback(message.chat.id)) {
        const isEnglish = detectLanguage(message.text);
        const fallbackMessage = getFallbackMessage(isEnglish);
        await sendTelegramMessage(message.chat.id, fallbackMessage);
        markFallbackSent(message.chat.id);
      } else if (orderProcessed) {
      } else {
      }
    }
  } catch (error) {
  }
}
/**
 * Handle callback queries (button clicks)
 */
// Track processed callbacks to prevent duplicate handling
const processedCallbacks = new Set();
const CALLBACK_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
// Clean up old callback IDs periodically
setInterval(() => {
  const before = processedCallbacks.size;
  // Keep only recent callbacks (this is a simple implementation)
  // In production, you might want to track timestamps
  if (before > 1000) {
    processedCallbacks.clear();
  }
}, CALLBACK_CLEANUP_INTERVAL);
async function handleCallbackQuery(callbackQuery) {
  const { data, message, from, id: callbackId } = callbackQuery;
  const chatId = message.chat.id;
  const messageId = message.message_id;
  // Check if this callback was already processed (prevent Telegram retries)
  const callbackKey = `${callbackId}_${data}`;
  if (processedCallbacks.has(callbackKey)) {
    // Still answer the callback to stop Telegram retry
    await answerCallbackQuery(callbackId);
    return;
  }
  // Mark as processed immediately
  processedCallbacks.add(callbackKey);
  try {
    // Answer callback query IMMEDIATELY to stop Telegram retry
    await answerCallbackQuery(callbackId);
    if (data.startsWith('confirm_order_')) {
      const orderId = data.replace('confirm_order_', '');
      // Remove inline keyboard to prevent double-click
      try {
        await editMessageReplyMarkup(chatId, messageId, null);
      } catch (error) {
        :`, error.message);
      }
      await handleOrderConfirmation(chatId, orderId, messageId);
      return; // CRITICAL: Return early to prevent any other processing
    } else if (data.startsWith('cancel_order_')) {
      const orderId = data.replace('cancel_order_', '');
      // Remove inline keyboard
      try {
        await editMessageReplyMarkup(chatId, messageId, null);
      } catch (error) {
        :`, error.message);
      }
      await handleOrderCancellation(chatId, orderId, messageId);
      return; // CRITICAL: Return early
    } else {
    }
  } catch (error) {
    // Don't send error message to user to avoid "null" issues
  }
}
/**
 * Answer callback query (required by Telegram)
 * Only includes text if it's a valid non-empty string
 */
async function answerCallbackQuery(callbackQueryId, text = null) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  try {
    const url = `${TELEGRAM_API_BASE}${botToken}/answerCallbackQuery`;
    const payload = {
      callback_query_id: callbackQueryId,
    };
    // Only include text if it's a valid non-empty string
    if (text && typeof text === 'string' && text.trim().length > 0) {
      payload.text = text;
    }
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
  }
}
/**
 * Concurrency lock for order finalization
 * Prevents duplicate processing of the same order_id
 * Key: orderId, Value: { timestamp, timeout }
 */
const orderFinalizationLocks = new Map();
const LOCK_TTL_MS = 60000; // 60 seconds
/**
 * Acquire lock for order finalization
 * @param {string} orderId - Order ID to lock
 * @returns {boolean} True if lock acquired, false if already locked
 */
function acquireOrderLock(orderId) {
  const now = Date.now();
  const existingLock = orderFinalizationLocks.get(orderId);
  if (existingLock) {
    // Check if lock expired
    if (now - existingLock.timestamp < LOCK_TTL_MS) {
      / 1000)}s ago)`);
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
function releaseOrderLock(orderId) {
  orderFinalizationLocks.delete(orderId);
}
/**
 * Clean up expired locks (periodic cleanup)
 */
function cleanupExpiredLocks() {
  const now = Date.now();
  let cleaned = 0;
  for (const [orderId, lock] of orderFinalizationLocks.entries()) {
    if (now - lock.timestamp >= LOCK_TTL_MS) {
      orderFinalizationLocks.delete(orderId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    `);
  }
}
// Clean up expired locks every 5 minutes
setInterval(cleanupExpiredLocks, 5 * 60 * 1000);
/**
 * Finalize order - centralized function to handle order confirmation
 * This ensures idempotency and prevents duplicate writes
 * Uses concurrency lock to prevent race conditions
 * @param {string} orderId - Order ID to finalize
 * @returns {Object} Finalized order data or null if not found/already confirmed
 */
async function finalizeOrder(orderId) {
  // Acquire lock to prevent concurrent processing
  if (!acquireOrderLock(orderId)) {
    // Return existing order if available
    try {
      const { getOrderById } = await import('./google-sheets.js');
      const existingOrder = await getOrderById(orderId);
      return existingOrder;
    } catch (error) {
      return null;
    }
  }
  try {
    // Get order details (check both Orders and WaitingList sheets)
    const orders = await getAllOrders(1000);
    let order = orders.find(o => o.id === orderId);
    let isWaitingListOrder = false;
    // If not found in Orders, check WaitingList
    if (!order) {
      const waitingListOrders = await getWaitingListOrders();
      order = waitingListOrders.find(o => o.id === orderId);
      isWaitingListOrder = true;
    }
    if (!order) {
      return null;
    }
    // Check if order is already confirmed (idempotency check)
    if (order.status === 'confirmed') {
      return order; // Return existing order
    }
    // Normalize event_date to YYYY-MM-DD format before finalizing
    const { normalizeEventDate } = await import('./date-utils.js');
    if (order.event_date) {
      try {
        const originalEventDate = order.event_date;
        order.event_date = normalizeEventDate(order.event_date);
        if (order.event_date !== originalEventDate) {
        }
      } catch (error) {
        // Don't fail finalization, but log the error
      }
    }
    // Normalize delivery_time to HH:MM format before finalizing
    const { normalizeDeliveryTime } = await import('./price-calculator.js');
    if (order.delivery_time) {
      try {
        const originalDeliveryTime = order.delivery_time;
        // Check if it's a valid non-empty string before normalizing
        if (typeof originalDeliveryTime === 'string' && originalDeliveryTime.trim()) {
          order.delivery_time = normalizeDeliveryTime(originalDeliveryTime);
          if (order.delivery_time !== originalDeliveryTime) {
          }
        } else {
          // Invalid or empty delivery_time, clear it
          order.delivery_time = '';
        }
      } catch (error) {
        // Clear invalid delivery_time to prevent issues in invoice formatting
        order.delivery_time = '';
      }
    }
    // Update order status to "confirmed" in the appropriate sheet
    if (isWaitingListOrder) {
      await updateWaitingListOrderStatus(orderId, 'confirmed');
    } else {
      await updateOrderStatus(orderId, 'confirmed');
    }
    // Ensure order exists in Orders sheet (UPSERT - update if exists, append if not)
    // saveOrder() now implements upsert internally, so we can call it safely
    order.status = 'confirmed';
    await saveOrder(order, { skipDuplicateCheck: true }); // skipDuplicateCheck because we have lock + upsert handles it
    `);
    // Create reminders if Event Date is in the future
    if (order.event_date) {
      // Normalize today for comparison
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // Parse event date (should already be in YYYY-MM-DD format, but handle legacy formats defensively)
      let eventDateParsed = null;
      try {
        // If already in YYYY-MM-DD format, parse directly
        if (/^\d{4}-\d{2}-\d{2}$/.test(order.event_date)) {
          eventDateParsed = new Date(order.event_date + 'T00:00:00');
        } else {
          // Legacy format - normalize first
          const normalized = normalizeEventDate(order.event_date);
          eventDateParsed = new Date(normalized + 'T00:00:00');
        }
        if (isNaN(eventDateParsed.getTime())) {
          throw new Error('Invalid date after parsing');
        }
        // Normalize event date to start of day
        eventDateParsed.setHours(0, 0, 0, 0);
        .split('T')[0]}, Today: ${today.toISOString().split('T')[0]}`);
        // STRICT comparison: eventDate > today (not >=)
        if (eventDateParsed > today) {
          try {
            const reminders = await createOrderReminders(orderId, order.event_date, order);
            if (reminders.length > 0) {
              for order ${orderId}`);
            } else {
              `);
            }
          } catch (error) {
            :', error);
            // Don't fail finalization if reminder creation fails
          }
        } else {
          .split('T')[0]} <= ${today.toISOString().split('T')[0]}), skipping reminder creation`);
        }
      } catch (error) {
        // Don't fail finalization, but skip reminder creation
      }
    } else {
    }
    // Update order status in memory
    order.status = 'confirmed';
    return order;
  } catch (error) {
    throw error;
  } finally {
    // Always release lock, even on error
    releaseOrderLock(orderId);
  }
}
/**
 * Handle order confirmation (Yes button clicked)
 * This is the ONLY entry point for order confirmation
 * All order finalization goes through finalizeOrder() which has locking
 */
async function handleOrderConfirmation(chatId, orderId, messageId) {
  // Prevent duplicate processing (in-memory guard - additional safety)
  const confirmationKey = `${orderId}_${messageId}`;
  if (processedConfirmations.has(confirmationKey)) {
    , skipping: ${orderId}`);
    return;
  }
  processedConfirmations.add(confirmationKey);
  // Clean up old entries (keep only last 1000)
  if (processedConfirmations.size > 1000) {
    const firstKey = processedConfirmations.values().next().value;
    processedConfirmations.delete(firstKey);
  }
  try {
    // Finalize order (centralized function handles all writes, locking, and checks)
    // finalizeOrder() has its own concurrency lock, so this is safe even if called concurrently
    const order = await finalizeOrder(orderId);
    if (!order) {
      await sendTelegramMessage(chatId, '❌ Pesanan tidak ditemukan.');
      return;
    }
    // Get price list and generate invoice
    const priceList = await getPriceList();
    const invoice = formatInvoice(order, priceList);
    const calculation = calculateOrderTotal(order.items, priceList);
    // Remove inline keyboard only (keep original confirmation message intact)
    await editMessageReplyMarkup(chatId, messageId, null);
    // Guard: Ensure invoice is valid before sending
    if (!invoice || typeof invoice !== 'string' || invoice.trim().length === 0) {
      await sendTelegramMessage(chatId, '❌ Terjadi kesalahan saat membuat invoice. Silakan hubungi admin.');
      return;
    }
    // Send invoice (ONLY ONCE)
    await sendTelegramMessage(chatId, invoice);
    // Send payment notification based on delivery date
    // - If delivery date > 3 days: 50% down payment
    // - If delivery date <= 3 days: full payment
    // Use total_amount (canonical) with fallback to final_total (legacy) or calculated subtotal
    const totalForNotification = order.total_amount || order.final_total || calculation.subtotal || 0;
    const paymentNotification = formatPaymentNotification(order, totalForNotification);
    // Guard: Only send if payment notification is valid
    if (paymentNotification && typeof paymentNotification === 'string' && paymentNotification.trim().length > 0) {
      await sendTelegramMessage(chatId, paymentNotification);
    } else {
    }
    return; // CRITICAL: Return early to prevent any other processing
  } catch (error) {
    await sendTelegramMessage(chatId, '❌ Terjadi kesalahan saat mengkonfirmasi pesanan. Silakan coba lagi.');
    return; // CRITICAL: Return early even on error
  }
}
/**
 * Handle order cancellation (No button clicked)
 */
async function handleOrderCancellation(chatId, orderId, messageId) {
  try {
    // Update order status to "cancelled"
    await updateOrderStatus(orderId, 'cancelled');
    // Edit the confirmation message
    await editMessageText(
      chatId,
      messageId,
      '❌ **Pesanan Dibatalkan**\n\nSilakan kirim ulang pesanan Anda dengan format yang benar.\n\nKetik /help untuk melihat format pesanan.'
  } catch (error) {
  }
}
/**
 * Edit message text (to update confirmation message)
 */
async function editMessageText(chatId, messageId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  // Guard: Never send null or undefined text
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return;
  }
  try {
    const url = `${TELEGRAM_API_BASE}${botToken}/editMessageText`;
    // Try with Markdown first
    let payload = {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: 'Markdown',
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json();
      // If markdown parsing error, retry without parse_mode
      if (error.error_code === 400 && error.description && error.description.includes("can't parse entities")) {
        payload = {
          chat_id: chatId,
          message_id: messageId,
          text: text,
        };
        const retryResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!retryResponse.ok) {
          const retryError = await retryResponse.json();
          :', retryError);
        }
        return;
      }
    }
  } catch (error) {
  }
}
/**
 * Edit message reply markup (remove inline keyboard)
 */
async function editMessageReplyMarkup(chatId, messageId, replyMarkup = null) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  try {
    const url = `${TELEGRAM_API_BASE}${botToken}/editMessageReplyMarkup`;
    const payload = {
      chat_id: chatId,
      message_id: messageId,
    };
    // If replyMarkup is explicitly null, remove keyboard
    if (replyMarkup === null) {
      payload.reply_markup = { inline_keyboard: [] };
    } else if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // Non-critical, continue execution
  }
}
/**
 * Normalize command string - remove bot username suffix and normalize
 * Examples:
 * - "/order_detail@BotName DKM/..." -> "/order_detail"
 * - "/order_detail    DKM/..." -> "/order_detail"
 * @param {string} commandText - Raw command text
 * @returns {string} Normalized command
 */
function normalizeCommand(commandText) {
  if (!commandText) return '';
  // Remove bot username suffix (e.g., @YourBotName)
  let normalized = commandText.replace(/@\w+/g, '').trim();
  // Get just the command part (before first space)
  const parts = normalized.split(/\s+/);
  normalized = parts[0] || '';
  // Ensure it starts with /
  if (!normalized.startsWith('/')) {
    return '';
  }
  // Convert to lowercase for matching (but we'll use original for display)
  return normalized.toLowerCase();
}
/**
 * Parse command and arguments from message text
 * @param {string} messageText - Full message text
 * @returns {{command: string, args: string[]}} Parsed command and arguments
 */
function parseCommand(messageText) {
  if (!messageText) return { command: '', args: [] };
  // Remove bot username suffix
  let text = messageText.replace(/@\w+/g, '').trim();
  // Split by spaces, but preserve quoted strings
  const parts = text.split(/\s+/);
  const command = parts[0] || '';
  const args = parts.slice(1).filter(arg => arg.trim().length > 0);
  return { command, args };
}
/**
 * Handle Telegram bot commands (/start, /help, etc.)
 */
function handleTelegramCommand(message) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const messageText = message.text || '';
  // Parse command
  const { command: rawCommand, args } = parseCommand(messageText);
  const normalizedCommand = normalizeCommand(rawCommand);
  // Log command received
  }], chatId: ${chatId}, userId: ${userId}`);
  // If no valid command, handle as unknown
  if (!normalizedCommand) {
    sendTelegramMessage(chatId, '❌ Command tidak dikenali. Ketik /help untuk daftar perintah.');
    return;
  }
  switch (normalizedCommand) {
    case '/start':
      sendTelegramMessage(chatId, 
        'Halo 👋\n' +
        'Selamat datang di Admin Assistant Bot Dawet Kemayu Menteng 🍹\n\n' +
        'Aku akan membantu kamu mencatat pesanan, memantau pembayaran,\n' +
        'dan mengingatkan jadwal penting supaya tidak ada yang terlewat.\n\n' +
        'Untuk mulai pesan, ketik /pesan.\n' +
        'Ketik /help untuk bantuan.'
      break;
    case '/pesan':
      sendTelegramMessage(chatId,
        '📝 Silakan kirim pesanan Anda dengan format berikut:\n\n' +
        'Nama Pemesan:\n' +
        'Nama Penerima:\n' +
        'No HP Penerima:\n' +
        'Alamat Penerima:\n\n' +
        'Nama Event (jika ada):\n' +
        'Durasi Event (dalam jam):\n\n' +
        'Tanggal Event: DD/MM/YYYY\n' +
        'Waktu Kirim (jam): HH:MM\n\n' +
        'Detail Pesanan:\n' +
        '[Jumlah] x [Nama Item]\n' +
        '[Jumlah] x [Nama Item]\n\n' +
        'Packaging Styrofoam\n' +
        '(1 box Rp40.000 untuk 50 cup): YA / TIDAK\n\n' +
        'Metode Pengiriman:\n' +
        'Pickup / GrabExpress / Custom\n\n' +
        'Biaya Pengiriman (Rp):\n' +
        '(diisi oleh Admin)\n\n' +
        'Notes:\n\n' +
        'Mendapatkan info Dawet Kemayu Menteng dari:\n' +
        'Teman / Instagram / Facebook / TikTok / Lainnya'
      break;
    case '/menu':
      formatMenuMessage().then(menu => {
        sendTelegramMessage(chatId, menu);
      });
      break;
    case '/lokasi':
    case '/location':
      sendTelegramMessage(chatId,
        '📍 **Lokasi:**\n\n' +
        'Dawet Kemayu Menteng\n' +
        'Jl. Kemayu Menteng, Jakarta\n\n' +
        'Untuk informasi lebih detail, silakan hubungi kami!'
      break;
    case '/help':
      sendTelegramMessage(chatId, 
        '📋 **Format Pesanan:**\n\n' +
        'Nama: [Nama Anda]\n' +
        'No hp: [Nomor HP Anda]\n' +
        'Alamat:\n' +
        '[Alamat lengkap pengiriman]\n' +
        '(Titik: [Titik referensi jika ada])\n' +
        'Nama event (jika untuk event): [Nama event]\n' +
        'Durasi event: [Durasi event]\n' +
        'Tanggal: [DD/MM/YYYY]\n' +
        '*Jam kirim: [HH.MM]*\n' +
        'Detail pesanan:\n' +
        '- [Jumlah] x [Nama Item]\n' +
        '- [Jumlah] x [Nama Item + Topping]\n' +
        '- [Catatan tambahan]\n\n' +
        '**Contoh:**\n' +
        'Nama: Budi Santoso\n' +
        'No hp: 081234567890\n' +
        'Alamat: Jl. Contoh No. 123, Jakarta\n' +
        'Tanggal: 15/01/2026\n' +
        '*Jam kirim: 14.00*\n' +
        'Detail pesanan:\n' +
        '- 10 x Dawet Medium + Nangka\n' +
        '- 5 x Dawet Medium Original\n' +
        '- Packaging styrofoam\n\n' +
        'Kirim pesanan Anda dengan format di atas!'
      break;
    // Admin commands (PRD requirements)
    case '/new_order':
      handleNewOrder(chatId, userId, sendTelegramMessage).catch(error => {
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    case '/parse_order':
      handleParseOrder(chatId, userId, messageText, sendTelegramMessage).catch(error => {
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    case '/order_detail': {
      const orderId = args[0];
      handleOrderDetail(chatId, userId, orderId, sendTelegramMessage).catch(error => {
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/status': {
      const parts = message.text.split(' ');
      const orderId = parts[1];
      handleStatus(chatId, message.from?.id, orderId, sendTelegramMessage);
      break;
    }
    case '/pay': {
      const parts = message.text.split(' ');
      const orderId = parts[1];
      const amount = parts[2];
      handlePay(chatId, message.from?.id, orderId, amount, sendTelegramMessage);
      break;
    }
    case '/payment_status': {
      const parts = message.text.split(' ');
      const orderId = parts[1];
      handlePaymentStatus(chatId, message.from?.id, orderId, sendTelegramMessage);
      break;
    }
    case '/today_reminder': {
      isAdmin(userId).then(async (isUserAdmin) => {
        if (isUserAdmin) {
          await checkAndSendRemindersForToday(sendTelegramMessage);
          await sendTelegramMessage(chatId, '✅ Reminder check completed. Check logs for details.');
        } else {
          await sendTelegramMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
        }
      }).catch(error => {
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/admin_auth': {
      handleAdminAuth(chatId, userId, messageText, sendTelegramMessage).catch(error => {
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/recap_h1': {
      handleRecapH1(chatId, userId, sendTelegramMessage).catch(error => {
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/orders_date': {
      const dateStr = args[0];
      if (!dateStr) {
        sendTelegramMessage(chatId, '❌ Format: /orders_date YYYY-MM-DD\n\nContoh: /orders_date 2026-01-18\nAtau gunakan: /orders_today, /orders_tomorrow');
        break;
      }
      handleOrdersDate(chatId, userId, dateStr, sendTelegramMessage).catch(error => {
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/orders_today': {
      handleOrdersDate(chatId, userId, 'today', sendTelegramMessage).catch(error => {
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/orders_tomorrow': {
      handleOrdersDate(chatId, userId, 'tomorrow', sendTelegramMessage).catch(error => {
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    default:
      // Unknown command - respond with friendly message
      sendTelegramMessage(chatId, '❌ Command tidak dikenali. Ketik /help untuk daftar perintah.');
      break;
  }
}
/**
 * Step 3: Send Message via Telegram
 * Our API endpoint to send messages via Telegram bot
 */
app.post('/api/messages/send', async (req, res) => {
  try {
    const { chatId, text } = req.body;
    if (!chatId || !text) {
      return res.status(400).json({ error: 'Missing "chatId" or "text" field' });
    }
    // Send message via Telegram Bot API
    const result = await sendTelegramMessage(chatId, text);
    // Get or create conversation
    const conversation = await getOrCreateConversation(chatId, 'Merchant', null);
    // Store sent message in storage
    const messageData = {
      id: `telegram_sent_${result.message_id}`,
      conversationId: conversation.id,
      telegramChatId: chatId,
      from: 'merchant',
      fromName: 'Merchant',
      text: text,
      messageType: 'text',
      direction: 'outbound',
      source: 'telegram',
      status: 'sent',
      telegramMessageId: result.message_id,
    };
    await saveMessage(messageData);
    res.json({
      success: true,
      messageId: result.message_id,
      chatId: chatId,
      message: 'Message sent successfully via Telegram',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});
/**
 * Escape Markdown special characters to prevent parsing errors
 * @param {string} text - Text that may contain markdown
 * @returns {string} Escaped text safe for Markdown parsing
 */
function escapeMarkdown(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  // Escape special Markdown characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
  return text
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/_/g, '\\_')    // Escape underscores
    .replace(/\*/g, '\\*')   // Escape asterisks
    .replace(/\[/g, '\\[')   // Escape square brackets
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')   // Escape parentheses
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')    // Escape tildes
    .replace(/`/g, '\\`')    // Escape backticks
    .replace(/>/g, '\\>')    // Escape greater than
    .replace(/#/g, '\\#')    // Escape hash
    .replace(/\+/g, '\\+')   // Escape plus
    .replace(/-/g, '\\-')    // Escape minus
    .replace(/=/g, '\\=')    // Escape equals
    .replace(/\|/g, '\\|')   // Escape pipe
    .replace(/\{/g, '\\{')   // Escape curly braces
    .replace(/\}/g, '\\}');
}
/**
 * Sanitize markdown text by ensuring all entities are properly closed
 * If markdown is malformed, escape it to plain text
 * @param {string} text - Text with markdown formatting
 * @returns {string} Sanitized markdown text
 */
function sanitizeMarkdown(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  // Count markdown entities to check for balance
  const boldMatches = text.match(/\*\*/g);
  const italicMatches = text.match(/\*[^*]/g);
  const codeMatches = text.match(/`/g);
  // Check if bold markers are balanced (even number of **)
  if (boldMatches && boldMatches.length % 2 !== 0) {
    , escaping markdown');
    return escapeMarkdown(text);
  }
  // Check if code markers are balanced (even number of `)
  if (codeMatches && codeMatches.length % 2 !== 0) {
    , escaping markdown');
    return escapeMarkdown(text);
  }
  // For italic, check if there are unmatched single asterisks (not part of **)
  // This is more complex, so we'll be conservative
  const singleAsterisks = text.match(/(?<!\*)\*(?!\*)/g);
  if (singleAsterisks && singleAsterisks.length % 2 !== 0) {
    , escaping markdown');
    return escapeMarkdown(text);
  }
  return text;
}
/**
 * Send message via Telegram Bot API
 * Handles markdown parsing errors gracefully by falling back to plain text
 */
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error('Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN in .env file');
  }
  // Guard: Never send null or undefined text
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Cannot send message: text must be a non-empty string');
  }
  const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`;
  // Try with Markdown first, fallback to plain text if parsing fails
  let payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown',
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json();
      // If it's a markdown parsing error, retry without parse_mode
      if (error.error_code === 400 && error.description && error.description.includes("can't parse entities")) {
        :', text.substring(0, 200));
        // Retry without parse_mode (plain text)
        payload = {
          chat_id: chatId,
          text: text,
        };
        if (replyMarkup) {
          payload.reply_markup = replyMarkup;
        }
        const retryResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!retryResponse.ok) {
          const retryError = await retryResponse.json();
          throw new Error(`Telegram API error: ${JSON.stringify(retryError)}`);
        }
        const retryData = await retryResponse.json();
        if (!retryData.ok) {
          throw new Error(`Telegram API error: ${retryData.description}`);
        }
        :', retryData.result);
        return retryData.result;
      }
      throw new Error(`Telegram API error: ${JSON.stringify(error)}`);
    }
    const data = await response.json();
    if (!data.ok) {
      // If it's a markdown parsing error, retry without parse_mode
      if (data.error_code === 400 && data.description && data.description.includes("can't parse entities")) {
        :', text.substring(0, 200));
        // Retry without parse_mode (plain text)
        payload = {
          chat_id: chatId,
          text: text,
        };
        if (replyMarkup) {
          payload.reply_markup = replyMarkup;
        }
        const retryResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!retryResponse.ok) {
          const retryError = await retryResponse.json();
          throw new Error(`Telegram API error: ${JSON.stringify(retryError)}`);
        }
        const retryData = await retryResponse.json();
        if (!retryData.ok) {
          throw new Error(`Telegram API error: ${retryData.description}`);
        }
        :', retryData.result);
        return retryData.result;
      }
      throw new Error(`Telegram API error: ${data.description}`);
    }
    return data.result;
  } catch (error) {
    // If it's a markdown parsing error, try one more time as plain text
    if (error.message && error.message.includes("can't parse entities")) {
      payload = {
        chat_id: chatId,
        text: text,
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }
      const retryResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!retryResponse.ok) {
        const retryError = await retryResponse.json();
        throw new Error(`Telegram API error: ${JSON.stringify(retryError)}`);
      }
      const retryData = await retryResponse.json();
      if (!retryData.ok) {
        throw new Error(`Telegram API error: ${retryData.description}`);
      }
      :', retryData.result);
      return retryData.result;
    }
    throw error;
  }
}
/**
 * Get all messages (for testing/API)
 */
app.get('/api/messages', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const messages = await getAllMessages(limit);
    res.json({ messages, count: messages.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get messages', details: error.message });
  }
});
/**
 * Get all conversations
 */
app.get('/api/conversations', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const conversations = await getAllConversations(limit);
    res.json({ conversations, count: conversations.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get conversations', details: error.message });
  }
});
/**
 * Get all orders with filtering and search
 */
app.get('/api/orders', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const status = req.query.status; // Filter by status
    const search = req.query.search; // Search by customer name, phone, or order ID
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    let orders = await getAllOrders(1000); // Get more than limit to filter
    // Filter by status
    if (status) {
      orders = orders.filter(order => order.status === status);
    }
    // Search functionality
    if (search) {
      const searchLower = search.toLowerCase();
      orders = orders.filter(order => 
        order.customer_name?.toLowerCase().includes(searchLower) ||
        order.phone_number?.includes(search) ||
        order.id?.toLowerCase().includes(searchLower) ||
        order.address?.toLowerCase().includes(searchLower)
    }
    // Filter by date range
    if (startDate || endDate) {
      orders = orders.filter(order => {
        if (!order.created_at) return false;
        const orderDate = new Date(order.created_at);
        if (startDate && orderDate < new Date(startDate)) return false;
        if (endDate && orderDate > new Date(endDate)) return false;
        return true;
      });
    }
    // Apply limit
    orders = orders.slice(0, limit);
    res.json({ orders, count: orders.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get orders', details: error.message });
  }
});
/**
 * Get waiting list orders
 */
app.get('/api/waiting-list', async (req, res) => {
  try {
    const orders = await getWaitingListOrders();
    res.json({ orders, count: orders.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get waiting list', details: error.message });
  }
});
/**
 * Manually trigger waiting list check (for admin)
 */
app.post('/api/waiting-list/check', async (req, res) => {
  try {
    await checkAndSendReminders();
    res.json({ message: 'Waiting list check completed', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check waiting list', details: error.message });
  }
});
/**
 * Get single order by ID
 */
app.get('/api/orders/:id', async (req, res) => {
  try {
    // Decode the order ID to handle URL-encoded slashes (e.g., DKM/20260103/000003)
    const orderId = decodeURIComponent(req.params.id);
    // Normalize order_id for lookup
    const { normalizeOrderId } = await import('./google-sheets.js');
    const normalizedOrderId = normalizeOrderId(orderId);
    `);
    const orders = await getAllOrders(1000);
    const order = orders.find(o => {
      const orderIdNormalized = normalizeOrderId(o.id || '');
      return orderIdNormalized === normalizedOrderId;
    });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    // Ensure pricing/payment fields are included with defaults
    // Read from snake_case columns only (source of truth)
    const totalAmount = order.total_amount ?? order.final_total ?? 0;
    const paidAmount = order.paid_amount ?? 0;
    const remainingBalance = order.remaining_balance ?? Math.max(0, totalAmount - paidAmount);
    // Compute payment_status if missing
    let paymentStatus = order.payment_status;
    if (!paymentStatus || paymentStatus === '') {
      if (totalAmount > 0 && remainingBalance <= 0) {
        paymentStatus = 'PAID';
      } else if (totalAmount > 0 && paidAmount > 0 && paidAmount < totalAmount) {
        paymentStatus = 'DP PAID';
      } else {
        paymentStatus = 'UNPAID';
      }
    }
    const orderWithPricing = {
      ...order,
      // Pricing fields (snake_case only, with proper defaults)
      product_total: order.product_total ?? 0,
      packaging_fee: order.packaging_fee ?? 0,
      delivery_fee: order.delivery_fee ?? 0,
      total_amount: totalAmount, // Use total_amount (canonical) with fallback to final_total
      // Payment fields (with computed defaults if missing)
      dp_min_amount: order.dp_min_amount ?? 0,
      paid_amount: paidAmount,
      payment_status: paymentStatus,
      remaining_balance: remainingBalance,
    };
    res.json({ order: orderWithPricing });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get order', details: error.message });
  }
});
/**
 * Update order status
 */
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    // Decode the order ID to handle URL-encoded slashes (e.g., DKM/20260103/000003)
    const orderId = decodeURIComponent(req.params.id);
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    // Valid statuses (including 'waiting' for waiting list orders)
    const validStatuses = ['pending', 'pending_confirmation', 'confirmed', 'processing', 'ready', 'delivering', 'completed', 'cancelled', 'waiting'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    // Get current order to validate transition
    let order = null;
    const orders = await getAllOrders(1000);
    order = orders.find(o => o.id === orderId);
    // If not found in Orders, check WaitingList
    if (!order) {
      const waitingListOrders = await getWaitingListOrders();
      order = waitingListOrders.find(o => o.id === orderId);
    }
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    // Validate status transition (merchant actions only - customers complete orders via bot)
    const currentStatus = order.status || 'pending';
    const validation = validateStatusTransition(currentStatus, status, true); // true = isMerchantAction
    if (!validation.valid) {
      return res.status(400).json({ 
        error: validation.error || 'Invalid status transition',
        currentStatus,
        requestedStatus: status,
      });
    }
    // Try to update in Orders sheet first
    let orderUpdated = false;
    try {
      await updateOrderStatus(orderId, status);
      orderUpdated = true;
    } catch (error) {
    }
    // Also try to update in WaitingList (order might be in both)
    try {
      await updateWaitingListOrderStatus(orderId, status);
      if (!orderUpdated) {
        orderUpdated = true;
      } else {
      }
    } catch (error) {
      // Order not in WaitingList, that's okay if it was in Orders
      if (!orderUpdated) {
        return res.status(404).json({ error: 'Order not found in Orders or WaitingList' });
      }
    }
    // Get updated order from both sheets
    const updatedOrders = await getAllOrders(1000);
    order = updatedOrders.find(o => o.id === orderId);
    // If not found in Orders, check WaitingList
    if (!order) {
      const waitingListOrders = await getWaitingListOrders();
      order = waitingListOrders.find(o => o.id === orderId);
    }
    if (!order) {
      return res.status(404).json({ error: 'Order not found after update' });
    }
    // Send notification to customer via Telegram (if status change warrants notification)
    const notificationStatuses = ['processing', 'ready', 'delivering', 'completed', 'cancelled'];
    if (notificationStatuses.includes(status) && currentStatus !== status) {
      try {
        const telegramChatId = await getTelegramChatIdFromOrder(order);
        if (telegramChatId) {
          const notificationMessage = getStatusNotificationMessage(status, order);
          await sendTelegramMessage(telegramChatId, notificationMessage);
        } else {
        }
      } catch (error) {
        // Don't fail the status update if notification fails
      }
    }
    res.json({ 
      order, 
      message: 'Order status updated successfully',
      previousStatus: currentStatus,
      newStatus: status,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order status', details: error.message });
  }
});
/**
 * Extract order ID from message text
 * Looks for patterns like "DKM/YYYYMMDD/000001" or "done DKM/..."
 */
function extractOrderIdFromText(text) {
  if (!text) return null;
  // Match order ID pattern: DKM/YYYYMMDD/000001
  const orderIdPattern = /DKM\/\d{8}\/\d{6}/i;
  const match = text.match(orderIdPattern);
  if (match) {
    return match[0].toUpperCase(); // Normalize to uppercase
  }
  return null;
}
/**
 * Find delivering orders for a customer
 * Sorted by most recent status update (when delivery started)
 */
async function findDeliveringOrdersForCustomer(conversationId) {
  const allOrders = await getAllOrders(1000);
  const waitingListOrders = await getWaitingListOrders();
  const allOrdersCombined = [...allOrders, ...waitingListOrders];
  // Filter to delivering orders for this customer
  const deliveringOrders = allOrdersCombined.filter(order => 
    order.status === 'delivering' && 
    order.conversation_id === conversationId
  // Sort by updated_at DESC (most recently started delivery first)
  // If updated_at is not available, fall back to created_at
  deliveringOrders.sort((a, b) => {
    const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
    return bTime - aTime; // Descending (most recent first)
  });
  return deliveringOrders;
}
/**
 * Handle customer order completion
 * Only customers can mark their own orders as completed
 */
async function handleCustomerOrderCompletion(chatId, customerTelegramId, messageText) {
  try {
    // Get conversation to find customer's orders
    const conversation = await getOrCreateConversation(
      chatId,
      'Customer',
      customerTelegramId
    // Check if message contains explicit order ID
    const explicitOrderId = extractOrderIdFromText(messageText);
    let orderToComplete = null;
    if (explicitOrderId) {
      // Case A: Explicit order ID provided
      // Get the specific order
      const allOrders = await getAllOrders(1000);
      let order = allOrders.find(o => o.id === explicitOrderId);
      if (!order) {
        const waitingListOrders = await getWaitingListOrders();
        order = waitingListOrders.find(o => o.id === explicitOrderId);
      }
      if (!order) {
        await sendTelegramMessage(
          chatId,
          `❌ Pesanan ${explicitOrderId} tidak ditemukan.`
        return;
      }
      // Verify order is in delivering status
      if (order.status !== 'delivering') {
        await sendTelegramMessage(
          chatId,
          `❌ Pesanan ${explicitOrderId} tidak dalam status "Sedang Dikirim".\n` +
          `Status saat ini: ${order.status}`
        return;
      }
      // Verify customer identity matches order
      if (order.conversation_id !== conversation.id) {
        await sendTelegramMessage(
          chatId,
          '❌ Anda tidak memiliki izin untuk menyelesaikan pesanan ini.'
        return;
      }
      orderToComplete = order;
    } else {
      // Case B: No explicit order ID - find delivering orders
      const deliveringOrders = await findDeliveringOrdersForCustomer(conversation.id);
      if (deliveringOrders.length === 0) {
        await sendTelegramMessage(
          chatId,
          '❌ Tidak ada pesanan yang sedang dikirim untuk Anda.\n\n' +
          'Pesanan hanya bisa diselesaikan setelah status "Sedang Dikirim".'
        return;
      }
      if (deliveringOrders.length === 1) {
        // Exactly one delivering order - complete it
        orderToComplete = deliveringOrders[0];
      } else {
        // Multiple delivering orders - ask user to specify
        const orderList = deliveringOrders.map(order => 
          `• ${order.id}`
        ).join('\n');
        await sendTelegramMessage(
          chatId,
          `📋 Anda memiliki ${deliveringOrders.length} pesanan yang sedang dikirim:\n\n` +
          `${orderList}\n\n` +
          `Silakan balas dengan:\n` +
          `"done <Order ID>"\n\n` +
          `Contoh: "done ${deliveringOrders[0].id}"`
        return;
      }
    }
    // Verify customer identity one more time (safety check)
    if (orderToComplete.conversation_id !== conversation.id) {
      await sendTelegramMessage(
        chatId,
        '❌ Anda tidak memiliki izin untuk menyelesaikan pesanan ini.'
      return;
    }
    // Update order status to completed
    try {
      await updateOrderStatus(orderToComplete.id, 'completed');
    } catch (error) {
      // Try waiting list if not in orders
      try {
        await updateWaitingListOrderStatus(orderToComplete.id, 'completed');
      } catch (err) {
        throw error; // Throw original error
      }
    }
    // Send confirmation to customer
    await sendTelegramMessage(
      chatId,
      `✅ **Terima kasih!**\n\n` +
      `📋 Order ID: ${orderToComplete.id}\n` +
      `Pesanan telah ditandai sebagai selesai.\n\n` +
      `Terima kasih atas kepercayaan Anda! 🙏`
  } catch (error) {
    await sendTelegramMessage(
      chatId,
      '❌ Terjadi kesalahan saat menandai pesanan sebagai selesai. Silakan coba lagi atau hubungi kami.'
  }
}
/**
 * Customer completion endpoint (for future use with webhooks)
 * POST /api/orders/:orderId/complete
 */
app.post('/api/orders/:id/complete', async (req, res) => {
  try {
    const orderId = decodeURIComponent(req.params.id);
    const { chatId, customerTelegramId } = req.body;
    if (!chatId || !customerTelegramId) {
      return res.status(400).json({ 
        error: 'chatId and customerTelegramId are required for customer verification' 
      });
    }
    // Get order
    const allOrders = await getAllOrders(1000);
    let order = allOrders.find(o => o.id === orderId);
    if (!order) {
      const waitingListOrders = await getWaitingListOrders();
      order = waitingListOrders.find(o => o.id === orderId);
    }
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    // Verify order is in delivering status
    if (order.status !== 'delivering') {
      return res.status(400).json({ 
        error: `Order is not in delivering status. Current status: ${order.status}` 
      });
    }
    // Verify customer identity
    const conversation = await getConversationById(order.conversation_id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    // Verify Telegram chat ID matches
    const orderChatId = parseInt(conversation.external_user_id);
    if (orderChatId !== parseInt(chatId) || conversation.platform_reference !== 'telegram') {
      return res.status(403).json({ 
        error: 'Unauthorized: Customer identity does not match order' 
      });
    }
    // Update order status to completed (customer action, not merchant)
    try {
      await updateOrderStatus(orderId, 'completed');
    } catch (error) {
      await updateWaitingListOrderStatus(orderId, 'completed');
    }
    // Get updated order
    const updatedOrders = await getAllOrders(1000);
    const updatedOrder = updatedOrders.find(o => o.id === orderId) ||
      (await getWaitingListOrders()).find(o => o.id === orderId);
    res.json({ 
      order: updatedOrder, 
      message: 'Order marked as completed by customer' 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete order', details: error.message });
  }
});
/**
 * Get messages by conversation
 */
app.get('/api/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const messages = await getMessagesByConversation(conversationId, limit);
    res.json({ messages, count: messages.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get messages', details: error.message });
  }
});
/**
 * Get spreadsheet link
 */
app.get('/api/spreadsheet', (req, res) => {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (spreadsheetId) {
    res.json({
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      spreadsheetId: spreadsheetId,
    });
  } else {
    res.status(404).json({ error: 'Spreadsheet ID not configured' });
  }
});
// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Catch-all handler: serve index.html for any non-API routes
// This allows React Router to handle client-side routing
// IMPORTANT: This must be the LAST route handler
app.get('*', (req, res) => {
  // If it's an API route that wasn't matched, return 404 JSON
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  // Serve the React app's index.html for all other routes
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      // If dist folder doesn't exist (e.g., in development), return a helpful message
      res.status(404).json({
        message: 'Frontend not built. Run "npm run build" in the root directory.',
        error: 'dist folder not found',
      });
    }
  });
});
// Start server
app.listen(PORT, async () => {
  `);
  try {
    // Initialize Google Sheets
    await initializeStorage();
  } catch (error) {
    `);
  }
  // Start polling only in development mode
  // In production, use webhook instead
  if (process.env.NODE_ENV === 'production') {
    `);
  } else {
    `);
    startPolling();
  }
  // Start waiting list checker (check every hour)
  startWaitingListChecker();
  // Initialize Reminders sheet
  try {
    await ensureRemindersSheet();
  } catch (error) {
  }
  // Ensure Orders sheet has payment headers
  try {
    await ensureOrdersPaymentHeaders();
  } catch (error) {
  }
  // Start reminder scheduler (check every 6 hours)
  startReminderScheduler();
});
/**
 * Start reminder scheduler (checks for H-4/H-3/H-1 reminders)
 */
function startReminderScheduler() {
  // Check immediately on startup
  checkAndSendRemindersForToday(sendTelegramMessage);
  // Then check every 6 hours
  setInterval(() => {
    checkAndSendRemindersForToday(sendTelegramMessage);
  }, 6 * 60 * 60 * 1000); // 6 hours
}
/**
 * Check waiting list for orders due today and send reminders
 */
async function checkAndSendReminders() {
  try {
    const dueOrders = await checkWaitingList();
    if (dueOrders.length === 0) {
      return;
    }
    due today`);
    for (const order of dueOrders) {
      // Send reminder message
      let reminderMessage = `🔔 **REMINDER: PESANAN SUDAH TIBA!**\n\n` +
        `📋 Order ID: ${order.id}\n` +
        `👤 Customer: ${order.customer_name}\n` +
        `📞 Phone: ${order.phone_number}\n` +
        `📍 Address: ${order.address}\n` +
        `📅 Tanggal: ${order.event_date}\n` +
        `🕐 Jam: ${order.delivery_time || 'TBD'}\n\n` +
        `📦 Items:\n`;
      (order.items || []).forEach(item => {
        reminderMessage += `• ${item.quantity}x ${item.name}\n`;
      });
      reminderMessage += `\n⚠️ **Action Required:**\n`;
      reminderMessage += `Silakan proses pesanan ini sekarang!`;
      // TODO: Send to admin/owner (for now, just log)
      // In future, can send to admin Telegram chat or email
      // Mark reminder as sent
      await markReminderSent(order.id);
      // Also move order from waiting list to orders (optional)
      // You can implement this if needed
    }
    `);
  } catch (error) {
  }
}
/**
 * Start waiting list checker (runs every hour)
 */
function startWaitingListChecker() {
  // Check immediately on startup
  checkAndSendReminders();
  // Then check every hour
  setInterval(() => {
    checkAndSendReminders();
  }, 60 * 60 * 1000); // 1 hour
}
// Cleanup on exit
process.on('SIGINT', () => {
  stopPolling();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopPolling();
  process.exit(0);
});
