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
  parseOrderFromMessageAuto,
  detectOrderFormat,
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
  runDailyRemindersJob,
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

// Cache bot username to avoid repeated API calls
let cachedBotUsername = null;

/**
 * Get bot username from Telegram API (cached)
 */
async function getBotUsername() {
  if (cachedBotUsername) {
    return cachedBotUsername;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return null;
  }

  try {
    const url = `${TELEGRAM_API_BASE}${botToken}/getMe`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.ok && data.result?.username) {
      cachedBotUsername = data.result.username;
      return cachedBotUsername;
    }
  } catch (error) {
    console.warn('⚠️ Could not fetch bot username:', error.message);
  }

  return null;
}

/**
 * Check if message contains bot mention
 * @param {string} text - Message text
 * @param {string} botUsername - Bot username (without @)
 * @returns {boolean} True if message mentions the bot
 */
function containsBotMention(text, botUsername) {
  if (!text || !botUsername) {
    return false;
  }

  // Check for @username mention (case-insensitive)
  const mentionPattern = new RegExp(`@${botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  return mentionPattern.test(text);
}

/**
 * Strip bot mentions from text
 * @param {string} text - Message text
 * @param {string} botUsername - Bot username (without @)
 * @returns {string} Text with mentions removed
 */
function stripBotMentions(text, botUsername) {
  if (!text || !botUsername) {
    return text;
  }

  // Remove @username mentions (case-insensitive)
  const mentionPattern = new RegExp(`@${botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
  return text.replace(mentionPattern, '').trim();
}

// Track processed order confirmations to prevent duplicates
const processedConfirmations = new Set();
// Track invoices sent to prevent double-sending (10 second TTL)
const sentInvoices = new Map(); // key: orderId, value: { sentAt: timestamp }
// Track processed command messages to prevent duplicate replies
const processedCommands = new Set(); // key: update_id or `${chatId}:${messageId}`

// Chat-scoped order state (prevents state bleeding between chats)
// key: chatId (string), value: { mode, startedAt, lastCommand, ... }
const orderStateByChat = new Map();
const ORDER_STATE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Get chat-scoped state key
 * For groups, include user_id to support per-user state within group
 * For private chats, chat_id is sufficient
 */
function getChatStateKey(chatId, userId, chatType) {
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
function getOrderState(chatId, userId, chatType) {
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
function setOrderState(chatId, userId, chatType, mode) {
  const key = getChatStateKey(chatId, userId, chatType);
  orderStateByChat.set(key, {
    mode,
    startedAt: Date.now(),
    chatId,
    userId,
    chatType,
  });
  console.log(`[STATE] chat_id=${chatId} from=${userId} is_group=${chatType === 'group' || chatType === 'supergroup'} mode_after=${mode}`);
}

/**
 * Clear order state for a chat
 */
function clearOrderState(chatId, userId, chatType) {
  const key = getChatStateKey(chatId, userId, chatType);
  const state = orderStateByChat.get(key);
  if (state) {
    orderStateByChat.delete(key);
    console.log(`[STATE] chat_id=${chatId} from=${userId} mode_before=${state.mode} mode_after=cleared`);
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
    console.log(`🧹 [STATE] Cleaned up ${cleaned} expired order states`);
  }
}, 5 * 60 * 1000); // Every 5 minutes

/**
 * Step 1: Receive Messages from Telegram Bot
 * Option A: Webhook (for production)
 * Telegram sends messages to this endpoint when customers message the bot
 */
app.post('/api/webhooks/telegram', async (req, res) => {
  console.log('📨 Received Telegram webhook:', JSON.stringify(req.body, null, 2));

  // Always respond 200 OK to Telegram immediately
  res.status(200).send('OK');

  // Process the webhook
  try {
    const update = req.body;

    // Telegram sends updates in this structure
    // Handle both private messages and group messages
    if (update.message) {
      // Process messages with group/supergroup gating
      await handleTelegramMessage(update.message);
    }
    
    // Handle callback queries (button clicks) - works in all chat types
    if (update.callback_query) {
      handleCallbackQuery(update.callback_query);
    }
  } catch (error) {
    console.error('❌ Error processing Telegram webhook:', error);
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
      console.log('✅ Webhook removed (required for polling mode)');
      webhookDeleted = true;
    } else {
      console.log('ℹ️  No webhook to remove (or already removed)');
      webhookDeleted = true;
    }
  } catch (error) {
    console.log('⚠️  Could not check/remove webhook:', error.message);
  }
}

/**
 * Step 1B: Polling Mode (for local development)
 * Instead of webhook, we ask Telegram for new messages every few seconds
 */
async function startPolling() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    console.log('⚠️  TELEGRAM_BOT_TOKEN not set. Polling disabled.');
    return;
  }

  console.log('🔄 Starting Telegram polling (local development mode)...');
  
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
          console.error('❌ Error 409: Webhook conflict. Removing webhook...');
          await deleteWebhook();
          await new Promise(resolve => setTimeout(resolve, 3000));
          return; // Will retry on next poll
        } else if (response.status === 409) {
          // Already tried to delete, just skip this poll
          return;
        }
        
        const errorText = await response.text();
        console.error(`❌ Telegram API error ${response.status}:`, errorText.substring(0, 100));
        return;
      }

      const data = await response.json();

      if (!data.ok) {
        console.error('❌ Telegram API returned error:', data.description);
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
      console.error('❌ Error polling Telegram:', error.message);
    }
  }, 2000); // Poll every 2 seconds

  console.log('✅ Polling started! Bot will check for new messages every 2 seconds.');
}

/**
 * Stop polling (cleanup)
 */
function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('🛑 Polling stopped');
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

    console.log('💬 Manual WhatsApp message input:', { from, text });

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
    console.log('💾 WhatsApp message saved to storage');

    res.json({
      success: true,
      messageId: messageData.id,
      message: 'WhatsApp message stored successfully',
    });
  } catch (error) {
    console.error('❌ Error storing manual WhatsApp message:', error);
    res.status(500).json({ error: 'Failed to store message', details: error.message });
  }
});

/**
 * Handle incoming Telegram message from customer
 */
