/**
 * Telegram Router
 * Main entry point for all Telegram messages
 * Routes messages to appropriate handlers based on type
 */

import { sendTelegramMessage } from '../services/telegramService.js';
import { processedCommands } from '../state/store.js';
import { getOrCreateConversation, saveMessage } from '../repos/conversations.repo.js';
import { getAllOrders } from '../repos/orders.repo.js';
import { handleTelegramCommand } from './commandHandler.js';
import { handleTelegramMessage } from './messageHandler.js';
import { handlePaymentConfirmation } from './paymentConfirmationHandler.js';
import { handlePayWithEvidence } from '../../admin-bot-commands.js';

/**
 * Main router for Telegram messages
 * @param {Object} message - Telegram message object
 */
export async function routeTelegramMessage(message) {
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

    // Check for payment confirmation FIRST (Ya/Y/Tidak/T or YES/NO)
    // This must be checked before order confirmation to prevent mixing states
    const messageTextUpper = (messageText || '').toUpperCase().trim();
    const messageTextLower = (messageText || '').toLowerCase().trim();
    
    // Check if this is a payment confirmation response
    const isPaymentConfirm = messageTextUpper === 'YA' || messageTextUpper === 'Y' || messageTextUpper === 'YES';
    const isPaymentCancel = messageTextUpper === 'TIDAK' || messageTextUpper === 'T' || messageTextUpper === 'NO';
    
    if (isPaymentConfirm || isPaymentCancel) {
      const handled = await handlePaymentConfirmation(chatId, userId, messageTextUpper, sendTelegramMessage);
      if (handled) {
        return; // Payment confirmation handled - do NOT check order confirmation
      }
    }

    // Check for order confirmation/cancellation responses (Y/Ya/T/Tidak)
    // Only check if payment confirmation was NOT handled
    const isOrderConfirmation = messageTextLower === 'y' || messageTextLower === 'ya';
    const isOrderCancellation = messageTextLower === 't' || messageTextLower === 'tidak';
    
    if (isOrderConfirmation || isOrderCancellation) {
      // Find most recent pending order for this conversation
      const allOrders = await getAllOrders(1000);
      const pendingOrders = allOrders.filter(order => 
        order.conversation_id === conversation.id && 
        order.status === 'pending_confirmation'
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
        // Import handlers dynamically to avoid circular dependencies
        const { handleOrderConfirmation, handleOrderCancellation } = await import('./orderConfirmationHandler.js');
        
        if (isOrderConfirmation) {
          // Process confirmation (same as button click)
          await handleOrderConfirmation(chatId, pendingOrder.id, null);
          return; // Exit early
        } else {
          // Process cancellation
          await handleOrderCancellation(chatId, pendingOrder.id, null);
          return; // Exit early
        }
      }
    }

    // Handle non-command messages (order parsing, fallback, etc.)
    await handleTelegramMessage(message, conversation);
  } catch (error) {
    console.error('❌ [ROUTER] Error processing Telegram message:', error);
    console.error('❌ [ROUTER] Stack:', error.stack);
    
    // Send error message to user
    try {
      await sendTelegramMessage(chatId, '❌ Terjadi kesalahan saat memproses pesan. Silakan coba lagi.');
    } catch (sendError) {
      console.error('❌ [ROUTER] Failed to send error message:', sendError);
    }
  }
}
