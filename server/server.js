/**
 * DAWET Backend Server
 * Handles Telegram bot and manual WhatsApp message input
 * (Temporary solution while waiting for WhatsApp API access)
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Validate environment variables at startup
import { validateEnv } from './src/config/env.js';

// Import from repositories directly
import { initializeStorage } from './google-sheets.js'; // TODO: Move to storage.repo.js
import { saveMessage, getOrCreateConversation, getAllMessages, getMessagesByConversation, getAllConversations, getConversationById } from './src/repos/conversations.repo.js';
import { saveOrder, getAllOrders, generateOrderId, updateOrderStatus, getOrderById, ensureOrdersPaymentHeaders } from './src/repos/orders.repo.js';
import { markReminderSent } from './src/services/reminder-system.js';
import { getPriceList } from './src/repos/price-list.repo.js';
import {
  validateStatusTransition,
  getStatusNotificationMessage,
  getTelegramChatIdFromOrder,
} from './src/services/order-status-notifications.js';
import {
  parseOrderFromMessage,
  parseOrderFromMessageAuto,
  detectOrderFormat,
  validateOrder,
  formatOrderSummary,
} from './src/services/order-parser.js';
import {
  formatInvoice,
  calculateOrderTotal,
  separateItemsFromNotes,
  formatPaymentNotification,
} from './src/services/price-calculator.js';
import { formatPrice, escapeMarkdown } from './src/utils/formatting.js';
import { formatOrderConfirmation } from './src/utils/order-formatter.js';
import { ORDER_STATUS } from './src/utils/constants.js';
import { ORDER_NOT_FOUND, INVOICE_ERROR } from './src/utils/messages.js';
import {
  formatMenuMessage,
  isMenuRequest,
  isFAQQuestion,
  getFAQAnswer,
} from './src/utils/bot-menu.js';
import {
  isFutureDate,
  formatDate,
  daysUntilDelivery,
} from './src/utils/date-utils.js';
import {
  handleNewOrder,
  handleParseOrder,
  handleOrderDetail,
  handleStatus,
  handleEditOrder,
  handlePay,
  handlePayWithEvidence,
  handlePaymentStatus,
  handlePaymentConfirmation,
  handleAdminAuth,
  handleRecapH1,
  handleOrdersDate,
  handleCancel,
  handleComplete,
} from './admin-bot-commands.js';
import { isAdmin } from './src/middleware/adminGuard.js';
import {
  checkAndSendRemindersForToday,
  runDailyRemindersJob,
  ensureRemindersSheet,
} from './src/services/reminder-system.js';
import {
  getFallbackMessage,
  getIncompleteOrderMessage,
  canSendFallback,
  markFallbackSent,
  detectLanguage,
} from './src/utils/message-fallback.js';
import { sendTelegramMessage } from './src/services/telegramService.js';
import {
  processedConfirmations,
  sentInvoices,
  processedCommands,
  processedCallbacks,
  orderStateByChat,
  orderFinalizationLocks,
  ORDER_STATE_TTL_MS,
  LOCK_TTL_MS,
  getChatStateKey,
  getOrderState,
  setOrderState,
  clearOrderState,
  acquireOrderLock,
  releaseOrderLock,
  cleanupExpiredLocks,
} from './src/state/store.js';
import { routeTelegramMessage } from './src/handlers/telegramRouter.js';
import { handleCallbackQuery } from './src/handlers/callbackHandler.js';

// Get directory paths for ES modules (needed for .env path resolution)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file only in local development (not on Render)
// On Render, environment variables are provided directly by the platform
if (process.env.NODE_ENV !== 'production' || !process.env.RENDER) {
  // Try to load .env from Ready to Deploy root (for local development)
  const envPath = path.resolve(__dirname, '../.env');
  dotenv.config({ path: envPath });
}

// Validate required environment variables at startup
try {
  validateEnv();
  console.log('✅ Environment variables validated');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

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
      await routeTelegramMessage(update.message);
    }
    
    // Handle callback queries (button clicks) - works in all chat types
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
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
            routeTelegramMessage(update.message);
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
  const messageText = message.text || message.caption || '';
  
  console.log('💬 New Telegram message received:', {
    from: userName,
    userId: userId,
    chatId: chatId,
    chatType: chatType,
    text: messageText.substring(0, 100) || '',
    messageId: message.message_id,
    hasPhoto: !!message.photo,
    hasDocument: !!message.document,
  });

  // Check for photo/document with /pay command or order_id pattern
  // Check both caption and text (user might type /pay in text and upload photo)
  const captionText = (message.caption || '').trim();
  const messageTextForPay = (message.text || '').trim();
  const hasPayCommand = captionText.toLowerCase().includes('/pay') || messageTextForPay.toLowerCase().includes('/pay');
  const hasOrderIdPattern = /DKM\/\d{8}\/\d{6}/i.test(captionText) || /DKM\/\d{8}\/\d{6}/i.test(messageTextForPay);
  
  if ((message.photo || message.document) && (hasPayCommand || hasOrderIdPattern)) {

    await handlePayWithEvidence(chatId, userId, message, sendTelegramMessage);
    return;
  }

  // Group/Supergroup message gating (privacy mode)
  // In groups, bot can only receive command messages reliably
  if (chatType === 'group' || chatType === 'supergroup') {
    const isCommand = messageText.startsWith('/');

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
      text: message.text || message.caption || '',
      messageType: message.photo ? 'photo' : message.document ? 'document' : 'text',
      direction: 'inbound',
      source: 'telegram',
      status: 'delivered',
      telegramMessageId: message.message_id,
    };

    // Save to storage
    await saveMessage(messageData);

    // Handle bot commands (works in both private and group chats)
    if (message.text?.startsWith('/') || message.caption?.startsWith('/')) {
      await handleTelegramCommand(message);
      return;
    }

    // Check for payment confirmation (YES/NO)
    const messageTextUpper = (messageText || '').toUpperCase().trim();
    if (messageTextUpper === 'YES' || messageTextUpper === 'NO') {
      const handled = await handlePaymentConfirmation(chatId, userId, messageTextUpper, sendTelegramMessage);
      if (handled) {
        return; // Payment confirmation handled
      }
    }

    // Check for manual confirmation/cancellation responses (Y/Ya/T/Tidak)
    const messageTextLower = (messageText || '').toLowerCase().trim();
    const isConfirmation = messageTextLower === 'y' || messageTextLower === 'ya';
    const isCancellation = messageTextLower === 't' || messageTextLower === 'tidak';
    
    if (isConfirmation || isCancellation) {

      // Find most recent pending order for this conversation
      const allOrders = await getAllOrders(1000);
      const pendingOrders = allOrders.filter(order => 
        order.conversation_id === conversation.id && 
        order.status === ORDER_STATUS.PENDING_CONFIRMATION
      );
      
      // Sort by created_at (most recent first) and get the first one
      const pendingOrder = pendingOrders.length > 0 
        ? pendingOrders.sort((a, b) => {
            const dateA = new Date(a.created_at || 0);
            const dateB = new Date(b.created_at || 0);
            return dateB - dateA; // Most recent first
          })[0]
        : null;
      
      if (pendingOrder) {

        if (isConfirmation) {
          // Process confirmation (same as button click)
          await handleOrderConfirmation(chatId, pendingOrder.id, null);

          return; // Exit early
        } else {
          // Process cancellation
          await handleOrderCancellation(chatId, pendingOrder.id, null);

          return; // Exit early
        }
      } else {

        // Continue with normal flow (might be responding to something else)
      }
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

          let parsedOrder;
          try {
            parsedOrder = parseOrderFromMessageAuto(message.text);

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
          delivery_fee: parsedOrder.delivery_fee !== null && parsedOrder.delivery_fee !== undefined ? parsedOrder.delivery_fee : null, // Biaya Pengiriman (Ongkir)
          delivery_method: parsedOrder.delivery_method || null, // Metode pengiriman (stored in Orders.delivery_method)
          status: 'pending',
          created_at: new Date().toISOString(),
        };



        // Check if order date is in the future
        const isFuture = isFutureDate(orderData.event_date);
        
        if (isFuture) {
          // Save to Orders sheet with "pending_confirmation" status (reminders handled by daily job)
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

          // Create confirmation message using shared formatter
          const confirmationText = await formatOrderConfirmation(orderData, calculation, orderSummary);

          // Send confirmation message without inline keyboard (manual response)
          await sendTelegramMessage(message.chat.id, confirmationText);
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

          // Create confirmation message with order summary and price info
          let confirmationText = `📋 **KONFIRMASI PESANAN**\n\n`;
          confirmationText += orderSummary;
          
          // Calculate packaging fee
          let packagingFee = 0;
          let packagingBoxes = 0;
          const hasPackaging = orderData.notes?.some(note => 
            note.toLowerCase().includes('packaging') && 
            (note.toLowerCase().includes('ya') || note.toLowerCase().includes('yes'))
          );
          if (hasPackaging) {
            const totalCups = orderData.items.reduce((sum, item) => {
              const name = (item.name || '').toLowerCase();
              if (name.includes('dawet') && (name.includes('small') || name.includes('medium') || name.includes('large')) && !name.includes('botol')) {
                return sum + (item.quantity || 0);
              }
              return sum;
            }, 0);
            packagingBoxes = Math.ceil(totalCups / 50);
            packagingFee = packagingBoxes * 40000;
          }
          
          // Add items with prices combined
          confirmationText += `\n📦 **Items & Rincian Harga:**\n`;
          calculation.itemDetails.forEach((detail) => {
            if (detail.priceFound && detail.itemTotal > 0) {
              const itemName = (detail.name || '').toLowerCase();
              // Skip packaging items (we'll add calculated one below)
              if (!itemName.includes('packaging') && !itemName.includes('styrofoam')) {
                confirmationText += `• ${detail.quantity}x ${detail.name}: Rp ${formatPrice(detail.itemTotal)}\n`;
              }
            }
          });
          
          // Add packaging with price if applicable
          if (packagingFee > 0) {
            confirmationText += `• ${packagingBoxes}x Packaging Styrofoam (50 cup): Rp ${formatPrice(packagingFee)}\n`;
          }
          
          const subtotal = calculation.subtotal + packagingFee;
          const deliveryFee = parseFloat(orderData.delivery_fee) || 0;
          const grandTotal = subtotal + deliveryFee;
          
          confirmationText += `\n💰 Subtotal: Rp ${formatPrice(subtotal)}\n`;
          if (deliveryFee > 0) {
            confirmationText += `🚚 Ongkir: Rp ${formatPrice(deliveryFee)}\n`;
          }
          confirmationText += `💰 Total: Rp ${formatPrice(grandTotal)}\n`;
          
          // Add notes after totals (filter out packaging notes since they're already in Items section)
          if (orderData.notes && orderData.notes.length > 0) {
            const filteredNotes = orderData.notes
              .map(note => {
                // Convert note to string - handle objects and other types
                if (note === null || note === undefined) return null;
                if (typeof note === 'object') {
                  if (note.text) return String(note.text);
                  if (note.note) return String(note.note);
                  if (note.value) return String(note.value);
                  if (note.message) return String(note.message);
                  if (Array.isArray(note)) return note.map(n => String(n)).join(', ');
                  try {
                    return JSON.stringify(note);
                  } catch (e) {
                    return String(note);
                  }
                }
                return String(note);
              })
              .filter(note => {
                if (!note || !note.trim()) return false;
                const noteLower = note.toLowerCase();
                // Filter out packaging-related notes (already shown in Items section)
                return !(noteLower.includes('packaging') && 
                        (noteLower.includes('styrofoam') || noteLower.includes('ya') || noteLower.includes('yes')));
              });
            
            if (filteredNotes.length > 0) {
              confirmationText += `\n📝 **Notes:**\n`;
              filteredNotes.forEach(note => {
                confirmationText += `• ${note}\n`;
              });
            }
          }
          
          confirmationText += `\nApakah pesanan ini sudah benar?\n`;
          confirmationText += `Ketik "Ya" atau "Y" untuk konfirmasi, atau "Tidak" atau "T" untuk membatalkan.`;

          // Send confirmation message without inline keyboard (manual response)
          // Use reply_to_message_id for group chats to make it clear which order we're responding to
          const replyToId = message.chat.type !== 'private' ? message.message_id : null;
          await sendTelegramMessage(message.chat.id, confirmationText, null, replyToId);
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


            console.log('⚠️ [ORDER_PARSE] Parse failed - will try other handlers (menu/FAQ/fallback)');
          } else {

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

        return;
      } else if (orderProcessed) {

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

      } else {
        console.log('⏸️ [FALLBACK] Skipped (cooldown active)');
      }
    }
  } catch (error) {
    console.error('❌ Error handling Telegram message:', error);
  }
}

// handleCallbackQuery is imported from ./src/handlers/callbackHandler.js
// No need to redefine it here


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
      console.error(`❌ [FINALIZE_ORDER] Error getting existing order:`, error.message);
      return null;
    }
  }
  
  try {
    // Get order details from Orders sheet
    const order = await getOrderById(orderId);

    if (!order) {
      return null;
    }

    // Check if order is already confirmed (idempotency check)
    if (order.status === ORDER_STATUS.CONFIRMED) {
      return order; // Return existing order
    }

    // Normalize event_date to YYYY-MM-DD format before finalizing
    const { normalizeEventDate } = await import('./src/utils/date-utils.js');
    if (order.event_date) {
      try {
        const originalEventDate = order.event_date;
        order.event_date = normalizeEventDate(order.event_date);
        if (order.event_date !== originalEventDate) {
          console.log(`ℹ️ [FINALIZE_ORDER] Normalized event_date: "${originalEventDate}" -> "${order.event_date}"`);
        }
      } catch (error) {
        console.error(`❌ [FINALIZE_ORDER] Failed to normalize event_date "${order.event_date}":`, error.message);
        // Don't fail finalization, but log the error
      }
    }
    
    // Normalize delivery_time to HH:MM format before finalizing
    const { normalizeDeliveryTime } = await import('./src/services/price-calculator.js');
    if (order.delivery_time) {
      try {
        const originalDeliveryTime = order.delivery_time;
        // Check if it's a valid non-empty string before normalizing
        if (typeof originalDeliveryTime === 'string' && originalDeliveryTime.trim()) {
          order.delivery_time = normalizeDeliveryTime(originalDeliveryTime);
          if (order.delivery_time !== originalDeliveryTime) {
            console.log(`ℹ️ [FINALIZE_ORDER] Normalized delivery_time: "${originalDeliveryTime}" -> "${order.delivery_time}"`);
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

    // Update order status to "confirmed" in Orders sheet
    await updateOrderStatus(orderId, 'confirmed');

    // Ensure order exists in Orders sheet (UPSERT - update if exists, append if not)
    // saveOrder() now implements upsert internally, so we can call it safely

    order.status = 'confirmed';
    await saveOrder(order, { skipDuplicateCheck: true }); // skipDuplicateCheck because we have lock + upsert handles it
    console.log(`✅ [FINALIZE_ORDER] Order upserted to Orders sheet (update if exists, append if not)`);

    // Create Google Calendar event for confirmed order
    if (order.event_date) {
      try {
        const { createCalendarEvent } = await import('./google-calendar.js');
        const calendarEventId = await createCalendarEvent(order);
        if (calendarEventId) {

        } else {
          console.log(`ℹ️ [FINALIZE_ORDER] Calendar event not created (API not available or not configured)`);
        }
      } catch (calendarError) {
        // Log error but don't fail order confirmation
        console.error(`⚠️ [FINALIZE_ORDER] Failed to create calendar event for order ${orderId}:`, calendarError.message);
      }
    }

    // NOTE: Reminders are NO LONGER created at order finalization time.
    // They are handled by the daily job (runDailyRemindersJob) which reads Orders once per day.
    // This reduces Google Sheets READ requests and avoids 429 rate limits.
    if (order.event_date) {
      console.log(`ℹ️ [FINALIZE_ORDER] Reminder will be processed by daily job (event_date: ${order.event_date})`);
    }

    // Update order status in memory
    order.status = 'confirmed';

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

  // Prevent duplicate processing (in-memory guard - additional safety)
  // For button clicks: use orderId + messageId
  // For manual responses: use orderId only (invoice sent check will handle duplicates)
  const confirmationKey = messageId ? `${orderId}_${messageId}` : orderId;
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
      await sendTelegramMessage(chatId, ORDER_NOT_FOUND);
      return;
    }

    // Get price list and generate invoice
    const priceList = await getPriceList();
    const invoice = formatInvoice(order, priceList);
    const calculation = calculateOrderTotal(order.items, priceList);

    // Remove inline keyboard only if messageId is provided (button click)
    // For manual responses (Y/Ya), messageId will be null, so skip this
    if (messageId) {
      try {
        await editMessageReplyMarkup(chatId, messageId, null);
      } catch (error) {
        console.warn(`⚠️ [ORDER_CONFIRM] Could not remove keyboard (non-critical):`, error.message);
      }
    }

    // Guard: Ensure invoice is valid before sending
    if (!invoice || typeof invoice !== 'string' || invoice.trim().length === 0) {
      console.error('❌ [ORDER_CONFIRM] Invoice is invalid:', invoice);
      await sendTelegramMessage(chatId, INVOICE_ERROR);
      return;
    }

    // Send invoice (ONLY ONCE) - This is the ONLY message sent on confirmation

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

    // Update order status to "cancelled"
    await updateOrderStatus(orderId, 'cancelled');

    // Edit the confirmation message only if messageId is provided (button click)
    // For manual responses (T/Tidak), send a new message instead
    if (messageId) {
      await editMessageText(
        chatId,
        messageId,
        '❌ **Pesanan Dibatalkan**\n\nSilakan kirim ulang pesanan Anda dengan format yang benar.\n\nKetik /help untuk melihat format pesanan.'
      );
    } else {
      // Manual response - send cancellation message
      await sendTelegramMessage(
        chatId,
        '❌ **Pesanan Dibatalkan**\n\nSilakan kirim ulang pesanan Anda dengan format yang benar.\n\nKetik /help untuk melihat format pesanan.'
      );
    }
  } catch (error) {
    console.error('❌ Error cancelling order:', error);
    await sendTelegramMessage(chatId, '❌ Terjadi kesalahan saat membatalkan pesanan. Silakan coba lagi.');
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

      // Check if payload exists (order form in same message)
      if (payload && payload.trim().length > 0) {
        console.log(`🔍 [PESAN] Payload detected (${payload.length} chars), parsing order...`);
        
        // Clear any existing state (order is being processed)
        clearOrderState(chatId, userId, chatType);
        
        // Parse order from payload
        const detectedFormat = detectOrderFormat(payload);

        let parsedOrder;
        try {
          parsedOrder = parseOrderFromMessageAuto(payload);

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

          // Check if order date is in the future
          const isFuture = isFutureDate(orderData.event_date);
          
          if (isFuture) {
            // Save to Orders sheet with "pending_confirmation" status (reminders handled by daily job)
            orderData.status = 'pending_confirmation';
            await saveOrder(orderData);
            
            const priceList = await getPriceList();
            const orderSummary = formatOrderSummary(orderData);
            const calculation = calculateOrderTotal(orderData.items, priceList);
            
            // Create confirmation message with order summary and price info
            let confirmationText = `📋 **KONFIRMASI PESANAN**\n\n`;
            confirmationText += orderSummary;
            
            // Calculate packaging fee
            let packagingFee = 0;
            let packagingBoxes = 0;
            const hasPackaging = orderData.notes?.some(note => 
              note.toLowerCase().includes('packaging') && 
              (note.toLowerCase().includes('ya') || note.toLowerCase().includes('yes'))
            );
            if (hasPackaging) {
              const totalCups = orderData.items.reduce((sum, item) => {
                const name = (item.name || '').toLowerCase();
                if (name.includes('dawet') && (name.includes('small') || name.includes('medium') || name.includes('large')) && !name.includes('botol')) {
                  return sum + (item.quantity || 0);
                }
                return sum;
              }, 0);
              packagingBoxes = Math.ceil(totalCups / 50);
              packagingFee = packagingBoxes * 40000;
            }
            
            // Add items with prices combined
            confirmationText += `\n📦 **Items & Rincian Harga:**\n`;
            calculation.itemDetails.forEach((detail) => {
              if (detail.priceFound && detail.itemTotal > 0) {
                const itemName = (detail.name || '').toLowerCase();
                // Skip packaging items (we'll add calculated one below)
                if (!itemName.includes('packaging') && !itemName.includes('styrofoam')) {
                  confirmationText += `• ${detail.quantity}x ${detail.name}: Rp ${formatPrice(detail.itemTotal)}\n`;
                }
              }
            });
            
            // Add packaging with price if applicable
            if (packagingFee > 0) {
              confirmationText += `• ${packagingBoxes}x Packaging Styrofoam (50 cup): Rp ${formatPrice(packagingFee)}\n`;
            }
            
            const subtotal = calculation.subtotal + packagingFee;
            const deliveryFee = parseFloat(orderData.delivery_fee) || 0;
            const grandTotal = subtotal + deliveryFee;
            
            confirmationText += `\n💰 Subtotal: Rp ${formatPrice(subtotal)}\n`;
            if (deliveryFee > 0) {
              confirmationText += `🚚 Ongkir: Rp ${formatPrice(deliveryFee)}\n`;
            }
            confirmationText += `💰 Total: Rp ${formatPrice(grandTotal)}\n`;
            
            // Add notes after totals
            if (orderData.notes && orderData.notes.length > 0) {
              confirmationText += `\n📝 **Notes:**\n`;
              orderData.notes.forEach(note => {
                // Convert note to string - handle objects and other types
                let noteStr = '';
                if (note === null || note === undefined) {
                  noteStr = '';
                } else if (typeof note === 'object') {
                  if (note.text) noteStr = String(note.text);
                  else if (note.note) noteStr = String(note.note);
                  else if (note.value) noteStr = String(note.value);
                  else if (note.message) noteStr = String(note.message);
                  else if (Array.isArray(note)) noteStr = note.map(n => String(n)).join(', ');
                  else {
                    try {
                      noteStr = JSON.stringify(note);
                    } catch (e) {
                      noteStr = String(note);
                    }
                  }
                } else {
                  noteStr = String(note);
                }
                if (noteStr && noteStr.trim()) {
                  confirmationText += `• ${noteStr}\n`;
                }
              });
            }
            
            confirmationText += `\nApakah pesanan ini sudah benar?\n`;
            confirmationText += `Ketik "Ya" atau "Y" untuk konfirmasi, atau "Tidak" atau "T" untuk membatalkan.`;
            
            const replyToId = chatType !== 'private' ? message.message_id : null;
            await sendTelegramMessage(chatId, confirmationText, null, replyToId);
          } else {
            // Save order to Google Sheets with status "pending_confirmation" (current date or past)
            orderData.status = 'pending_confirmation';
            await saveOrder(orderData);
            
            const priceList = await getPriceList();
            const orderSummary = formatOrderSummary(orderData);
            const calculation = calculateOrderTotal(orderData.items, priceList);
            
            // Create confirmation message with order summary and price info
            let confirmationText = `📋 **KONFIRMASI PESANAN**\n\n`;
            confirmationText += orderSummary;
            
            // Calculate packaging fee
            let packagingFee = 0;
            let packagingBoxes = 0;
            const hasPackaging = orderData.notes?.some(note => 
              note.toLowerCase().includes('packaging') && 
              (note.toLowerCase().includes('ya') || note.toLowerCase().includes('yes'))
            );
            if (hasPackaging) {
              const totalCups = orderData.items.reduce((sum, item) => {
                const name = (item.name || '').toLowerCase();
                if (name.includes('dawet') && (name.includes('small') || name.includes('medium') || name.includes('large')) && !name.includes('botol')) {
                  return sum + (item.quantity || 0);
                }
                return sum;
              }, 0);
              packagingBoxes = Math.ceil(totalCups / 50);
              packagingFee = packagingBoxes * 40000;
            }
            
            // Add items with prices combined
            confirmationText += `\n📦 **Items & Rincian Harga:**\n`;
            calculation.itemDetails.forEach((detail) => {
              if (detail.priceFound && detail.itemTotal > 0) {
                const itemName = (detail.name || '').toLowerCase();
                // Skip packaging items (we'll add calculated one below)
                if (!itemName.includes('packaging') && !itemName.includes('styrofoam')) {
                  confirmationText += `• ${detail.quantity}x ${detail.name}: Rp ${formatPrice(detail.itemTotal)}\n`;
                }
              }
            });
            
            // Add packaging with price if applicable
            if (packagingFee > 0) {
              confirmationText += `• ${packagingBoxes}x Packaging Styrofoam (50 cup): Rp ${formatPrice(packagingFee)}\n`;
            }
            
            const subtotal = calculation.subtotal + packagingFee;
            const deliveryFee = parseFloat(orderData.delivery_fee) || 0;
            const grandTotal = subtotal + deliveryFee;
            
            confirmationText += `\n💰 Subtotal: Rp ${formatPrice(subtotal)}\n`;
            if (deliveryFee > 0) {
              confirmationText += `🚚 Ongkir: Rp ${formatPrice(deliveryFee)}\n`;
            }
            confirmationText += `💰 Total: Rp ${formatPrice(grandTotal)}\n`;
            
            // Add notes after totals
            if (orderData.notes && orderData.notes.length > 0) {
              confirmationText += `\n📝 **Notes:**\n`;
              orderData.notes.forEach(note => {
                // Convert note to string - handle objects and other types
                let noteStr = '';
                if (note === null || note === undefined) {
                  noteStr = '';
                } else if (typeof note === 'object') {
                  if (note.text) noteStr = String(note.text);
                  else if (note.note) noteStr = String(note.note);
                  else if (note.value) noteStr = String(note.value);
                  else if (note.message) noteStr = String(note.message);
                  else if (Array.isArray(note)) noteStr = note.map(n => String(n)).join(', ');
                  else {
                    try {
                      noteStr = JSON.stringify(note);
                    } catch (e) {
                      noteStr = String(note);
                    }
                  }
                } else {
                  noteStr = String(note);
                }
                if (noteStr && noteStr.trim()) {
                  confirmationText += `• ${noteStr}\n`;
                }
              });
            }
            
            confirmationText += `\nApakah pesanan ini sudah benar?\n`;
            confirmationText += `Ketik "Ya" atau "Y" untuk konfirmasi, atau "Tidak" atau "T" untuk membatalkan.`;
            
            const replyToId = chatType !== 'private' ? message.message_id : null;
            await sendTelegramMessage(chatId, confirmationText, null, replyToId);
          }
        } else {
          // Invalid order - send error with missing fields

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

      handleNewOrder(chatId, userId, sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /new_order handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    case '/parse_order':

      const replyToMessage = message.reply_to_message;
      handleParseOrder(chatId, userId, messageText, sendTelegramMessage, replyToMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /parse_order handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    case '/order_detail': {
      const orderId = args[0];

      handleOrderDetail(chatId, userId, orderId, sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /order_detail handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/edit': {

      const replyToMessage = message.reply_to_message;
      handleEditOrder(chatId, userId, messageText, sendTelegramMessage, replyToMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /edit handler:', error);
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
      const parts = (message.text || message.caption || '').split(' ');
      const orderId = parts[1];
      const amount = parts[2];
      handlePay(chatId, message.from?.id, orderId, amount, sendTelegramMessage);
      break;
    }
    case '/payment_status': {
      const parts = (message.text || message.caption || '').split(' ');
      const orderId = parts[1];
      handlePaymentStatus(chatId, message.from?.id, orderId, sendTelegramMessage);
      break;
    }
    case '/cancel': {
      const parts = (message.text || message.caption || '').split(' ');
      const orderId = parts[1];
      handleCancel(chatId, message.from?.id, orderId, sendTelegramMessage);
      break;
    }
    case '/complete': {
      const parts = (message.text || message.caption || '').split(' ');
      const orderId = parts[1];
      handleComplete(chatId, message.from?.id, orderId, sendTelegramMessage);
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
        console.error('❌ [COMMAND] Error in /today_reminder handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/admin_auth': {

      handleAdminAuth(chatId, userId, messageText, sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /admin_auth handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/recap_h1': {

      handleRecapH1(chatId, userId, sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /recap_h1 handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
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
        console.error('❌ [COMMAND] Error in /orders_date handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/orders_today': {

      handleOrdersDate(chatId, userId, 'today', sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /orders_today handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
        sendTelegramMessage(chatId, '❌ Maaf, ada error saat memproses perintah ini. Coba lagi ya.');
      });
      break;
    }
    case '/orders_tomorrow': {

      handleOrdersDate(chatId, userId, 'tomorrow', sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /orders_tomorrow handler:', error);
        console.error('❌ [COMMAND] Stack:', error.stack);
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
    console.error('❌ Error sending Telegram message:', error);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

// escapeMarkdown is now imported from formatting.js (see imports at top of file)

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
    const eventDate = req.query.eventDate; // Filter by event_date (for today/tomorrow)
    
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
    
    // Filter by event_date (for today/tomorrow orders)
    if (eventDate) {
      orders = orders.filter(order => {
        if (!order.event_date) return false;
        // Normalize both dates to YYYY-MM-DD for comparison
        const orderEventDate = order.event_date.toString().trim();
        const targetDate = eventDate.toString().trim();
        // Handle both YYYY-MM-DD and DD/MM/YYYY formats
        if (orderEventDate === targetDate) return true;
        // Try to normalize DD/MM/YYYY to YYYY-MM-DD
        const ddmmyyyyMatch = orderEventDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (ddmmyyyyMatch) {
          const [, day, month, year] = ddmmyyyyMatch;
          const normalized = `${year}-${month}-${day}`;
          return normalized === targetDate;
        }
        return false;
      });
    }
    
    // Filter by date range (created_at)
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
 * Manually trigger reminder job (for admin)
 * DEPRECATED: WaitingList is no longer used - reminders are handled by runDailyRemindersJob
 */