async function handleTelegramMessage(message) {
  const chatType = message.chat?.type || 'unknown';
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const userName = message.from?.first_name || message.from?.username || 'Unknown';
  const messageText = message.text || '';
  
  console.log('💬 New Telegram message received:', {
    from: userName,
    userId: userId,
    chatId: chatId,
    chatType: chatType,
    text: messageText.substring(0, 100) || '',
    messageId: message.message_id,
  });

  // Group/Supergroup message gating (privacy mode)
  // In groups, bot can only receive command messages reliably
  if (chatType === 'group' || chatType === 'supergroup') {
    const isCommand = messageText.startsWith('/');

    console.log(`🔍 [GROUP_GATE] chatType: ${chatType}, isCommand: ${isCommand}`);

    // If not a command, ignore silently (privacy mode)
    if (!isCommand) {
      console.log(`⏸️ [GROUP_GATE] Ignoring message (not a command, privacy mode)`);
      return; // Silent ignore - no response
    }

    // Commands are allowed - will be processed below
  }

  try {
    // Get or create conversation
    const conversation = await getOrCreateConversation(
      chatId,
      userName,
      userId
    );

    // Prepare message data
    const messageData = {
      id: `telegram_${message.message_id}`,
      conversationId: conversation.id,
      telegramChatId: chatId,
      from: String(userId),
      fromName: userName,
      fromId: userId,
      text: message.text || '',
      messageType: 'text',
      direction: 'inbound',
      source: 'telegram',
      status: 'delivered',
      telegramMessageId: message.message_id,
    };

    // Save to storage
    await saveMessage(messageData);
    console.log('💾 Telegram message saved to storage');

    // Handle bot commands (works in both private and group chats)
    if (message.text?.startsWith('/')) {
      await handleTelegramCommand(message);
      return;
    }

    // Private chat only: Try to parse order from message (auto-parse)
    // In groups, orders must come via /pesan command (privacy mode)
    let orderProcessed = false;
    if (chatType === 'private') {
      // Check if we're awaiting a form (from previous /pesan command)
      const state = getOrderState(chatId, userId, chatType);
      const shouldParse = state?.mode === 'AWAITING_FORM' || detectOrderFormat(message.text);
      
      if (shouldParse) {
        try {
          // Detect format and parse
          const detectedFormat = detectOrderFormat(message.text);
          console.log(`🔍 [ORDER_PARSE] Private chat auto-parse - format: ${detectedFormat || 'none'}, state: ${state?.mode || 'none'}`);
          
          let parsedOrder;
          try {
            parsedOrder = parseOrderFromMessageAuto(message.text);
            console.log(`[PARSE] chat_id=${chatId} delivery_method="${parsedOrder.delivery_method || 'null'}"`);
            
            // Clear state if order was successfully parsed
            if (parsedOrder.customer_name || parsedOrder.items.length > 0) {
              clearOrderState(chatId, userId, chatType);
            }
          } catch (parseError) {
            // Handle parsing errors (e.g., invalid delivery_fee)
            if (parseError.field === 'delivery_fee') {
              const errorMessage = `❌ ${parseError.message}`;
              await sendTelegramMessage(message.chat.id, errorMessage);
              orderProcessed = true;
              return;
            }
            throw parseError; // Re-throw other errors
          }
      
          console.log(`🔍 [ORDER_PARSE] Parsed fields:`, {
        customer_name: parsedOrder.customer_name ? '✓' : '✗',
        phone_number: parsedOrder.phone_number ? '✓' : '✗',
        address: parsedOrder.address ? '✓' : '✗',
        items_count: parsedOrder.items.length,
        event_date: parsedOrder.event_date ? '✓' : '✗',
        delivery_time: parsedOrder.delivery_time ? '✓' : '✗',
      });
      
      // Get price list to check if notes are actually items
      const priceList = await getPriceList();
      
      // Move price list items from notes to items
      const { items, notes } = separateItemsFromNotes(parsedOrder.items, parsedOrder.notes, priceList);
      parsedOrder.items = items;
      parsedOrder.notes = notes;
      
      const validation = validateOrder(parsedOrder);

      if (validation.valid) {
        console.log(`✅ [ORDER_PARSE] Valid order detected in message`);
        console.log('✅ [ORDER_PARSE] Order detected in message!', {
          customer: parsedOrder.customer_name,
          items: parsedOrder.items.length,
        });
        
        // Mark as processed IMMEDIATELY to prevent fall-through
        orderProcessed = true;
        console.log(`✅ [ORDER_HANDLER] Order processed, setting orderProcessed=true, will return early`);

        // Generate order ID (MUST be done before any operations)
        const orderId = await generateOrderId();
        if (!orderId) {
          throw new Error('Failed to generate order ID');
        }
        console.log(`🔍 [ORDER_CREATE] Generated Order ID: ${orderId}`);
        
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
          delivery_fee: parsedOrder.delivery_fee !== null && parsedOrder.delivery_fee !== undefined ? parsedOrder.delivery_fee : null, // Biaya Pengiriman (Ongkir)
          delivery_method: parsedOrder.delivery_method || null, // Metode pengiriman (stored in Orders.delivery_method)
          status: 'pending',
          created_at: new Date().toISOString(),
        };
        
        console.log(`[TRACE delivery_fee] before_save.delivery_fee=${orderData.delivery_fee}`);
        console.log(`[TRACE save] delivery_method="${orderData.delivery_method}"`);
        console.log(`[PARSE] chat_id=${chatId} delivery_method="${parsedOrder.delivery_method || 'null'}"`);

        // Check if order date is in the future
        const isFuture = isFutureDate(orderData.event_date);
        
        if (isFuture) {
          // Save to waiting list for future orders (owner/admin tracking - customer still needs to confirm)
          // Note: saveToWaitingList and saveOrder now check for duplicates internally
          orderData.status = 'waiting';
          try {
            await saveToWaitingList(orderData);
          } catch (error) {
            console.error('❌ [ORDER_CREATE] Error saving to WaitingList:', error.message);
            throw error; // Re-throw to be caught by outer handler
          }
          
          // Also save to Orders sheet with "pending_confirmation" status for confirmation flow
          orderData.status = 'pending_confirmation';
          try {
            await saveOrder(orderData);
          } catch (error) {
            console.error('❌ [ORDER_CREATE] Error saving to Orders:', error.message);
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
          console.log(`✅ [ORDER_HANDLER] Order confirmation sent (future date), orderProcessed=true, returning early`);
          return; // CRITICAL: Return immediately to prevent fall-through
        } else {
          // Save order to Google Sheets with status "pending_confirmation" (current date or past)
          orderData.status = 'pending_confirmation';
          try {
            await saveOrder(orderData);
          } catch (error) {
            console.error('❌ [ORDER_CREATE] Error saving order:', error.message);
            throw error; // Re-throw to be caught by outer handler
          }
          
          // Create reminders for future orders (H-4, H-3, H-1)
          // Reminder creation is based ONLY on Event Date (not payment status, order status, etc.)
          // NOTE: Reminders are NO LONGER created at order creation time.
          // They are handled by the daily job (runDailyRemindersJob) which reads Orders once per day.
          // This reduces Google Sheets READ requests and avoids 429 rate limits.
          if (orderData.event_date) {
            console.log(`ℹ️ [ORDER_CREATE] Reminder will be processed by daily job (event_date: ${orderData.event_date})`);
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
          // Use reply_to_message_id for group chats to make it clear which order we're responding to
          const replyToId = message.chat.type !== 'private' ? message.message_id : null;
          await sendTelegramMessage(message.chat.id, confirmationText, replyMarkup, replyToId);
          // orderProcessed already set above, but ensure it's still true
          orderProcessed = true;
          console.log(`✅ [ORDER_HANDLER] Order confirmation sent, orderProcessed=true, returning early`);
          return; // CRITICAL: Return immediately to prevent fall-through
        }
      } else {
        // Order format detected but incomplete
        console.log('⚠️ Order format detected but incomplete:', validation.errors);
        
        // Always send helpful incomplete order message if it looks like an order attempt
        if (parsedOrder.customer_name || parsedOrder.phone_number || parsedOrder.items.length > 0) {
          const isEnglish = detectLanguage(message.text);
          const incompleteMessage = getIncompleteOrderMessage(validation.errors, isEnglish);
          
          // Include format template if parse failed
          const formatTemplate = `\n\n📝 **Format Pesanan:**\n` +
            `Nama Pemesan: [Nama]\n` +
            `Nama Penerima: [Nama]\n` +
            `No HP Penerima: [Nomor HP]\n` +
            `Alamat Penerima: [Alamat lengkap]\n\n` +
            `Nama Event (jika ada): -\n` +
            `Durasi Event (dalam jam): -\n\n` +
            `Tanggal Event: DD/MM/YYYY\n` +
            `Waktu Kirim (jam): HH:MM\n\n` +
            `Detail Pesanan:\n` +
            `• [Jumlah] x [Nama Item]\n\n` +
            `Packaging Styrofoam (1 box 40K untuk 50 cup): YA/TIDAK\n` +
            `Metode pengiriman: Pickup/GrabExpress/Custom\n` +
            `Biaya Pengiriman (Rp): [Nominal]\n` +
            `Notes: [Catatan]\n\n` +
            `Mendapatkan info Dawet Kemayu Menteng dari: [Sumber]`;
          
          const fullMessage = incompleteMessage + formatTemplate;
          await sendTelegramMessage(message.chat.id, fullMessage);
          console.log('📤 [ORDER_HANDLER] Sent incomplete order guidance message');
          orderProcessed = true; // Mark as processed (even if incomplete)
          console.log(`✅ [ORDER_HANDLER] Incomplete order handled, orderProcessed=true, returning early`);
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
          console.error('❌ [ORDER_CREATE] Order was parsed but save failed:', error.message);
          console.error('❌ [ORDER_CREATE] Stack:', error.stack);
          
          // Send error message to user
          const errorMessage = '❌ Maaf, terjadi kesalahan saat menyimpan pesanan Anda. Silakan coba lagi atau hubungi admin.';
          await sendTelegramMessage(message.chat.id, errorMessage);
          orderProcessed = true; // Mark as processed to prevent fall-through
          return; // Exit handler
        } else {
          // This is a parse error - not an order format, continue to other handlers
          // But only log if orderProcessed is still false (meaning it's truly not an order)
          if (!orderProcessed) {
            console.log('⚠️ [ORDER_PARSE] Not an order format or parse error, checking other handlers...');
            console.log('⚠️ [ORDER_PARSE] Error:', error.message);
            console.log('⚠️ [ORDER_PARSE] Parse failed - will try other handlers (menu/FAQ/fallback)');
          } else {
            console.log('✅ [ORDER_PARSE] Order was processed despite error, orderProcessed=true');
          }
        }
        }
      }
    } else {
      // Group/supergroup: non-command messages are already filtered out above
      // This code path should not be reached, but log for safety
      console.log(`⏸️ [ORDER_PARSE] Skipping auto-parse in ${chatType} (orders must use /pesan command)`);
    }

    // CRITICAL: Return early if order was processed to prevent fall-through to menu/FAQ
    if (orderProcessed) {
      console.log('✅ [ORDER_PARSE] Order processed, skipping menu/FAQ handlers');
      return; // Exit handler to prevent extra messages
    }

    // Only handle menu/FAQ/completion if order was not processed
    if (!orderProcessed) {
      // Handle customer order completion keywords
      const completionKeywords = ['received', 'selesai', 'done', 'sudah diterima', 'complete'];
      const messageTextLower = message.text?.toLowerCase().trim() || '';
      const isCompletionKeyword = completionKeywords.some(keyword => 
        messageTextLower === keyword || messageTextLower.includes(keyword)
      );
      
      if (isCompletionKeyword) {
        await handleCustomerOrderCompletion(message.chat.id, message.from?.id, message.text);
        return;
      }

      // Handle menu request
      if (isMenuRequest(message.text)) {
        const menuMessage = await formatMenuMessage();
        const replyToId = message.chat.type !== 'private' ? message.message_id : null;
        await sendTelegramMessage(message.chat.id, menuMessage, null, replyToId);
        return;
      }

      // Handle FAQ questions (ONLY if not an order)
      // Double-check: if orderProcessed is true, skip FAQ
      if (!orderProcessed && isFAQQuestion(message.text)) {
        console.log(`🔍 [FAQ_HANDLER] FAQ question detected: ${message.text.substring(0, 50)}...`);
        const faqAnswer = getFAQAnswer(message.text);
        const replyToId = message.chat.type !== 'private' ? message.message_id : null;
        await sendTelegramMessage(message.chat.id, faqAnswer, null, replyToId);
        console.log(`📤 [FAQ_HANDLER] FAQ answer sent`);
        return;
      } else if (orderProcessed) {
        console.log(`⏸️ [FAQ_HANDLER] Skipped because order was processed`);
      }
      
      // Fallback: Send friendly message for unhandled messages (NEVER send location)
      // Only send fallback if order was NOT processed
      if (!orderProcessed && canSendFallback(message.chat.id)) {
        const isEnglish = detectLanguage(message.text);
        const fallbackMessage = getFallbackMessage(isEnglish);
        const replyToId = message.chat.type !== 'private' ? message.message_id : null;
        
        await sendTelegramMessage(message.chat.id, fallbackMessage, null, replyToId);
        markFallbackSent(message.chat.id);
        console.log('📤 [FALLBACK] Sent fallback message to user (no location)');
      } else if (orderProcessed) {
        console.log('⏸️ [FALLBACK] Skipped because order was processed');
      } else {
        console.log('⏸️ [FALLBACK] Skipped (cooldown active)');
      }
    }
  } catch (error) {
    console.error('❌ Error handling Telegram message:', error);
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
    console.log(`🧹 [CALLBACK] Cleaned up processed callbacks cache`);
  }
}, CALLBACK_CLEANUP_INTERVAL);

async function handleCallbackQuery(callbackQuery) {
  const { data, message, from, id: callbackId } = callbackQuery;
  const chatId = message.chat.id;
  const messageId = message.message_id;

  console.log('🔘 [CALLBACK] Callback query received:', data);
  console.log('🔘 [CALLBACK] Chat ID:', chatId, 'Message ID:', messageId, 'Callback ID:', callbackId);

  // Check if this callback was already processed (prevent Telegram retries)
  const callbackKey = `${callbackId}_${data}`;
  if (processedCallbacks.has(callbackKey)) {
    console.log(`⚠️ [CALLBACK] Callback ${callbackId} already processed, ignoring duplicate`);
    // Still answer the callback to stop Telegram retry
    await answerCallbackQuery(callbackId);
    return;
  }
  
  // Mark as processed immediately
  processedCallbacks.add(callbackKey);

  try {
    // Answer callback query IMMEDIATELY to stop Telegram retry
    await answerCallbackQuery(callbackId);
    console.log(`✅ [CALLBACK] Answered callback query ${callbackId} immediately`);

    if (data.startsWith('confirm_order_')) {
      const orderId = data.replace('confirm_order_', '');
      console.log('🔘 [CALLBACK] Processing order confirmation for:', orderId);
      
      // Remove inline keyboard to prevent double-click
      try {
        await editMessageReplyMarkup(chatId, messageId, null);
        console.log(`✅ [CALLBACK] Removed inline keyboard for order ${orderId}`);
      } catch (error) {
        console.warn(`⚠️ [CALLBACK] Could not remove keyboard (non-critical):`, error.message);
      }
      
      await handleOrderConfirmation(chatId, orderId, messageId);
      console.log(`✅ [CALLBACK] Order confirmation completed for ${orderId}, returning early`);
      return; // CRITICAL: Return early to prevent any other processing
    } else if (data.startsWith('cancel_order_')) {
      const orderId = data.replace('cancel_order_', '');
      console.log('🔘 [CALLBACK] Processing order cancellation for:', orderId);
      
      // Remove inline keyboard
      try {
        await editMessageReplyMarkup(chatId, messageId, null);
      } catch (error) {
        console.warn(`⚠️ [CALLBACK] Could not remove keyboard (non-critical):`, error.message);
      }
      
      await handleOrderCancellation(chatId, orderId, messageId);
      console.log(`✅ [CALLBACK] Order cancellation completed for ${orderId}, returning early`);
      return; // CRITICAL: Return early
    } else {
      console.log('⚠️ [CALLBACK] Unknown callback data:', data);
    }
  } catch (error) {
    console.error('❌ [CALLBACK] Error handling callback query:', error);
    console.error(`❌ [CALLBACK] Stack:`, error.stack);
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
    console.error('❌ Error answering callback query:', error);
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
      console.log(`🔒 [ORDER_LOCK] Order ${orderId} is already being processed (locked ${Math.floor((now - existingLock.timestamp) / 1000)}s ago)`);
      return false; // Lock still active
    } else {
      // Lock expired, remove it
      orderFinalizationLocks.delete(orderId);
      console.log(`🔓 [ORDER_LOCK] Lock for order ${orderId} expired, removing`);
    }
  }
  
  // Acquire new lock
  orderFinalizationLocks.set(orderId, { timestamp: now });
  console.log(`🔒 [ORDER_LOCK] Lock acquired for order ${orderId}`);
  return true;
}

