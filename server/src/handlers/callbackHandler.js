/**
 * Callback Handler
 * Handles Telegram callback queries (button clicks)
 */

import { processedCallbacks } from '../state/store.js';
import { handleOrderConfirmation, handleOrderCancellation } from './orderConfirmationHandler.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Answer callback query (required by Telegram)
 * @param {string} callbackQueryId - Callback query ID
 * @param {string|null} text - Optional text to show to user
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
 * Handle callback query (button click)
 * @param {Object} callbackQuery - Telegram callback query object
 */
export async function handleCallbackQuery(callbackQuery) {
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
        console.warn(`⚠️ [CALLBACK] Could not remove keyboard (non-critical):`, error.message);
      }
      
      await handleOrderConfirmation(chatId, orderId, messageId);
      return; // CRITICAL: Return early to prevent any other processing
    } else if (data.startsWith('cancel_order_')) {
      const orderId = data.replace('cancel_order_', '');

      // Remove inline keyboard
      try {
        await editMessageReplyMarkup(chatId, messageId, null);
      } catch (error) {
        console.warn(`⚠️ [CALLBACK] Could not remove keyboard (non-critical):`, error.message);
      }
      
      await handleOrderCancellation(chatId, orderId, messageId);
      return; // CRITICAL: Return early
    }
  } catch (error) {
    console.error('❌ [CALLBACK] Error handling callback query:', error);
    console.error(`❌ [CALLBACK] Stack:`, error.stack);
    // Don't send error message to user to avoid "null" issues
  }
}
