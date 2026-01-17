/**
 * Order Confirmation Handler
 * Handles order confirmation and cancellation
 */

import { processedConfirmations, sentInvoices, acquireOrderLock, releaseOrderLock } from '../state/store.js';
import { sendTelegramMessage } from '../services/telegramService.js';
import { getOrderById, updateOrderStatus, saveOrder } from '../repos/orders.repo.js';
import { getPriceList } from '../repos/price-list.repo.js';
import { formatInvoice, calculateOrderTotal } from '../services/price-calculator.js';
import { ORDER_NOT_FOUND, INVOICE_ERROR } from '../utils/messages.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

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
 * Finalize order - centralized function to handle order confirmation
 * This ensures idempotency and prevents duplicate writes
 * Uses concurrency lock to prevent race conditions
 * @param {string} orderId - Order ID to finalize
 * @returns {Promise<Object|null>} Finalized order data or null if not found/already confirmed
 */
export async function finalizeOrder(orderId) {
  // Acquire lock to prevent concurrent processing
  if (!acquireOrderLock(orderId)) {
    // Return existing order if available
    try {
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
    if (order.status === 'confirmed') {
      return order; // Return existing order
    }

    // Normalize event_date to YYYY-MM-DD format before finalizing
    const { normalizeEventDate } = await import('../utils/date-utils.js');
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
    const { normalizeDeliveryTime } = await import('../services/price-calculator.js');
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
    order.status = 'confirmed';
    await saveOrder(order, { skipDuplicateCheck: true }); // skipDuplicateCheck because we have lock + upsert handles it
    console.log(`✅ [FINALIZE_ORDER] Order upserted to Orders sheet (update if exists, append if not)`);

    // Create Google Calendar event for confirmed order
    if (order.event_date) {
      try {
        const { createCalendarEvent } = await import('../../google-calendar.js');
        const calendarEventId = await createCalendarEvent(order);
        if (calendarEventId) {
          console.log(`✅ [FINALIZE_ORDER] Calendar event created: ${calendarEventId}`);
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
 * Handle order confirmation (Yes button clicked or Y/Ya response)
 * This is the ONLY entry point for order confirmation
 * All order finalization goes through finalizeOrder() which has locking
 */
export async function handleOrderConfirmation(chatId, orderId, messageId) {
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

    return; // CRITICAL: Return early to prevent any other processing
  } catch (error) {
    console.error('❌ [ORDER_CONFIRM] Error confirming order:', error);
    console.error('❌ [ORDER_CONFIRM] Stack:', error.stack);
    await sendTelegramMessage(chatId, '❌ Terjadi kesalahan saat mengkonfirmasi pesanan. Silakan coba lagi.');
    return; // CRITICAL: Return early even on error
  }
}

/**
 * Handle order cancellation (No button clicked or T/Tidak response)
 */
export async function handleOrderCancellation(chatId, orderId, messageId) {
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