/**
 * Release lock for order finalization
 * @param {string} orderId - Order ID to unlock
 */
function releaseOrderLock(orderId) {
  orderFinalizationLocks.delete(orderId);
  console.log(`🔓 [ORDER_LOCK] Lock released for order ${orderId}`);
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
    console.log(`🧹 [ORDER_LOCK] Cleaned up ${cleaned} expired lock(s)`);
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
  console.log(`🔍 [FINALIZE_ORDER] Starting finalization for order: ${orderId}`);
  
  // Acquire lock to prevent concurrent processing
  if (!acquireOrderLock(orderId)) {
    console.log(`⚠️ [FINALIZE_ORDER] Order ${orderId} is already being processed, skipping duplicate finalization`);
    // Return existing order if available
    try {
      const { getOrderById } = await import('./google-sheets.js');
      const existingOrder = await getOrderById(orderId);
      return existingOrder;
    } catch (error) {
      console.error(`❌ [FINALIZE_ORDER] Error getting existing order:`, error.message);
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
      console.log(`❌ [FINALIZE_ORDER] Order ${orderId} not found in Orders or WaitingList`);
      return null;
    }

    // Check if order is already confirmed (idempotency check)
    if (order.status === 'confirmed') {
      console.log(`⚠️ [FINALIZE_ORDER] Order ${orderId} is already confirmed, skipping duplicate finalization`);
      return order; // Return existing order
    }

    console.log(`✅ [FINALIZE_ORDER] Order ${orderId} found, status: ${order.status}, isWaitingList: ${isWaitingListOrder}`);

    // Normalize event_date to YYYY-MM-DD format before finalizing
    const { normalizeEventDate } = await import('./date-utils.js');
    if (order.event_date) {
      try {
        const originalEventDate = order.event_date;
        order.event_date = normalizeEventDate(order.event_date);
        if (order.event_date !== originalEventDate) {
          console.log(`🔍 [FINALIZE_ORDER] Event date normalized: "${originalEventDate}" → "${order.event_date}"`);
        }
      } catch (error) {
        console.error(`❌ [FINALIZE_ORDER] Failed to normalize event_date "${order.event_date}":`, error.message);
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
            console.log(`🔍 [FINALIZE_ORDER] Delivery time normalized: "${originalDeliveryTime}" → "${order.delivery_time}"`);
          }
        } else {
          // Invalid or empty delivery_time, clear it
          console.warn(`⚠️ [FINALIZE_ORDER] Invalid delivery_time format: "${originalDeliveryTime}", clearing it`);
          order.delivery_time = '';
        }
      } catch (error) {
        console.error(`❌ [FINALIZE_ORDER] Failed to normalize delivery_time "${order.delivery_time}":`, error.message);
        // Clear invalid delivery_time to prevent issues in invoice formatting
        order.delivery_time = '';
      }
    }

    // Update order status to "confirmed" in the appropriate sheet
    if (isWaitingListOrder) {
      await updateWaitingListOrderStatus(orderId, 'confirmed');
      console.log(`✅ [FINALIZE_ORDER] Updated WaitingList order status to confirmed`);
    } else {
      await updateOrderStatus(orderId, 'confirmed');
      console.log(`✅ [FINALIZE_ORDER] Updated Orders sheet order status to confirmed`);
    }

    // Ensure order exists in Orders sheet (UPSERT - update if exists, append if not)
    // saveOrder() now implements upsert internally, so we can call it safely
    console.log(`📝 [FINALIZE_ORDER] Upserting order ${orderId} to Orders sheet...`);
    order.status = 'confirmed';
    await saveOrder(order, { skipDuplicateCheck: true }); // skipDuplicateCheck because we have lock + upsert handles it
    console.log(`✅ [FINALIZE_ORDER] Order upserted to Orders sheet (update if exists, append if not)`);

    // NOTE: Reminders are NO LONGER created at order finalization time.
    // They are handled by the daily job (runDailyRemindersJob) which reads Orders once per day.
    // This reduces Google Sheets READ requests and avoids 429 rate limits.
    if (order.event_date) {
      console.log(`ℹ️ [FINALIZE_ORDER] Reminder will be processed by daily job (event_date: ${order.event_date})`);
    }

    // Update order status in memory
    order.status = 'confirmed';
    
    console.log(`✅ [FINALIZE_ORDER] Order ${orderId} finalized successfully`);
    return order;
  } catch (error) {
    console.error(`❌ [FINALIZE_ORDER] Error finalizing order ${orderId}:`, error);
    console.error(`❌ [FINALIZE_ORDER] Stack:`, error.stack);
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
  console.log(`🔘 [ORDER_CONFIRM] Starting confirmation - Order ID: ${orderId}, Chat ID: ${chatId}, Message ID: ${messageId}`);
  
  // Prevent duplicate processing (in-memory guard - additional safety)
  const confirmationKey = `${orderId}_${messageId}`;
  if (processedConfirmations.has(confirmationKey)) {
    console.log(`⚠️ [ORDER_CONFIRM] Order confirmation already processed (in-memory), skipping: ${orderId}`);
    return;
  }
  processedConfirmations.add(confirmationKey);
  
  // Clean up old entries (keep only last 1000)
  if (processedConfirmations.size > 1000) {
    const firstKey = processedConfirmations.values().next().value;
    processedConfirmations.delete(firstKey);
  }
  
  // Additional guard: Check if invoice was already sent for this order (within last 10 seconds)
  const invoiceSent = sentInvoices.get(orderId);
  if (invoiceSent && (Date.now() - invoiceSent.sentAt) < 10000) {
    console.log(`⚠️ [ORDER_CONFIRM] Invoice already sent for order ${orderId} (within last 10s), skipping duplicate send`);
    return;
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
      console.error('❌ [ORDER_CONFIRM] Invoice is invalid:', invoice);
      await sendTelegramMessage(chatId, '❌ Terjadi kesalahan saat membuat invoice. Silakan hubungi admin.');
      return;
    }

    // Send invoice (ONLY ONCE) - This is the ONLY message sent on confirmation
    console.log(`[CONFIRM] invoice=${orderId} sending=RECAP_ONLY`);
    console.log('📄 [ORDER_CONFIRM] Sending invoice (recap) for order:', orderId);
    await sendTelegramMessage(chatId, invoice);
    
    // Mark invoice as sent (with TTL for cleanup)
    sentInvoices.set(orderId, { sentAt: Date.now() });
    
    // Clean up old invoice tracking entries (older than 60 seconds)
    const now = Date.now();
    for (const [oid, data] of sentInvoices.entries()) {
      if (now - data.sentAt > 60000) {
        sentInvoices.delete(oid);
      }
    }

    // NOTE: Payment notification (💰 PEMBAYARAN PENUH) is NOT sent during confirmation.
    // Payment reminders are handled separately by the reminder system (H-4, H-3, H-1).
    // The recap message already contains payment instructions, so no separate payment message is needed.
    
    console.log(`✅ [ORDER_CONFIRM] Order ${orderId} confirmation completed successfully`);
    console.log(`✅ [ORDER_CONFIRM] Returning early to prevent any other processing`);
    return; // CRITICAL: Return early to prevent any other processing
  } catch (error) {
    console.error('❌ [ORDER_CONFIRM] Error confirming order:', error);
    console.error('❌ [ORDER_CONFIRM] Stack:', error.stack);
    await sendTelegramMessage(chatId, '❌ Terjadi kesalahan saat mengkonfirmasi pesanan. Silakan coba lagi.');
    return; // CRITICAL: Return early even on error
  }
}

