/**
 * Telegram Service
 * Handles all Telegram Bot API communication
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Send a message to a Telegram chat
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} text - Message text
 * @param {Object|null} replyMarkup - Optional inline keyboard or reply markup
 * @param {number|null} replyToMessageId - Optional message ID to reply to
 * @returns {Promise<Object>} Telegram API response
 */
export async function sendTelegramMessage(chatId, text, replyMarkup = null, replyToMessageId = null) {
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
