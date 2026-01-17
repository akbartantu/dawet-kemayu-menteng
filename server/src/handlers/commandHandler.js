/**
 * Command Handler
 * Parses and dispatches Telegram bot commands
 */

import { processedCommands } from '../state/store.js';
import { getOrderState, setOrderState, clearOrderState } from '../state/store.js';
import { sendTelegramMessage } from '../services/telegramService.js';
import { isAdmin } from '../middleware/adminGuard.js';
import { getOrCreateConversation } from '../repos/conversations.repo.js';
import { generateOrderId, saveOrder } from '../repos/orders.repo.js';
import { getPriceList } from '../repos/price-list.repo.js';
import {
  detectOrderFormat,
  parseOrderFromMessageAuto,
  validateOrder,
  formatOrderSummary,
} from '../services/order-parser.js';
import { calculateOrderTotal, separateItemsFromNotes } from '../services/price-calculator.js';
import { formatOrderConfirmation } from '../utils/order-formatter.js';
import { isFutureDate } from '../utils/date-utils.js';
import { formatMenuMessage } from '../utils/bot-menu.js';
import {
  handleNewOrder,
  handleParseOrder,
  handleOrderDetail,
  handleStatus,
  handleEditOrder,
  handlePay,
  handlePaymentStatus,
  handleRecapH1,
  handleOrdersDate,
  handleOrdersUnpaid,
  handleCancel,
  handleComplete,
} from '../commands/index.js';
import { handleAdminAuth } from '../../admin-bot-commands.js';
import { checkAndSendRemindersForToday } from '../services/reminder-system.js';

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
 * @param {Object} message - Telegram message object
 */
export async function handleTelegramCommand(message) {
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
    await sendTelegramMessage(chatId, '❌ Command tidak dikenali. Ketik /help untuk daftar perintah.');
    return;
  }

  switch (normalizedCommand) {
    case '/start':
      await sendTelegramMessage(chatId, 
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
            delivery_fee: parsedOrder.delivery_fee !== null && parsedOrder.delivery_fee !== undefined ? parsedOrder.delivery_fee : null,
            delivery_method: parsedOrder.delivery_method || null,
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
            
            // Create confirmation message using shared formatter
            const confirmationText = await formatOrderConfirmation(orderData, calculation, orderSummary);
            
            const replyToId = chatType !== 'private' ? message.message_id : null;
            await sendTelegramMessage(chatId, confirmationText, null, replyToId);
          } else {
            // Save order to Google Sheets with status "pending_confirmation" (current date or past)
            orderData.status = 'pending_confirmation';
            await saveOrder(orderData);
            
            const priceList = await getPriceList();
            const orderSummary = formatOrderSummary(orderData);
            const calculation = calculateOrderTotal(orderData.items, priceList);
            
            // Create confirmation message using shared formatter
            const confirmationText = await formatOrderConfirmation(orderData, calculation, orderSummary);
            
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
    case '/orders_unpaid': {
      handleOrdersUnpaid(chatId, userId, sendTelegramMessage).catch(error => {
        console.error('❌ [COMMAND] Error in /orders_unpaid handler:', error);
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