/**
 * Handle order cancellation (No button clicked)
 */
async function handleOrderCancellation(chatId, orderId, messageId) {
  try {
    console.log('❌ Order cancelled:', orderId);

    // Update order status to "cancelled"
    await updateOrderStatus(orderId, 'cancelled');

    // Edit the confirmation message
    await editMessageText(
      chatId,
      messageId,
      '❌ **Pesanan Dibatalkan**\n\nSilakan kirim ulang pesanan Anda dengan format yang benar.\n\nKetik /help untuk melihat format pesanan.'
    );
  } catch (error) {
    console.error('❌ Error cancelling order:', error);
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
    console.warn('⚠️ [EDIT_MESSAGE] Attempted to edit message with invalid text:', text);
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
        console.warn('⚠️ [EDIT_MESSAGE] Markdown parsing error, retrying as plain text:', error.description);
        
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
          console.error('❌ Error editing message (plain text retry):', retryError);
        }
        return;
      }
      
      console.error('❌ Error editing message:', error);
    }
  } catch (error) {
    console.error('❌ Error editing message:', error);
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
    console.log('✅ [EDIT_KEYBOARD] Removed inline keyboard from message:', messageId);
  } catch (error) {
    console.error('❌ [EDIT_KEYBOARD] Error editing message reply markup:', error);
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
 * Extract command payload (text after command line)
 * For commands like "/pesan@bot\nNama Pemesan: ...", extracts everything after first newline
 * @param {string} messageText - Full message text
 * @returns {string} Payload text (everything after command line)
 */
function extractCommandPayload(messageText) {
  if (!messageText) return '';
  
  // Find first newline after command
  const newlineIndex = messageText.indexOf('\n');
  if (newlineIndex >= 0) {
    return messageText.substring(newlineIndex + 1).trim();
  }
  
  // If no newline, check if there's text after command token on same line
  // Pattern: /command@bot text here
  const commandMatch = messageText.match(/^\/\w+(?:@\w+)?\s+(.+)$/);
  if (commandMatch && commandMatch[1]) {
    return commandMatch[1].trim();
  }
  
  return '';
}

/**
 * Parse command and arguments from message text
 * @param {string} messageText - Full message text
 * @returns {{command: string, args: string[], payload: string}} Parsed command, arguments, and payload
 */
function parseCommand(messageText) {
  if (!messageText) return { command: '', args: [], payload: '' };
  
  // Extract payload (text after command line)
  const payload = extractCommandPayload(messageText);
  
  // Remove bot username suffix for command parsing
  let text = messageText.replace(/@\w+/g, '').trim();
  
  // Get command line (first line only)
  const firstLine = text.split('\n')[0] || text;
  
  // Split by spaces, but preserve quoted strings
  const parts = firstLine.split(/\s+/);
  const command = parts[0] || '';
  const args = parts.slice(1).filter(arg => arg.trim().length > 0);
  
  return { command, args, payload };
}

/**
 * Handle Telegram bot commands (/start, /help, etc.)
 */
async function handleTelegramCommand(message) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const chatType = message.chat?.type || 'unknown';
  const messageText = message.text || '';
  const messageId = message.message_id;
  
  // Deduplication: prevent duplicate command processing
  // Use update_id if available (from webhook context), otherwise use chatId:messageId
  const dedupeKey = message.update_id ? `update_${message.update_id}` : `${chatId}:${messageId}`;
  if (processedCommands.has(dedupeKey)) {
    console.log(`[DEDUP] skip key=${dedupeKey} command="${messageText.substring(0, 20)}"`);
    return; // Already processed, skip
  }
  processedCommands.add(dedupeKey);
  
  // Clean up old entries (keep only last 1000)
  if (processedCommands.size > 1000) {
    const firstKey = processedCommands.values().next().value;
    processedCommands.delete(firstKey);
  }
  
  // Parse command with payload extraction
  const { command: rawCommand, args, payload } = parseCommand(messageText);
  const normalizedCommand = normalizeCommand(rawCommand);
  
  // Log command received
  console.log(`🤖 [COMMAND] Received - command: "${rawCommand}", normalized: "${normalizedCommand}", args: [${args.join(', ')}], payloadLength: ${payload.length}, chatType: ${chatType}, chatId: ${chatId}, userId: ${userId}`);
  
  // If no valid command, handle as unknown
  if (!normalizedCommand) {
    console.log(`⚠️ [COMMAND] Invalid or empty command, treating as unknown`);
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
      );
      break;
    case '/pesan':
      // Set state to AWAITING_FORM for this chat (if no payload)
      const currentState = getOrderState(chatId, userId, chatType);
      console.log(`[STATE] chat_id=${chatId} from=${userId} is_group=${chatType === 'group' || chatType === 'supergroup'} mode_before=${currentState?.mode || 'none'}`);
      
      // Check if payload exists (order form in same message)
      if (payload && payload.trim().length > 0) {
        console.log(`🔍 [PESAN] Payload detected (${payload.length} chars), parsing order...`);
        
        // Clear any existing state (order is being processed)
        clearOrderState(chatId, userId, chatType);
        
        // Parse order from payload
        const detectedFormat = detectOrderFormat(payload);
        console.log(`🔍 [PESAN] Detected format: ${detectedFormat || 'none'}`);
        
        let parsedOrder;
        try {
          parsedOrder = parseOrderFromMessageAuto(payload);
          console.log(`[PARSE] chat_id=${chatId} delivery_method="${parsedOrder.delivery_method || 'null'}"`);
        } catch (parseError) {
          // Handle parsing errors (e.g., invalid delivery_fee)
          if (parseError.field === 'delivery_fee' || parseError.field === 'shipping_fee') {
            const errorMessage = `❌ ${parseError.message}`;
            const replyToId = chatType !== 'private' ? message.message_id : null;
            await sendTelegramMessage(chatId, errorMessage, null, replyToId);
            return;
          }
          throw parseError; // Re-throw other errors
        }
        
        // Get price list to check if notes are actually items
        const priceList = await getPriceList();
        
        // Move price list items from notes to items
        const { items, notes } = separateItemsFromNotes(parsedOrder.items, parsedOrder.notes, priceList);
        parsedOrder.items = items;
        parsedOrder.notes = notes;
        
        const validation = validateOrder(parsedOrder);
        
        if (validation.valid) {
          console.log(`✅ [PESAN] Valid order detected, processing...`);
          console.log(`📊 [PESAN] Parsed items count: ${parsedOrder.items.length}`);
          
          // Process order (similar to handleTelegramMessage order processing)
          const conversation = await getOrCreateConversation(
            chatId,
            message.from?.first_name || message.from?.username || 'Unknown',
            userId
          );
          
          const orderId = await generateOrderId();
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
            delivery_fee: parsedOrder.delivery_fee !== null && parsedOrder.delivery_fee !== undefined ? parsedOrder.delivery_fee : null, // Biaya Pengiriman (Ongkir)
            delivery_method: parsedOrder.delivery_method || null, // Metode pengiriman (stored in Orders.delivery_method)
            status: 'pending',
            created_at: new Date().toISOString(),
          };
          
          console.log(`[PARSE] chat_id=${chatId} delivery_method="${parsedOrder.delivery_method || 'null'}"`);
          
          // Check if order date is in the future
          const isFuture = isFutureDate(orderData.event_date);
          
          if (isFuture) {
            orderData.status = 'waiting';
            await saveToWaitingList(orderData);
            orderData.status = 'pending_confirmation';
            await saveOrder(orderData);
            
            const priceList = await getPriceList();
            const orderSummary = formatOrderSummary(orderData);
            const calculation = calculateOrderTotal(orderData.items, priceList);
            
            let confirmationText = `📋 **KONFIRMASI PESANAN**\n\n`;
            confirmationText += orderSummary;
            confirmationText += `\n\nApakah pesanan ini sudah benar?`;
            
            const replyMarkup = {
              inline_keyboard: [
                [
                  { text: '✅ Ya, Benar', callback_data: `confirm_order_${orderData.id}` },
                  { text: '❌ Tidak, Perbaiki', callback_data: `cancel_order_${orderData.id}` }
                ]
              ]
            };
            
            const replyToId = chatType !== 'private' ? message.message_id : null;
            await sendTelegramMessage(chatId, confirmationText, replyMarkup, replyToId);
          } else {
            // Save order to Google Sheets with status "pending_confirmation" (current date or past)
            orderData.status = 'pending_confirmation';
            await saveOrder(orderData);
            
            const priceList = await getPriceList();
            const orderSummary = formatOrderSummary(orderData);
            const calculation = calculateOrderTotal(orderData.items, priceList);
            
            let confirmationText = `📋 **KONFIRMASI PESANAN**\n\n`;
            confirmationText += orderSummary;
            confirmationText += `\n\nApakah pesanan ini sudah benar?`;
            
            const replyMarkup = {
              inline_keyboard: [
                [
                  { text: '✅ Ya, Benar', callback_data: `confirm_order_${orderData.id}` },
                  { text: '❌ Tidak, Perbaiki', callback_data: `cancel_order_${orderData.id}` }
                ]
              ]
            };
            
            const replyToId = chatType !== 'private' ? message.message_id : null;
            await sendTelegramMessage(chatId, confirmationText, replyMarkup, replyToId);
          }
        } else {
          // Invalid order - send error with missing fields
          console.log(`⚠️ [PESAN] Order validation failed:`, validation.errors);
          const errorMessage = `❌ **Format pesanan belum lengkap**\n\n` +
            `Kesalahan:\n${validation.errors.map(e => `• ${e}`).join('\n')}\n\n` +
            `Silakan perbaiki dan coba lagi.\n` +
            `Ketik /help untuk melihat template lengkap.`;
          const replyToId = chatType !== 'private' ? message.message_id : null;
          await sendTelegramMessage(chatId, errorMessage, null, replyToId);
        }
      } else {
        // No payload - set state to AWAITING_FORM and send instruction
        setOrderState(chatId, userId, chatType, 'AWAITING_FORM');
        const instruction = chatType === 'private' 
          ? 'Silakan paste format pesanan yang sudah diisi ya kak 😊\n(Template ada di /help)'
          : 'Silakan kirim /pesan@dawetkemayumenteng_bot + format pesanan dalam 1 pesan ya kak 😊 (template di /help).';
        await sendTelegramMessage(chatId, instruction);
      }
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
      );
      break;
    case '/help':
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
        'Jumlah x Nama Item\n' +
        'Jumlah x Nama Item\n\n' +
        'Packaging Styrofoam\n' +
        '(1 box Rp40.000 untuk 50 cup): YA / TIDAK\n\n' +
        'Metode Pengiriman:\n' +
        'Pickup / GrabExpress / Custom\n\n' +
        'Biaya Pengiriman (Rp):\n' +
        '(diisi oleh Admin)\n\n' +
        'Notes:\n\n' +
        'Mendapatkan info Dawet Kemayu Menteng dari:\n' +
        'Teman / Instagram / Facebook / TikTok / Lainnya'
      );
      break;
    // Admin commands (PRD requirements)
    case '/new_order':
      console.log(`🔍 [COMMAND] /new_order`);
      handleNewOrder(chatId, userId, sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /new_order handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    case '/parse_order':
      console.log(`🔍 [COMMAND] /parse_order`);
      const replyToMessage = message.reply_to_message;
      handleParseOrder(chatId, userId, messageText, sendTelegramMessage, replyToMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /parse_order handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    case '/order_detail': {
      const orderId = args[0];
      console.log(`🔍 [COMMAND] /order_detail - orderId: ${orderId || 'MISSING'}`);
      handleOrderDetail(chatId, userId, orderId, sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /order_detail handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
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
      console.log(`🔍 [COMMAND] /today_reminder`);
      isAdmin(userId).then(async (isUserAdmin) => {
        if (isUserAdmin) {
          await checkAndSendRemindersForToday(sendTelegramMessage);
          await sendTelegramMessage(chatId, '✅ Reminder check completed. Check logs for details.');
        } else {
          await sendTelegramMessage(chatId, '❌ Anda tidak memiliki akses ke perintah ini.');
        }
      }).catch(error => {
        console.error('❌ [COMMAND] Error in /today_reminder handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/admin_auth': {
      console.log(`🔍 [COMMAND] /admin_auth`);
      handleAdminAuth(chatId, userId, messageText, sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /admin_auth handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/recap_h1': {
      console.log(`🔍 [COMMAND] /recap_h1`);
      handleRecapH1(chatId, userId, sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /recap_h1 handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/orders_date': {
      const dateStr = args[0];
      console.log(`🔍 [COMMAND] /orders_date - dateStr: "${dateStr}"`);
      if (!dateStr) {
        sendTelegramMessage(chatId, '❌ Format: /orders_date YYYY-MM-DD\n\nContoh: /orders_date 2026-01-18\nAtau gunakan: /orders_today, /orders_tomorrow');
        break;
      }
      handleOrdersDate(chatId, userId, dateStr, sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /orders_date handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/orders_today': {
      console.log(`🔍 [COMMAND] /orders_today`);
      handleOrdersDate(chatId, userId, 'today', sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /orders_today handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/orders_tomorrow': {
      console.log(`🔍 [COMMAND] /orders_tomorrow`);
      handleOrdersDate(chatId, userId, 'tomorrow', sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /orders_tomorrow handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    default:
      // Unknown command - respond with friendly message
      console.log(`⚠️ [COMMAND] Unknown command: "${normalizedCommand}"`);
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

    console.log('📤 Sending Telegram message:', { chatId, text });

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
    console.log('💾 Sent message saved to database');

    res.json({
      success: true,
      messageId: result.message_id,
      chatId: chatId,
      message: 'Message sent successfully via Telegram',
    });
  } catch (error) {
    console.error('❌ Error sending Telegram message:', error);
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
    console.warn('⚠️ [SANITIZE_MARKDOWN] Unbalanced bold markers (**), escaping markdown');
    return escapeMarkdown(text);
  }
  
  // Check if code markers are balanced (even number of `)
  if (codeMatches && codeMatches.length % 2 !== 0) {
    console.warn('⚠️ [SANITIZE_MARKDOWN] Unbalanced code markers (`), escaping markdown');
    return escapeMarkdown(text);
  }
  
  // For italic, check if there are unmatched single asterisks (not part of **)
  // This is more complex, so we'll be conservative
  const singleAsterisks = text.match(/(?<!\*)\*(?!\*)/g);
  if (singleAsterisks && singleAsterisks.length % 2 !== 0) {
    console.warn('⚠️ [SANITIZE_MARKDOWN] Unbalanced italic markers (*), escaping markdown');
    return escapeMarkdown(text);
  }
  
  return text;
}

/**
 * Send message via Telegram Bot API
 * Handles markdown parsing errors gracefully by falling back to plain text
 * @param {number|string} chatId - Chat ID to send message to
 * @param {string} text - Message text
 * @param {Object|null} replyMarkup - Inline keyboard markup (optional)
 * @param {number|null} replyToMessageId - Message ID to reply to (for group chats, optional)
 */
async function sendTelegramMessage(chatId, text, replyMarkup = null, replyToMessageId = null) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error('Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN in .env file');
  }

  // Guard: Never send null or undefined text
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    console.warn('⚠️ [SEND_MESSAGE] Attempted to send message with invalid text:', text);
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

  // Add reply_to_message_id for group chats (makes it clear which message we're responding to)
  if (replyToMessageId) {
    payload.reply_to_message_id = replyToMessageId;
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
        console.warn('⚠️ [SEND_MESSAGE] Markdown parsing error, retrying as plain text:', error.description);
        console.warn('⚠️ [SEND_MESSAGE] Problematic text (first 200 chars):', text.substring(0, 200));
        
        // Retry without parse_mode (plain text)
        payload = {
          chat_id: chatId,
          text: text,
        };
        
        if (replyMarkup) {
          payload.reply_markup = replyMarkup;
        }
        
        // Include reply_to_message_id in retry
        if (replyToMessageId) {
          payload.reply_to_message_id = replyToMessageId;
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
        
        console.log('✅ Telegram message sent successfully (as plain text after markdown error):', retryData.result);
        return retryData.result;
      }
      
      throw new Error(`Telegram API error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    if (!data.ok) {
      // If it's a markdown parsing error, retry without parse_mode
      if (data.error_code === 400 && data.description && data.description.includes("can't parse entities")) {
        console.warn('⚠️ [SEND_MESSAGE] Markdown parsing error, retrying as plain text:', data.description);
        console.warn('⚠️ [SEND_MESSAGE] Problematic text (first 200 chars):', text.substring(0, 200));
        
        // Retry without parse_mode (plain text)
        payload = {
          chat_id: chatId,
          text: text,
        };
        
        if (replyMarkup) {
          payload.reply_markup = replyMarkup;
        }
        
        // Include reply_to_message_id in retry
        if (replyToMessageId) {
          payload.reply_to_message_id = replyToMessageId;
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
        
        console.log('✅ Telegram message sent successfully (as plain text after markdown error):', retryData.result);
        return retryData.result;
      }
      
      throw new Error(`Telegram API error: ${data.description}`);
    }

    console.log('✅ Telegram message sent successfully:', data.result);
    return data.result;
  } catch (error) {
    // If it's a markdown parsing error, try one more time as plain text
    if (error.message && error.message.includes("can't parse entities")) {
      console.warn('⚠️ [SEND_MESSAGE] Markdown parsing error in catch block, retrying as plain text');
      
      payload = {
        chat_id: chatId,
        text: text,
      };
      
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }
      
      // Include reply_to_message_id in retry
      if (replyToMessageId) {
        payload.reply_to_message_id = replyToMessageId;
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
      
      console.log('✅ Telegram message sent successfully (as plain text after markdown error):', retryData.result);
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
    console.error('❌ Error getting messages:', error);
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
    console.error('❌ Error getting conversations:', error);
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
      );
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
    console.error('❌ Error getting orders:', error);
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
    console.error('❌ Error getting waiting list:', error);
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
    console.error('❌ Error checking waiting list:', error);
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
    console.log(`🔍 [API_ORDER_DETAIL] Looking up order_id: "${normalizedOrderId}" (original: "${orderId}")`);
    
    const orders = await getAllOrders(1000);
    const order = orders.find(o => {
      const orderIdNormalized = normalizeOrderId(o.id || '');
      return orderIdNormalized === normalizedOrderId;
    });
    
    if (!order) {
      console.log(`⚠️ [API_ORDER_DETAIL] Order ${normalizedOrderId} not found`);
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
    
    console.log(`✅ [API_ORDER_DETAIL] Order found with pricing: total_amount=${orderWithPricing.total_amount}, paid_amount=${orderWithPricing.paid_amount}, payment_status=${orderWithPricing.payment_status}`);
    
    res.json({ order: orderWithPricing });
  } catch (error) {
    console.error('❌ Error getting order:', error);
    console.error('❌ Stack:', error.stack);
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
      console.log(`✅ Order ${orderId} status updated to ${status} in Orders sheet`);
    } catch (error) {
      console.log(`⚠️  Order ${orderId} not found in Orders sheet, checking WaitingList...`);
    }
    
    // Also try to update in WaitingList (order might be in both)
    try {
      await updateWaitingListOrderStatus(orderId, status);
      if (!orderUpdated) {
        orderUpdated = true;
        console.log(`✅ Order ${orderId} status updated to ${status} in WaitingList sheet`);
      } else {
        console.log(`✅ Order ${orderId} status also updated in WaitingList sheet`);
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
          console.log(`📬 Status notification sent to customer for order ${orderId}`);
        } else {
          console.log(`⚠️  Could not send notification for order ${orderId}: No Telegram chat ID found`);
        }
      } catch (error) {
        console.error(`❌ Error sending status notification for order ${orderId}:`, error);
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
    console.error('❌ Error updating order status:', error);
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
  );

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
    console.log('🔍 Customer completion request:', { chatId, customerTelegramId, messageText });

    // Get conversation to find customer's orders
    const conversation = await getOrCreateConversation(
      chatId,
      'Customer',
      customerTelegramId
    );

    // Check if message contains explicit order ID
    const explicitOrderId = extractOrderIdFromText(messageText);
    
    let orderToComplete = null;

    if (explicitOrderId) {
      // Case A: Explicit order ID provided
      console.log(`📋 Explicit order ID found: ${explicitOrderId}`);
      
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
        );
        return;
      }

      // Verify order is in delivering status
      if (order.status !== 'delivering') {
        await sendTelegramMessage(
          chatId,
          `❌ Pesanan ${explicitOrderId} tidak dalam status "Sedang Dikirim".\n` +
          `Status saat ini: ${order.status}`
        );
        return;
      }

      // Verify customer identity matches order
      if (order.conversation_id !== conversation.id) {
        await sendTelegramMessage(
          chatId,
          '❌ Anda tidak memiliki izin untuk menyelesaikan pesanan ini.'
        );
        console.log('⚠️  Customer identity mismatch:', {
          orderId: explicitOrderId,
          orderConversationId: order.conversation_id,
          customerConversationId: conversation.id
        });
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
        );
        return;
      }

      if (deliveringOrders.length === 1) {
        // Exactly one delivering order - complete it
        orderToComplete = deliveringOrders[0];
        console.log(`✅ Found single delivering order: ${orderToComplete.id}`);
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
        );
        return;
      }
    }

    // Verify customer identity one more time (safety check)
    if (orderToComplete.conversation_id !== conversation.id) {
      await sendTelegramMessage(
        chatId,
        '❌ Anda tidak memiliki izin untuk menyelesaikan pesanan ini.'
      );
      console.log('⚠️  Customer identity mismatch:', {
        orderId: orderToComplete.id,
        orderConversationId: orderToComplete.conversation_id,
        customerConversationId: conversation.id
      });
      return;
    }

    // Update order status to completed
    try {
      await updateOrderStatus(orderToComplete.id, 'completed');
      console.log(`✅ Order ${orderToComplete.id} marked as completed by customer`);
    } catch (error) {
      // Try waiting list if not in orders
      try {
        await updateWaitingListOrderStatus(orderToComplete.id, 'completed');
        console.log(`✅ Order ${orderToComplete.id} marked as completed in waiting list`);
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
    );

    console.log(`✅ Customer ${chatId} completed order ${orderToComplete.id}`);
  } catch (error) {
    console.error('❌ Error handling customer order completion:', error);
    await sendTelegramMessage(
      chatId,
      '❌ Terjadi kesalahan saat menandai pesanan sebagai selesai. Silakan coba lagi atau hubungi kami.'
    );
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
    console.error('❌ Error completing order:', error);
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
    console.error('❌ Error getting conversation messages:', error);
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
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Telegram webhook: http://localhost:${PORT}/api/webhooks/telegram`);
  console.log(`💬 Send Telegram: POST http://localhost:${PORT}/api/messages/send`);
  console.log(`📝 Manual WhatsApp: POST http://localhost:${PORT}/api/messages/whatsapp-manual`);
  console.log(`\n📋 Setup Instructions:`);
  console.log(`   1. Set TELEGRAM_BOT_TOKEN in .env file`);
  console.log(`   2. Set DATABASE_URL in .env file (PostgreSQL)`);
  console.log(`   3. For LOCAL development: Polling will start automatically`);
  console.log(`\n🔄 Initializing Google Sheets storage...`);
  
  try {
    // Initialize Google Sheets
    await initializeStorage();
    console.log(`✅ Google Sheets ready`);
  } catch (error) {
    console.error(`⚠️  Google Sheets initialization failed:`, error.message);
    console.log(`   Make sure GOOGLE_SERVICE_ACCOUNT_KEY_FILE and GOOGLE_SPREADSHEET_ID are set in .env`);
    console.log(`   Continuing without storage (messages stored in memory only)`);
  }
  
  // Start polling only in development mode
  // In production, use webhook instead
  if (process.env.NODE_ENV === 'production') {
    console.log(`\n🌐 Production mode: Using webhook (polling disabled)`);
    console.log(`   Make sure webhook is set: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_URL>/api/webhooks/telegram`);
  } else {
    console.log(`\n🔄 Development mode: Starting polling...`);
    console.log(`   (This will automatically remove any existing webhook)`);
    startPolling();
  }
  
  // Start waiting list checker (check every hour)
  startWaitingListChecker();
  
  // Initialize Reminders sheet
  try {
    await ensureRemindersSheet();
    console.log('✅ Reminders sheet ready');
  } catch (error) {
    console.error('⚠️ Reminders sheet initialization failed:', error.message);
  }
  
  // Ensure Orders sheet has payment headers
  try {
    await ensureOrdersPaymentHeaders();
    console.log('✅ Orders payment headers ready');
  } catch (error) {
    console.error('⚠️ Orders payment headers initialization failed:', error.message);
  }
  
  // Start reminder scheduler (check every 6 hours)
  startReminderScheduler();
});

/**
 * Start reminder scheduler (checks for H-4/H-3/H-1 reminders)
 */
function startReminderScheduler() {
  // Run daily job immediately on startup
  runDailyRemindersJob(sendTelegramMessage);
  
  // Then run once per day (every 24 hours)
  setInterval(() => {
    runDailyRemindersJob(sendTelegramMessage);
  }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds
  
  console.log('✅ Reminder scheduler started (runs daily job every 24 hours)');
}

/**
 * Check waiting list for orders due today and send reminders
 */
async function checkAndSendReminders() {
  try {
    console.log('🔄 Checking waiting list for due orders...');
    const dueOrders = await checkWaitingList();
    
    if (dueOrders.length === 0) {
      console.log('✅ No orders due today');
      return;
    }
    
    console.log(`📬 Found ${dueOrders.length} order(s) due today`);
    
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
      console.log(`📬 Reminder for order ${order.id}:`);
      console.log(reminderMessage);
      
      // Mark reminder as sent
      await markReminderSent(order.id);
      
      // Also move order from waiting list to orders (optional)
      // You can implement this if needed
    }
    
    console.log(`✅ Sent ${dueOrders.length} reminder(s)`);
  } catch (error) {
    console.error('❌ Error checking waiting list:', error);
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
  
  console.log('✅ Waiting list checker started (checks every hour)');
}

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopPolling();
  process.exit(0);
});
