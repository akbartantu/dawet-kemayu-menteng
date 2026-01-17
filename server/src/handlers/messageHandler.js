/**
 * Message Handler
 * Handles non-command Telegram messages (order parsing, menu, FAQ, fallback)
 */

import { sendTelegramMessage } from '../services/telegramService.js';
import { getOrderState, clearOrderState } from '../state/store.js';
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
import {
  formatMenuMessage,
  isMenuRequest,
  isFAQQuestion,
  getFAQAnswer,
} from '../utils/bot-menu.js';
import {
  getFallbackMessage,
  getIncompleteOrderMessage,
  canSendFallback,
  markFallbackSent,
  detectLanguage,
} from '../utils/message-fallback.js';

/**
 * Handle customer order completion keywords
 */
async function handleCustomerOrderCompletion(chatId, customerTelegramId, messageText) {
  // This is a placeholder - implement if needed
  // Currently just acknowledges the message
  await sendTelegramMessage(chatId, '✅ Terima kasih! Pesanan Anda sudah diterima.');
}

/**
 * Handle non-command Telegram messages
 * @param {Object} message - Telegram message object
 * @param {Object} conversation - Conversation object from database
 */
export async function handleTelegramMessage(message, conversation) {
  const chatType = message.chat?.type || 'unknown';
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const messageText = message.text || '';

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
          
          console.log(`[ORDER_FLOW] parsed order ok (order_id: ${orderId})`);

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
            try {
              await saveOrder(orderData);
            } catch (error) {
              console.error('❌ [ORDER_CREATE] Error saving to Orders:', error.message);
              throw error;
            }

            // Get price list and calculate order summary
            const priceList = await getPriceList();
            const orderSummary = formatOrderSummary(orderData);
            const calculation = calculateOrderTotal(orderData.items, priceList);

            // Use formatOrderConfirmation for consistent formatting
            const confirmationText = await formatOrderConfirmation(orderData, calculation, orderSummary);

            // Send confirmation message
            await sendTelegramMessage(message.chat.id, confirmationText);
            orderProcessed = true;
            console.log(`✅ [ORDER_HANDLER] Order confirmation sent (future date), orderProcessed=true, returning early`);
            return; // CRITICAL: Return immediately to prevent fall-through
          } else {
            // Save order to Google Sheets with status "pending_confirmation" (current date or past)
            orderData.status = 'pending_confirmation';
            let orderSaved = false;
            let savedRowIndex = null;
            try {
              await saveOrder(orderData);
              orderSaved = true;
              console.log(`✅ [ORDER_CREATE] Order saved successfully: ${orderData.id}`);
              console.log(`[ORDER_FLOW] saved order ok (order_id: ${orderData.id})`);
              
              // Get the row index after save (for logging)
              const { findRowByOrderId } = await import('../repos/orders.repo.js');
              const { SHEET_NAMES } = await import('../utils/constants.js');
              savedRowIndex = await findRowByOrderId(SHEET_NAMES.ORDERS, orderData.id);
              if (savedRowIndex) {
                console.log(`[ORDER_FLOW] saved order ok (order_id: ${orderData.id}, row: ${savedRowIndex})`);
              }
            } catch (error) {
              console.error('❌ [ORDER_CREATE] Error saving order:', error.message);
              console.error('❌ [ORDER_CREATE] Error stack:', error.stack);
              // Still try to send confirmation message even if save failed (user should know)
              orderSaved = false;
            }
            
            // NOTE: Reminders are handled by the daily job (runDailyRemindersJob)
            if (orderData.event_date) {
              console.log(`ℹ️ [ORDER_CREATE] Reminder will be processed by daily job (event_date: ${orderData.event_date})`);
            }

            // Get price list and calculate order summary (even if save failed, show confirmation)
            let priceList = {};
            let orderSummary = '';
            let calculation = { subtotal: 0, itemDetails: [] };
            
            try {
              priceList = await getPriceList();
              orderSummary = formatOrderSummary(orderData);
              calculation = calculateOrderTotal(orderData.items, priceList);
              console.log(`[ORDER_FLOW] totals computed ok (subtotal: ${calculation.subtotal}, total: ${calculation.subtotal + (calculation.itemDetails.find(d => d.name.toLowerCase().includes('packaging'))?.itemTotal || 0)})`);
            } catch (error) {
              console.error('❌ [ORDER_CREATE] Error getting price list:', error.message);
              console.error('❌ [ORDER_CREATE] Error stack:', error.stack);
              // Continue with empty price list
            }

            // Use formatOrderConfirmation for consistent formatting
            let confirmationText = formatOrderConfirmation(orderData, calculation, orderSummary);
            
            // Add warning if order save failed
            if (!orderSaved) {
              confirmationText += `\n\n⚠️ **Peringatan:** Pesanan mungkin tidak tersimpan. Silakan hubungi admin.`;
            }

            // Send confirmation message (ALWAYS send, even if save failed)
            // Use reply_to_message_id for group chats
            console.log(`[ORDER_FLOW] sending confirmation... (chatId: ${message.chat.id})`);
            try {
              const replyToId = message.chat.type !== 'private' ? message.message_id : null;
              const result = await sendTelegramMessage(message.chat.id, confirmationText, null, replyToId);
              console.log(`✅ [ORDER_CREATE] Confirmation message sent successfully for order: ${orderData.id}`);
              console.log(`[ORDER_FLOW] confirmation sent ok (order_id: ${orderData.id}, chatId: ${message.chat.id})`);
              orderProcessed = true;
            } catch (error) {
              console.error('❌ [ORDER_CREATE] Error sending confirmation message:', error.message);
              console.error('❌ [ORDER_CREATE] Error stack:', error.stack);
              console.error(`[ORDER_FLOW] confirmation send failed (order_id: ${orderData.id}, chatId: ${message.chat.id})`);
              console.error(`[ORDER_FLOW] confirmation send failed stack:`, error.stack);
              // Try one more time with simpler message
              try {
                await sendTelegramMessage(message.chat.id, `✅ Pesanan diterima dengan ID: ${orderData.id}\n\nSilakan konfirmasi dengan mengetik "Ya" atau "Y".`);
                console.log(`[ORDER_FLOW] confirmation sent ok (fallback message, order_id: ${orderData.id})`);
                orderProcessed = true;
              } catch (retryError) {
                console.error('❌ [ORDER_CREATE] Failed to send confirmation message after retry:', retryError.message);
                console.error('❌ [ORDER_CREATE] Retry error stack:', retryError.stack);
                console.error(`[ORDER_FLOW] confirmation send failed after retry (order_id: ${orderData.id})`);
                console.error(`[ORDER_FLOW] confirmation send failed after retry stack:`, retryError.stack);
                // Mark as processed anyway to prevent infinite loop
                orderProcessed = true;
              }
            }

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
        // Check if this is a parse error (not an order) or a save error
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
          if (!orderProcessed) {
            console.log('⚠️ [ORDER_PARSE] Parse failed - will try other handlers (menu/FAQ/fallback)');
          }
        }
      }
    } else {
      // Group/supergroup: non-command messages are already filtered out above
      // This code path should not be reached, but log for safety
      console.log(`⏸️ [ORDER_PARSE] Skipping auto-parse in ${chatType} (orders must use /pesan command)`);
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
    if (!orderProcessed && isFAQQuestion(message.text)) {
      console.log(`🔍 [FAQ_HANDLER] FAQ question detected: ${message.text.substring(0, 50)}...`);
      const faqAnswer = getFAQAnswer(message.text);
      const replyToId = message.chat.type !== 'private' ? message.message_id : null;
      await sendTelegramMessage(message.chat.id, faqAnswer, null, replyToId);
      return;
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
    } else {
      console.log('⏸️ [FALLBACK] Skipped (cooldown active)');
    }
  }
}
