# 📋 Order Confirmation Flow

## Overview

After a customer sends an order, the bot now asks for confirmation before sending the invoice. This ensures order accuracy and reduces errors.

## Flow Diagram

```
1. Customer sends order message
   ↓
2. Bot parses order information
   ↓
3. Bot saves order with status "pending_confirmation"
   ↓
4. Bot sends confirmation message with Yes/No buttons
   ↓
5. Customer clicks button:
   ├─ ✅ Yes → Order confirmed → Invoice sent
   └─ ❌ No → Order cancelled → Customer can resend
```

## Step-by-Step Process

### Step 1: Customer Sends Order
Customer sends order in the structured format:
```
Nama: Iris
No hp: 081288288987
Alamat: ...
Detail pesanan:
- 20 x Dawet Medium + Nangka
...
```

### Step 2: Bot Parses & Validates
- Bot parses order information
- Validates required fields (name, phone, address, items)
- Generates order ID (DKM/YYYYMMDD/000001)

### Step 3: Order Saved (Pending Confirmation)
- Order saved to Google Sheets with status: `pending_confirmation`
- Order ID generated automatically

### Step 4: Confirmation Message Sent
Bot sends a confirmation message with:
- Order summary (customer info, items, notes)
- **Yes/No buttons**
- **Note:** Total price is NOT shown in confirmation - it appears in the invoice after confirmation

**Example Confirmation Message:**
```
📋 KONFIRMASI PESANAN

👤 Customer: Iris
📞 Phone: 081288288987
📍 Address: Taman kebon jeruk...

📦 Items:
• 20x Dawet Medium + Nangka
• 5x Dawet Medium Original

Apakah pesanan ini sudah benar?

[✅ Ya, Benar]  [❌ Tidak, Perbaiki]
```

### Step 5A: Customer Clicks "✅ Ya, Benar"
- Order status updated to `confirmed`
- Confirmation message updated to show "Pesanan Dikonfirmasi!"
- **Invoice sent** with:
  - Order ID
  - Detailed breakdown
  - **Total payment** (first time customer sees the total)
  - Payment methods

### Step 5B: Customer Clicks "❌ Tidak, Perbaiki"
- Order status updated to `cancelled`
- Confirmation message updated to show "Pesanan Dibatalkan"
- Customer can send a new order

## Order Statuses

| Status | Description |
|--------|-------------|
| `pending_confirmation` | Order parsed, waiting for customer confirmation |
| `confirmed` | Customer confirmed, invoice sent |
| `cancelled` | Customer cancelled, order not processed |

## Technical Details

### Inline Keyboard Buttons
Telegram inline keyboard with callback data:
- `confirm_order_{orderId}` - Confirms order
- `cancel_order_{orderId}` - Cancels order

### Callback Query Handling
- Bot listens for callback queries (button clicks)
- Answers callback query to remove loading state
- Updates order status in Google Sheets
- Edits confirmation message
- Sends invoice (if confirmed)

### Functions Used
- `handleCallbackQuery()` - Handles button clicks
- `handleOrderConfirmation()` - Processes Yes button
- `handleOrderCancellation()` - Processes No button
- `updateOrderStatus()` - Updates status in Google Sheets
- `editMessageText()` - Updates confirmation message

## Testing

### Test Case 1: Confirm Order
1. Send order message
2. Bot sends confirmation with buttons
3. Click "✅ Ya, Benar"
4. Verify: Order status = "confirmed"
5. Verify: Invoice received

### Test Case 2: Cancel Order
1. Send order message
2. Bot sends confirmation with buttons
3. Click "❌ Tidak, Perbaiki"
4. Verify: Order status = "cancelled"
5. Verify: Confirmation message updated
6. Send new order

### Test Case 3: Multiple Orders
1. Send first order → Confirm
2. Send second order → Confirm
3. Verify: Both orders have different IDs
4. Verify: Both invoices sent correctly

## Error Handling

- If order not found: Error message sent to customer
- If Google Sheets error: Error logged, customer notified
- If Telegram API error: Error logged, retry logic

## Future Enhancements

- Allow editing order before confirmation
- Show order history
- Resend confirmation if customer doesn't respond
- Timeout for pending confirmations (auto-cancel after X minutes)