app.post('/api/waiting-list/check', async (req, res) => {
  try {
    // Use reminder job instead of waiting list check
    await runDailyRemindersJob(sendTelegramMessage);
    res.json({ message: 'Reminder job completed (WaitingList is deprecated)', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Error running reminder job:', error);
    res.status(500).json({ error: 'Failed to run reminder job', details: error.message });
  }
});

/**
 * Get single order by ID
 */
app.get('/api/orders/:id', async (req, res) => {
  try {
    // Decode the order ID to handle URL-encoded slashes (e.g., DKM/20260103/000003)
    const orderId = decodeURIComponent(req.params.id);
    
    // getOrderById already handles normalized comparison internally
    console.log(`🔍 [API_ORDER_DETAIL] Looking up order_id: "${orderId}"`);
    const order = await getOrderById(orderId);
    
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
    // getOrderById checks Orders sheet
    const order = await getOrderById(orderId);
    
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
    
    // Get updated order from Orders sheet
    const updatedOrders = await getAllOrders(1000);
    order = updatedOrders.find(o => o.id === orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found in Orders' });
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
  const allOrdersCombined = allOrders;

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

      // Get the specific order from Orders sheet
      const order = await getOrderById(explicitOrderId);

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

      return;
    }

    // Update order status to completed
    try {
      await updateOrderStatus(orderToComplete.id, 'completed');

    } catch (error) {
      throw error; // Re-throw error if order not found
    }

    // Send confirmation to customer
    await sendTelegramMessage(
      chatId,
      `✅ **Terima kasih!**\n\n` +
      `📋 Order ID: ${orderToComplete.id}\n` +
      `Pesanan telah ditandai sebagai selesai.\n\n` +
      `Terima kasih atas kepercayaan Anda! 🙏`
    );

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

    // Get order from Orders sheet
    const order = await getOrderById(orderId);

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
      throw error; // Re-throw error if order not found
    }

    // Get updated order
    const updatedOrders = await getAllOrders(1000);
    const updatedOrder = updatedOrders.find(o => o.id === orderId);

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

/**
 * Kill process using the specified port (Windows)
 * This prevents EADDRINUSE errors when restarting the server
 */
async function killProcessOnPort(port) {
  try {
    // Find process using the port
    const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
    
    if (!stdout || stdout.trim().length === 0) {
      // No process using the port
      return;
    }
    
    // Extract PID from netstat output
    // Format: TCP    0.0.0.0:3001           0.0.0.0:0              LISTENING       14312
    const lines = stdout.trim().split('\n');
    const pids = new Set();
    
    for (const line of lines) {
      const match = line.match(/\s+LISTENING\s+(\d+)/);
      if (match && match[1]) {
        pids.add(match[1]);
      }
    }
    
    // Kill all processes using the port
    for (const pid of pids) {
      try {
        await execAsync(`taskkill /PID ${pid} /F`);

      } catch (error) {
        // Process might already be gone, ignore
        if (!error.message.includes('not found')) {
          console.warn(`⚠️  Could not kill process ${pid}:`, error.message);
        }
      }
    }
    
    // Wait a moment for port to be released
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    // If netstat fails (e.g., no process found), that's fine
    if (!error.message.includes('findstr')) {
      console.warn(`⚠️  Could not check port ${port}:`, error.message);
    }
  }
}

// Start server
(async () => {
  // Kill any existing process on the port before starting

  await killProcessOnPort(PORT);
  
  app.listen(PORT, async () => {






  console.log(`   2. Set DATABASE_URL in .env file (PostgreSQL)`);


  try {
    // Initialize Google Sheets
    await initializeStorage();

  } catch (error) {
    console.error(`⚠️  Google Sheets initialization failed:`, error.message);

    console.log(`   Continuing without storage (messages stored in memory only)`);
  }
  
  // Start polling only in development mode
  // In production, use webhook instead
  if (process.env.NODE_ENV === 'production') {
    console.log(`\n🌐 Production mode: Using webhook (polling disabled)`);

  } else {

    console.log(`   (This will automatically remove any existing webhook)`);
    startPolling();
  }
  
  // Start waiting list checker (check every hour)
  // DEPRECATED: WaitingList is no longer used - reminders are handled by runDailyRemindersJob
  // startWaitingListChecker(); // Disabled - use runDailyRemindersJob instead
  
  // Initialize Reminders sheet
  try {
    await ensureRemindersSheet();

  } catch (error) {
    console.error('⚠️ Reminders sheet initialization failed:', error.message);
  }
  
  // Ensure Orders sheet has payment headers
  try {
    await ensureOrdersPaymentHeaders();
    console.log('✅ Orders payment headers initialized successfully');
  } catch (error) {
    console.error('⚠️ Orders payment headers initialization failed:', error.message);
    console.error('⚠️ Orders payment headers initialization stack:', error.stack);
  }
  
  // Start reminder scheduler (check every 6 hours)
  startReminderScheduler();
  });
})();

/**
 * Get next 7 AM Jakarta time
 * @returns {Date} Next 7 AM in Jakarta timezone (as UTC Date object)
 */
function getNext7AMJakarta() {
  const now = new Date();
  
  // Get current time components in Jakarta timezone
  const jakartaFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const parts = jakartaFormatter.formatToParts(now);
  const jakartaHour = parseInt(parts.find(p => p.type === 'hour').value);
  const jakartaMinute = parseInt(parts.find(p => p.type === 'minute').value);
  const jakartaYear = parseInt(parts.find(p => p.type === 'year').value);
  const jakartaMonth = parseInt(parts.find(p => p.type === 'month').value) - 1; // 0-indexed
  const jakartaDay = parseInt(parts.find(p => p.type === 'day').value);
  
  // Determine target date: today or tomorrow
  let targetYear = jakartaYear;
  let targetMonth = jakartaMonth;
  let targetDay = jakartaDay;
  
  // If it's already past 7 AM today, schedule for tomorrow
  if (jakartaHour >= 7) {
    const nextDay = new Date(jakartaYear, jakartaMonth, jakartaDay);
    nextDay.setDate(nextDay.getDate() + 1);
    targetYear = nextDay.getFullYear();
    targetMonth = nextDay.getMonth();
    targetDay = nextDay.getDate();
  }
  
  // Jakarta is UTC+7, so 7 AM Jakarta = 00:00 UTC on the same date
  // Create UTC date for midnight (00:00) on target day
  const targetUTC = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0));
  
  return targetUTC;
}

/**
 * Start reminder scheduler (checks for H-4/H-3/H-1 reminders)
 * Schedules reminders to run at 7 AM Jakarta time every day
 */
function startReminderScheduler() {

  // Function to schedule next run
  const scheduleNextRun = () => {
    // Calculate time until next 7 AM Jakarta
    const next7AM = getNext7AMJakarta();
    const now = new Date();
    const msUntil7AM = next7AM.getTime() - now.getTime();
    
    // Format next run time for logging
    const nextRunStr = next7AM.toLocaleString('en-US', { 
      timeZone: 'Asia/Jakarta',
      dateStyle: 'full',
      timeStyle: 'long'
    });
    
    console.log(`⏰ [REMINDER_SCHEDULER] Next reminder run scheduled for: ${nextRunStr} (Jakarta time)`);
    console.log(`⏰ [REMINDER_SCHEDULER] Time until next run: ${Math.floor(msUntil7AM / 1000 / 60)} minutes`);
    
    // Schedule run at 7 AM
    setTimeout(() => {

      runDailyRemindersJob(sendTelegramMessage);
      
      // Schedule next run (recursive)
      scheduleNextRun();
    }, msUntil7AM);
  };
  
  // Start scheduling
  scheduleNextRun();
  
  console.log('✅ [REMINDER_SCHEDULER] Reminder scheduler started (runs daily at 7 AM Jakarta time)');
}

/**
 * DEPRECATED: Check waiting list for orders due today and send reminders
 * 
 * This function is DEPRECATED because WaitingList sheet is no longer used.
 * Reminders are now handled by runDailyRemindersJob() which:
 * - Reads Orders and Reminders once per day (quota-friendly)
 * - Writes reminders one by one to Reminders sheet according to H-4, H-3, H-1 rules
 * - Uses Reminders sheet as a send log (append-only)
 * 
 * @deprecated Use runDailyRemindersJob() instead
 */
async function checkAndSendReminders() {
  console.warn('⚠️ [DEPRECATED] checkAndSendReminders() is deprecated. Use runDailyRemindersJob() instead.');
  // This function is disabled - reminders are handled by runDailyRemindersJob
  return;
}

/**
 * DEPRECATED: Start waiting list checker
 * 
 * @deprecated WaitingList is no longer used - reminders are handled by runDailyRemindersJob
 */
function startWaitingListChecker() {
  console.warn('⚠️ [DEPRECATED] startWaitingListChecker() is deprecated. Reminders are handled by runDailyRemindersJob().');
  // This function is disabled - reminders are handled by runDailyRemindersJob
  return;
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
