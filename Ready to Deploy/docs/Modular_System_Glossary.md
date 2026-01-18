# Modular System Glossary & Guidance

**Project**: DAWET - Telegram Bot Order Management System  
**Document Version**: 1.0  
**Last Updated**: 2026-01-03  
**Status**: Troubleshooting Guide

**Purpose:** Answer "If something breaks, WHERE do I go?"

---

## 1. Big Picture Overview (ELI10)

### What the System Does

Think of the system like a restaurant:
1. **Customer** sends order via **Telegram** (like calling the restaurant)
2. **Telegram** delivers message to our **Server** (like the phone ringing)
3. **Server** reads the order, calculates prices, saves to **Google Sheets** (like writing order on a ticket)
4. **Server** sends confirmation back via **Telegram** (like telling customer "Got it!")
5. **Admin** can view orders on **Web Dashboard** (like looking at order tickets on a board)

### Text Diagram

```
User → Telegram → Server (server.js)
                      ↓
              Telegram Router (telegramRouter.js)
                      ↓
         ┌────────────┴────────────┐
         ↓                         ↓
    Command Handler          Message Handler
    (commandHandler.js)      (messageHandler.js)
         ↓                         ↓
    ┌────┴────┐              Order Parser
    ↓         ↓              (order-parser.js)
  Admin    Customer              ↓
Commands   Orders          Price Calculator
                              (price-calculator.js)
                                  ↓
                          Orders Repository
                          (orders.repo.js)
                                  ↓
                          Google Sheets Client
                          (sheets.client.js)
                                  ↓
                            Google Sheets
                                  ↓
                            Response → Telegram → User
```

---

## 2. Folder & File Glossary

### Area: Bot (Telegram Communication)

| Folder / File Path | What It Does | Key Functions | How to Debug if Broken |
|-------------------|--------------|---------------|------------------------|
| `server/src/services/telegramService.js` | Sends messages to Telegram | `sendTelegramMessage()` | Check: Telegram bot token in env, network connection, API rate limits |
| `server/src/handlers/telegramRouter.js` | Routes incoming Telegram messages | `routeTelegramMessage()` | Check: Message format, chat type (private vs group) |
| `server/src/handlers/commandHandler.js` | Handles bot commands (/start, /help, etc.) | `handleTelegramCommand()` | Check: Command parsing, admin auth, command registration |
| `server/src/handlers/callbackHandler.js` | Handles button clicks | `handleCallbackQuery()` | Check: Callback data format, button registration |
| `server/server.js:224` | Webhook endpoint for Telegram | `POST /api/webhooks/telegram` | Check: Webhook URL in Telegram, server is running, port is correct |

**Common Issues:**
- Bot not replying → Check `telegramService.js`, verify bot token
- Commands not working → Check `commandHandler.js`, verify command is registered
- Buttons not working → Check `callbackHandler.js`, verify callback data format

### Area: Orders

| Folder / File Path | What It Does | Key Functions | How to Debug if Broken |
|-------------------|--------------|---------------|------------------------|
| `server/src/services/order-parser.js` | Parses order from customer message | `parseOrderFromMessageAuto()`, `detectOrderFormat()` | Check: Order format matches expected pattern, required fields present |
| `server/src/repos/orders.repo.js` | Saves/reads orders from Google Sheets | `saveOrder()`, `getOrderById()`, `getAllOrders()`, `generateOrderId()` | Check: Google Sheets permissions, column headers exist, order ID format |
| `server/src/services/price-calculator.js` | Calculates order totals | `calculateOrderTotal()`, `formatInvoice()` | Check: PriceList sheet has prices, calculation formula is correct |
| `server/src/handlers/orderConfirmationHandler.js` | Handles order confirmation (Yes/No) | `handleOrderConfirmation()` | Check: Order status transitions, idempotency checks |
| `server/server.js:908` | Finalizes order (confirms it) | `finalizeOrder()` | Check: Order exists, status is valid, Google Sheets write succeeds |

**Common Issues:**
- Orders not saving → Check `orders.repo.js`, verify Google Sheets connection
- Totals mismatch → Check `price-calculator.js`, verify PriceList sheet
- Order ID generation fails → Check `orders.repo.js:generateOrderId()`, verify Orders sheet exists

#### Order Creation Entry Points

**WHAT**
- Defines how users can create orders in the system
- Two entry points: group chat (via command) and private chat (auto-parse)

**WHY**
- Group chats require `/pesan` command due to Telegram privacy mode (bot can only see commands)
- Private chats allow direct message parsing for better user experience (no command needed)

**WHO**
- **Users** - When creating orders via Telegram
- **System** - When routing messages to appropriate handlers

**WHEN**
- **Runtime** - When user wants to create an order
- **Group chat** - User types `/pesan` command (with or without order format)
- **Private chat** - User sends order format message directly (auto-detected)

**WHERE**
- **Group chat entry:** `server/src/handlers/commandHandler.js` → `/pesan` case (line 167)
- **Private chat entry:** `server/src/handlers/messageHandler.js` → `handleTelegramMessage()` (line 47)
- **Order parsing:** `server/src/services/order-parser.js` → `detectOrderFormat()`, `parseOrderFromMessageAuto()`

**HOW**

**Group Chat Flow:**
1. User types `/pesan` in group chat
2. `commandHandler.js` receives command
3. If payload exists (order format in same message):
   - Parse order immediately
   - Generate order ID
   - Save to Google Sheets
   - Send confirmation
4. If no payload:
   - Set state to `AWAITING_FORM`
   - Send order template to user
   - Wait for user to send order format
   - When received, parse and create order

**Private Chat Flow:**
1. User sends order format message directly (no command)
2. `messageHandler.js` receives message
3. Auto-detect order format using `detectOrderFormat()`
4. If format detected:
   - Parse order using `parseOrderFromMessageAuto()`
   - Generate order ID
   - Save to Google Sheets
   - Send confirmation
5. If format not detected:
   - Send error message with format template

**FILES**
- `server/src/handlers/commandHandler.js` - Handles `/pesan` command (group chat)
- `server/src/handlers/messageHandler.js` - Handles private chat messages (auto-parse)
- `server/src/services/order-parser.js` - Detects and parses order format
- `server/src/repos/orders.repo.js` - Saves orders to Google Sheets

**IF SOMETHING BREAKS**
- **Symptoms:** Orders not created, "Format tidak valid" error, bot not responding
- **Group chat issues:**
  - First file: `server/src/handlers/commandHandler.js` (verify `/pesan` case exists)
  - Check: Command registration, payload parsing, state management
- **Private chat issues:**
  - First file: `server/src/handlers/messageHandler.js` (verify auto-parse logic)
  - Second file: `server/src/services/order-parser.js` (verify format detection)
  - Check: `detectOrderFormat()` returns true, `parseOrderFromMessageAuto()` succeeds
- **What to log/inspect:**
  - Check if message is detected as order format
  - Check if parsing succeeds (no errors in `parseOrderFromMessageAuto()`)
  - Check if order ID is generated
  - Check if Google Sheets write succeeds

**REMOVED/DEPRECATED**
- `/new_order` command - **REMOVED** (redundant - `/pesan` already handles order creation)
  - **Replacement:** Use `/pesan` in groups or send order format directly in private chat

#### Order Calculation Logic

**WHAT**
- Calculates subtotal and total pembayaran for order confirmation messages
- Handles both new orders (before saving) and saved orders (from Google Sheets)
- Ensures totals are calculated correctly regardless of when confirmation is shown

**WHY**
- Order confirmation must show accurate prices immediately (even before saving to sheet)
- Saved orders have `product_total` in sheet, but new orders don't yet
- Calculation must work in both scenarios without showing Rp 0

**WHO**
- **System** - Automatically calculates when formatting confirmation messages
- **Developers** - When understanding why subtotal might be 0

**WHEN**
- **Runtime** - When order confirmation message is generated
- **Before saving** - For new orders (calculation.subtotal used)
- **After saving** - For saved orders (order.product_total used)

**WHERE**
- **Calculation function:** `server/src/services/price-calculator.js` → `calculateOrderTotal()`
- **Formatting function:** `server/src/utils/order-message-formatter.js` → `formatPaymentSummary()`
- **Called from:** `server/src/utils/order-formatter.js` → `formatOrderConfirmation()`

**HOW**

**Calculation Flow:**
1. Order items parsed from customer message
2. `calculateOrderTotal(items, priceList)` called:
   - For each item: `unitPrice × quantity = itemTotal`
   - Sum all `itemTotal` values → `subtotal`
   - Returns: `{ subtotal, itemDetails }`
3. `formatPaymentSummary()` called with:
   - `order` object (may not have `product_total` yet for new orders)
   - `calculation` object (always has correct `subtotal`)
   - Packaging fee and delivery fee
4. **Fallback logic:**
   - If `order.product_total > 0` → use it (saved orders)
   - Otherwise → use `calculation.subtotal` (new orders)
5. Total = subtotal + packaging + delivery
6. Format as "Rp XXX.XXX" for display

**Critical Rules:**
- Subtotal MUST equal: `sum(quantity × unit_price)` for all items
- Total Pembayaran MUST equal: `subtotal + packaging_fee + delivery_fee`
- Calculation MUST happen BEFORE formatting
- Formatting MUST happen LAST (after all calculations)

**Common Failure Mode (Regression Bug):**
- **Symptom:** Subtotal and Total Pembayaran show as "Rp 0" even though item prices display correctly
- **Root Cause:** `formatPaymentSummary()` used only `order.product_total`, which is `undefined/0` for new orders before saving
- **Fix:** Use `calculation.subtotal` as fallback when `order.product_total` is not available
- **Protection:** Defensive check logs error if items exist but subtotal is 0

**FILES**
- `server/src/services/price-calculator.js` - Core calculation logic (`calculateOrderTotal()`)
- `server/src/utils/order-message-formatter.js` - Payment summary formatting (`formatPaymentSummary()`)
- `server/src/utils/order-formatter.js` - Order confirmation wrapper (`formatOrderConfirmation()`)

**IF SOMETHING BREAKS**
- **Symptoms:** Subtotal shows Rp 0, Total Pembayaran shows Rp 0, item prices correct but totals wrong
- **First file to check:** `server/src/utils/order-message-formatter.js` → `formatPaymentSummary()` (line 107)
- **Second file if not resolved:** `server/src/services/price-calculator.js` → `calculateOrderTotal()` (line 236)
- **What to log/inspect:**
  - Check if `calculation.subtotal` has correct value
  - Check if `order.product_total` exists (may be 0 for new orders)
  - Check if `calculation.itemDetails` has items with prices
  - Check server logs for regression warning: `[PAYMENT_SUMMARY] Regression detected`
  - Verify price list has prices for all items

**Troubleshooting:**
- **Subtotal = 0 but items have prices:** Check if `calculation` object is passed correctly to `formatPaymentSummary()`
- **Total = 0:** Check if packaging fee and delivery fee are calculated correctly
- **Prices wrong:** Check PriceList sheet has correct prices for item names

#### Payment Calculation Module

**WHAT**
- Shared payment calculation module for consistent totals across all message types
- Calculates subtotal, delivery fee, packaging fee, and total amount
- Returns numeric values (formatting happens in formatters)

**WHY**
- Ensures consistent calculations between confirmation and detail messages
- Single source of truth prevents calculation discrepancies
- Handles both new orders (before saving) and saved orders (from Google Sheets)

**WHO**
- **System** - Used by both confirmation and detail message formatters
- **Developers** - When understanding payment calculation logic

**WHEN**
- **Runtime** - Called whenever payment totals need to be calculated
- **Before saving** - For new orders (uses calculation.subtotal)
- **After saving** - For saved orders (uses order.product_total)

**WHERE**
- **Calculator:** `server/src/services/payment.calculator.js` → `calculatePaymentTotals()`
- **Used by:** `server/src/utils/order-message-formatter.js` → `formatPaymentSummary()`

**HOW**

**Calculation Rules:**
1. Subtotal = product_total (from order) OR calculation.subtotal (for new orders)
2. Delivery fee = provided value OR order.delivery_fee OR 0
3. Packaging fee = provided value OR order.packaging_fee OR calculated from notes
4. Total amount = subtotal + delivery_fee + packaging_fee

**Payment Breakdown Display:**
- **KONFIRMASI PESANAN:** Shows full breakdown (Subtotal, Ongkir, Biaya Kemasan, Total)
- **DETAIL PESANAN:** Shows full breakdown with adjustment line if needed
- **REKAP PESANAN & PEMBAYARAN:** Shows full breakdown (identical format to KONFIRMASI)
- All three message types use the same shared calculator and formatter
- All three breakdown lines always shown (even if 0) for clarity
- Total must match: subtotal + ongkir + biaya_kemasan
- Single source of truth: `payment.calculator.js` → `calculatePaymentTotals()`
- Shared formatter: `order-message-formatter.js` → `formatPaymentSummary()`

**FILES**
- `server/src/services/payment.calculator.js` - Payment calculation logic
- `server/src/utils/order-message-formatter.js` - Message formatting (uses calculator)

**IF SOMETHING BREAKS**
- **Symptoms:** Wrong totals, NaN values, calculation errors
- **First file to check:** `server/src/services/payment.calculator.js` → `calculatePaymentTotals()`
- **What to log/inspect:**
  - Check if order.product_total exists (saved orders) or calculation.subtotal (new orders)
  - Verify packaging fee calculation (from notes or order.packaging_fee)
  - Check for NaN values (should throw error with clear message)

#### Order ID Generation Logic

**WHAT**
- Generates unique order IDs in format: `DKM/YYYYMMDD/XXXX`
- Where `YYYYMMDD` = today's date, `XXXX` = continuous sequence number

**WHY**
- Provides unique identifiers for each order
- Format includes date for easy identification
- Sequence number ensures uniqueness and shows order count

**WHO**
- **System** - Automatically generates ID when creating new orders
- **Developers** - When understanding order numbering

**WHEN**
- **Runtime** - Every time a new order is created (via `saveOrder()` or directly via `generateOrderId()`)

**WHERE**
- Triggered from: `server/src/repos/orders.repo.js:generateOrderId()`
- Called by: `saveOrder()` function (if order doesn't have ID yet)

**HOW**
1. Function gets today's date (YYYYMMDD format)
2. Function reads ALL orders from Orders sheet (column A)
3. Function filters to orders from CURRENT YEAR (not just today)
4. Function extracts sequence numbers (XXXX) from all year's orders
5. Function finds maximum sequence number
6. Function increments by 1
7. Function uses today's date but continuous sequence number
8. Function returns: `DKM/YYYYMMDD/XXXX` (date = today, sequence = continuous)

**Sequence Rules (FIXED - Updated 2026-01-03):**
- ✅ **Sequence is YEARLY-BASED and CONTINUOUS**
- ✅ Sequence increments across all dates within the same year
- ✅ Sequence resets to 000001 on January 1st of each new year
- ❌ **OLD (WRONG):** Sequence reset daily (e.g., DKM/20260117/000002, DKM/20260118/000001)
- ✅ **NEW (CORRECT):** Sequence continuous (e.g., DKM/20260117/000005, DKM/20260118/000006)

**Examples:**
- First order Jan 17: `DKM/20260117/000001`
- Second order Jan 17: `DKM/20260117/000002`
- Third order Jan 18: `DKM/20260118/000003` (date changed, sequence continues)
- Fourth order Jan 19: `DKM/20260119/000004` (date changed, sequence continues)
- First order Jan 1, 2027: `DKM/20270101/000001` (new year, sequence resets)

**IF SOMETHING BREAKS**
- **Symptoms:** Order IDs resetting daily, duplicate order IDs, sequence numbers jumping
- **First file to check:** `server/src/repos/orders.repo.js:generateOrderId()` - Verify sequence logic
- **Second file if not resolved:** Check Orders sheet for malformed order IDs (may affect sequence extraction)
- **What to log/inspect:**
  - Check if function is reading ALL orders from current year (not just today)
  - Verify sequence number extraction (should find max from all year's orders)
  - Check cache logic (should be year-based, not date-based)
  - Verify Orders sheet has valid order IDs in format `DKM/YYYYMMDD/XXXX`
  - Check for malformed order IDs (may cause sequence calculation errors)

### Message Types

**WHAT**
- Two distinct message types for orders: KONFIRMASI PESANAN (user confirmation) and DETAIL PESANAN (admin view)
- Each has different format and purpose

**WHY**
- User confirmation needs simple format (just total) for clarity
- Admin detail needs full breakdown for transparency and debugging
- Separation ensures consistency and prevents confusion

**WHO**
- **Users** - See KONFIRMASI PESANAN when creating orders
- **Admins** - See DETAIL PESANAN when viewing order details

**WHEN**
- **KONFIRMASI PESANAN** - Shown immediately after order creation, before user confirms
- **DETAIL PESANAN** - Shown when admin uses `/order_detail` command

**WHERE**
- **KONFIRMASI PESANAN:** `server/src/utils/order-message-formatter.js` → `buildOrderDetailMessage()` with `mode='confirmation'`
- **DETAIL PESANAN:** `server/src/commands/orders.commands.js` → `handleOrderDetail()`

**HOW**

**KONFIRMASI PESANAN Format:**
```
📋 KONFIRMASI PESANAN

👤 Customer: <name>
📞 HP: <phone>
📍 Alamat: <address>

📅 Tanggal Pengiriman: <YYYY-MM-DD>
🕐 Jam Pengiriman: <HH:mm>
🚚 Metode Pengiriman: <method>

📦 Daftar Pesanan & Rincian Harga:
• <qty>x <item_name>: Rp <line_total>
• ...

💰 Rincian Pembayaran:
Subtotal: Rp <subtotal>
Ongkir: Rp <delivery_fee>
Biaya Kemasan: Rp <packaging_fee>
--------------------
Total Pembayaran: Rp <total_amount>

📝 Catatan:
• <notes line 1>
• <notes line 2>
(Only shown if notes exist)

Apakah pesanan ini sudah benar?
Balas: "Ya"/"Y" untuk konfirmasi atau "Tidak"/"T" untuk membatalkan.
```

**DETAIL PESANAN Format:**
```
📋 DETAIL PESANAN

Order ID: <id>
Status: <status>
Payment Status: <status>
Paid: Rp <amount>
Remaining: Rp <amount>

👤 Customer Info:
...

📦 Daftar Pesanan & Rincian Harga:
• <qty>x <item_name>: Rp <line_total>
• ...

💰 Rincian Pembayaran:
Subtotal: Rp <subtotal>
Ongkir: Rp <delivery_fee>
Biaya Kemasan: Rp <packaging_fee>
--------------------
Total Pembayaran: Rp <total_amount>

📝 Catatan:
• <notes>
```

**Key Differences:**
- **KONFIRMASI:** Shows full payment breakdown (Subtotal, Ongkir, Biaya Kemasan, Total)
- **DETAIL:** Shows full breakdown with adjustment line if needed
- **REKAP:** Shows full payment breakdown (identical to KONFIRMASI format)
- **KONFIRMASI:** Includes confirmation prompt
- **DETAIL:** Includes payment status and admin info
- **REKAP:** Includes invoice number, bank details, and payment instructions
- **Notes:** KONFIRMASI omits empty notes, DETAIL shows "-" for empty
- **Breakdown:** All three message types always show all three lines (even if 0) for clarity

**REKAP PESANAN & PEMBAYARAN Format:**
- Invoice-style message sent to customers after order confirmation
- Uses same payment breakdown format as KONFIRMASI PESANAN
- Includes invoice number, customer info, event details, items list
- Shows payment breakdown: Subtotal, Ongkir, Biaya Kemasan, Total Pembayaran
- Includes bank transfer details and payment instructions
- Two variants: Full Payment (H-4 or closer) and DP (farther than H-4)

**Separator Rules:**
- **Thin separator (`--------------------`):** Used inside payment breakdown, before "Total Pembayaran" line
- **Full separator (`--------------------------------`):** Used as section divider, placed AFTER "Total Pembayaran" and BEFORE "🏦 PEMBAYARAN TRANSFER BANK" section
- **Rule:** Full separator must NOT be placed above "💰 Rincian Pembayaran:" header
- **Rule:** Full separator must be placed immediately after "Total Pembayaran" line, before bank payment section

**FILES**
- `server/src/utils/order-message-formatter.js` - Shared formatters for all message types
- `server/src/services/payment.calculator.js` - Shared payment calculation logic (used by all three)
- `server/src/services/price-calculator.js` - Invoice/recap message builder (uses shared formatter)
- `server/src/commands/orders.commands.js` - Admin detail message builder

**IF SOMETHING BREAKS**
- **Symptoms:** Wrong totals, missing breakdown, notes shown when empty
- **First file to check:** `server/src/utils/order-message-formatter.js` → `formatPaymentSummary()` (verify mode parameter)
- **Second file if not resolved:** `server/src/services/payment.calculator.js` → `calculatePaymentTotals()` (verify calculation logic)
- **What to log/inspect:**
  - Check if `mode` parameter is passed correctly ('confirmation' vs 'detail')
  - Verify `calculatePaymentTotals()` returns correct numeric values
  - Check if notes array is empty (should not show notes block)

### Area: Payments

| Folder / File Path | What It Does | Key Functions | How to Debug if Broken |
|-------------------|--------------|---------------|------------------------|
| `server/src/services/payment-tracker.js` | Tracks payment status | `calculatePaymentStatus()`, `updateOrderPayment()` | Check: Payment amount calculations, status transitions |
| `server/src/repos/payment-history.repo.js` | Saves payment records | `savePaymentHistory()` | Check: Payment_History sheet exists, headers are correct |
| `server/admin-bot-commands.js:42` | Extracts amount from receipt image (OCR) | `extractAmountFromImage()`, `extractAmountFromImageNew()` | Check: OCR service is working, image quality, Tesseract.js installed |
| `server/src/handlers/paymentConfirmationHandler.js` | Handles payment confirmation (YES/NO) | `handlePaymentConfirmation()` | Check: Payment amount validation, confirmation flow |

**Common Issues:**
- Payment not recorded → Check `payment-history.repo.js`, verify Payment_History sheet
- OCR not working → Check OCR service, verify image format, check Tesseract.js setup
- Payment status wrong → Check `payment-tracker.js`, verify calculation logic

### Area: Sheets (Google Sheets)

| Folder / File Path | What It Does | Key Functions | How to Debug if Broken |
|-------------------|--------------|---------------|------------------------|
| `server/src/repos/sheets.client.js` | Connects to Google Sheets API | `getSheetsClient()`, `retryWithBackoff()` | Check: Service account credentials, spreadsheet ID, API permissions |
| `server/src/utils/sheets-helpers.js` | Helper functions for Sheets operations | `getSheetHeaderMap()`, `buildRowFromMap()`, `normalizeOrderId()` | Check: Header mapping is correct, column names match |
| `server/src/repos/orders.repo.js` | Orders sheet operations | `ensureOrdersPaymentHeaders()`, `saveOrder()`, `getOrderById()` | Check: Orders sheet exists, headers are correct, data format |
| `server/src/repos/conversations.repo.js` | Messages/Conversations sheets | `saveMessage()`, `getOrCreateConversation()` | Check: Sheets exist, headers are correct |
| `server/src/repos/price-list.repo.js` | PriceList sheet operations | `getPriceList()`, `initializePriceList()` | Check: Sheet exists, product names match, prices are numbers |

**Common Issues:**
- "Permission denied" → Check service account has access to spreadsheet
- "Sheet not found" → Check sheet name matches `SHEET_NAMES` constant
- "Column not found" → Check headers exist, use `ensure*Headers()` functions
- API rate limits (429 error) → Check `retryWithBackoff()` is working, reduce request frequency

### Area: Validation

| Folder / File Path | What It Does | Key Functions | How to Debug if Broken |
|-------------------|--------------|---------------|------------------------|
| `server/src/services/order-parser.js` | Validates order format | `validateOrder()` | Check: Required fields are defined, validation rules are correct |
| `server/src/services/payment-tracker.js` | Validates payment status transitions | `validatePaymentStatusTransition()` | Check: Status flow rules, backward transitions are blocked |
| `server/src/services/order-status-notifications.js` | Validates order status transitions | `validateStatusTransition()` | Check: Status flow rules, merchant vs customer actions |
| `server/src/config/env.js` | Validates environment variables | `validateEnv()` | Check: Required env vars are set, format is correct |

**Common Issues:**
- Orders rejected incorrectly → Check validation rules in `order-parser.js`
- Invalid status transitions → Check `validateStatusTransition()` rules
- Missing env vars → Check `env.js`, verify `.env` file exists

### Area: Utils (Helper Functions)

| Folder / File Path | What It Does | Key Functions | How to Debug if Broken |
|-------------------|--------------|---------------|------------------------|
| `server/src/utils/formatting.js` | Formats text/numbers for display | `formatPrice()`, `formatRupiah()`, `escapeMarkdown()` | Check: Number formatting, markdown escaping |
| `server/src/utils/date-utils.js` | Date/time utilities | `isFutureDate()`, `normalizeEventDate()`, `daysUntilDelivery()` | Check: Date parsing, timezone handling (Jakarta time) |
| `server/src/utils/constants.js` | Shared constants | `SHEET_NAMES`, `ORDER_STATUS`, `PAYMENT_STATUS` | Check: Constants match actual values in sheets |
| `server/src/utils/bot-menu.js` | Menu/FAQ handling | `formatMenuMessage()`, `isFAQQuestion()`, `getFAQAnswer()` | Check: FAQ keywords, menu format |
| `server/src/utils/messages.js` | Standard message templates | `ORDER_NOT_FOUND`, `INVOICE_ERROR`, etc. | Check: Message templates are correct |

**Common Issues:**
- Prices display wrong → Check `formatPrice()`, verify number formatting
- Dates wrong → Check `date-utils.js`, verify timezone (Jakarta)
- Constants don't match → Check `constants.js`, verify values match sheets

### Area: Config

| Folder / File Path | What It Does | Key Functions | How to Debug if Broken |
|-------------------|--------------|---------------|------------------------|
| `server/src/config/env.js` | Environment variable validation | `validateEnv()`, `getEnv()` | Check: `.env` file exists, required vars are set |
| `server/server.js:113` | Loads environment variables | `dotenv.config()` | Check: `.env` file path is correct |

**Common Issues:**
- "Missing required environment variables" → Check `.env` file, verify all required vars are set
- Wrong API URLs → Check `VITE_API_URL` (frontend) or `PORT` (backend)

### Area: Deploy

| Folder / File Path | What It Does | Key Functions | How to Debug if Broken |
|-------------------|--------------|---------------|------------------------|
| `server/server.js:2533` | Server startup | `app.listen(PORT)` | Check: Port is available, env vars are loaded |
| `server/server.js:2550` | Initializes Google Sheets | `initializeStorage()` | Check: Google Sheets connection, sheet creation |
| `server/server.js:2646` | Starts reminder scheduler | `startReminderScheduler()` | Check: Timer logic, Jakarta timezone |

**Common Issues:**
- Server won't start → Check port is available, env vars are set, dependencies installed
- "Exited with status 1" → Check startup logs, verify Google Sheets connection, check env validation

---

## 3. "If This Happens, Go Here" Index

### Bot Not Replying

**Symptoms:**
- Customer sends message, bot doesn't respond
- Commands don't work
- Webhook returns 200 but no action

**Likely Cause:**
- Telegram bot token invalid
- Webhook not set correctly
- Server not running
- Message routing broken

**First File to Check:**
1. `server/src/services/telegramService.js` - Verify `sendTelegramMessage()` works
2. `server/src/handlers/telegramRouter.js` - Verify message routing
3. `server/server.js:224` - Verify webhook endpoint

**What to Log/Check:**
- Check server logs for errors
- Verify `TELEGRAM_BOT_TOKEN` in `.env`
- Test webhook URL: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
- Check if server is receiving webhook requests (logs should show "Received Telegram webhook")

### Totals Mismatch

**Symptoms:**
- Invoice shows wrong total
- `product_total + packaging_fee + delivery_fee ≠ total_amount`
- Payment calculations are wrong

**Likely Cause:**
- Price calculation logic error
- PriceList sheet missing prices
- Packaging fee calculation wrong
- Delivery fee not included

**First File to Check:**
1. `server/src/services/price-calculator.js` - `calculateOrderTotal()`
2. `server/src/repos/orders.repo.js` - `computeOrderTotals()`
3. `server/src/repos/price-list.repo.js` - Verify prices exist

**What to Log/Check:**
- Log calculation steps: product_total, packaging_fee, delivery_fee
- Check PriceList sheet has all products with prices
- Verify formula: `total_amount = product_total + packaging_fee + delivery_fee`
- Check Orders sheet for actual values

### Google Auth Error

**Symptoms:**
- "Permission denied" errors
- "Spreadsheet not found"
- "Service account" errors

**Likely Cause:**
- Service account credentials invalid
- Spreadsheet not shared with service account
- Wrong spreadsheet ID

**First File to Check:**
1. `server/src/repos/sheets.client.js` - `getSheetsClient()`
2. `server/src/config/env.js` - Verify env vars
3. `server/server.js:2550` - `initializeStorage()`

**What to Log/Check:**
- Verify `GOOGLE_SERVICE_ACCOUNT_KEY` or `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` in `.env`
- Check service account email has access to spreadsheet
- Verify `GOOGLE_SPREADSHEET_ID` is correct
- Test Google Sheets API connection manually

### Render "Exited with status 1"

**Symptoms:**
- Server crashes on startup
- Render shows "Exited with status 1"
- No logs available

**Likely Cause:**
- Missing environment variables
- Google Sheets initialization fails
- Port conflict
- Syntax error in code

**First File to Check:**
1. `server/src/config/env.js` - `validateEnv()` (runs at startup)
2. `server/server.js:115-122` - Env validation and error handling
3. `server/server.js:2550` - `initializeStorage()` (may fail)

**What to Log/Check:**
- Check Render logs for error messages
- Verify all required env vars are set in Render dashboard
- Test locally: `cd server && npm start` (should show same error)
- Check Google Sheets connection (may timeout on Render)

### Orders Not Saving

**Symptoms:**
- Order confirmation sent but order not in Google Sheets
- "Error saving order" message
- Orders sheet is empty

**Likely Cause:**
- Google Sheets API error
- Missing column headers
- Permission denied
- Network timeout

**First File to Check:**
1. `server/src/repos/orders.repo.js` - `saveOrder()`
2. `server/src/repos/sheets.client.js` - API connection
3. `server/src/utils/sheets-helpers.js` - Header mapping

**What to Log/Check:**
- Check server logs for Google Sheets API errors
- Verify Orders sheet exists and has headers
- Check `ensureOrdersPaymentHeaders()` ran successfully
- Test Google Sheets API manually

### Payment Not Recorded

**Symptoms:**
- Admin records payment but it doesn't show
- Payment status doesn't update
- Payment_History sheet missing records

**Likely Cause:**
- Payment_History sheet doesn't exist
- Payment update logic error
- Google Sheets write failed

**First File to Check:**
1. `server/src/repos/payment-history.repo.js` - `savePaymentHistory()`
2. `server/src/repos/orders.repo.js` - `updateOrderPayment()`
3. `server/src/services/payment-tracker.js` - Payment calculations

**What to Log/Check:**
- Verify Payment_History sheet exists
- Check payment record was created in Payment_History
- Verify Orders sheet `paid_amount` was updated
- Check payment calculation logic

### Reminders Not Sending

**Symptoms:**
- Orders confirmed but no reminders sent
- Reminders sheet empty
- Daily job not running

**Likely Cause:**
- Daily job not scheduled
- Reminder creation logic error
- Customer chat_id not found

**First File to Check:**
1. `server/src/services/reminder-system.js` - `runDailyRemindersJob()`
2. `server/server.js:2646` - `startReminderScheduler()`
3. `server/src/repos/reminders.repo.js` - Reminder storage

**What to Log/Check:**
- Verify daily job is scheduled (logs should show "Next reminder run scheduled")
- Check Reminders sheet for records
- Verify order has `event_date` and status is "confirmed"
- Check customer chat_id exists in Conversations sheet

---

## 4. Data Flow & Storage (ELI10)

### How Data Flows

**Example: Customer Places Order**

1. **Customer sends message** → Telegram
2. **Telegram** → `server.js:224` (webhook endpoint)
3. **Webhook** → `telegramRouter.js` (routes message)
4. **Router** → `messageHandler.js` (handles non-command messages)
5. **Handler** → `order-parser.js` (parses order from message)
6. **Parser** → `price-calculator.js` (calculates prices)
7. **Calculator** → `orders.repo.js` (saves to Google Sheets)
8. **Repository** → `sheets.client.js` (connects to Google Sheets API)
9. **Google Sheets** → Saves order data
10. **Response** → `telegramService.js` (sends confirmation)
11. **Telegram** → Customer sees confirmation

### What Each Google Sheet Tab Represents

| Sheet Name | What It Stores | Key Columns | When It's Used |
|------------|---------------|-------------|----------------|
| **Orders** | All customer orders | `order_id`, `customer_name`, `items_json`, `total_amount`, `status`, `paid_amount` | Every order, every payment, every status change |
| **Messages** | All Telegram messages | `message_id`, `conversation_id`, `message_text`, `direction` | Every message sent/received |
| **Conversations** | Customer info | `conversation_id`, `external_user_id`, `customer_name` | When customer first messages, to link orders to customers |
| **Users** | Admin users | `user_id`, `role`, `is_active` | When checking if user is admin |
| **PriceList** | Product prices | `product_name`, `price`, `unit` | When calculating order totals |
| **Reminders** | Reminder records | `order_id`, `reminder_type`, `status`, `sent_at` | When daily job creates/sends reminders |
| **Payment_History** | Payment transactions | `payment_id`, `order_id`, `amount`, `proof_file_id` | When admin records payment |

### Key Columns and Their Meaning

**Orders Sheet:**
- `order_id` - Unique ID like "DKM/20260103/000001" (used to find orders)
- `status` - Order status: "pending_confirmation", "confirmed", "processing", etc.
- `total_amount` - Grand total (product_total + packaging_fee + delivery_fee)
- `paid_amount` - How much customer has paid so far
- `remaining_balance` - How much customer still owes (total_amount - paid_amount)
- `payment_status` - "UNPAID", "DP PAID", or "FULL PAID"

**Payment_History Sheet:**
- `payment_id` - Unique payment ID like "PAY/20260110/065129/2615"
- `order_id` - Which order this payment is for
- `amount_confirmed` - Actual amount paid
- `proof_file_id` - Telegram file ID of receipt image (if OCR was used)

---

## 5. Modular System Definition (ELI10)

### What "Modular" Means in THIS Repo

**Modular = Each file has ONE job**

Think of it like a restaurant kitchen:
- **Chef** (order-parser.js) - Only reads orders, doesn't cook
- **Cook** (price-calculator.js) - Only calculates prices, doesn't save
- **Waiter** (orders.repo.js) - Only saves to sheets, doesn't calculate
- **Manager** (server.js) - Coordinates everyone, but doesn't do the work

### How Responsibilities Are Separated

| Responsibility | File(s) | What It Does | What It DOESN'T Do |
|----------------|---------|--------------|-------------------|
| **Parse orders** | `order-parser.js` | Reads message, extracts order fields | Doesn't calculate prices, doesn't save |
| **Calculate prices** | `price-calculator.js` | Calculates totals from items | Doesn't parse orders, doesn't save |
| **Save orders** | `orders.repo.js` | Saves/reads from Google Sheets | Doesn't parse, doesn't calculate |
| **Send messages** | `telegramService.js` | Sends messages to Telegram | Doesn't process orders, doesn't save |
| **Route messages** | `telegramRouter.js` | Decides which handler to use | Doesn't process orders, doesn't send |

### What NOT to Mix in One File

**❌ BAD: One file does everything**
```javascript
// BAD: order-handler.js does everything
function handleOrder(message) {
  const order = parseOrder(message);      // Parsing
  const total = calculateTotal(order);    // Calculation
  await saveToSheets(order);              // Saving
  await sendMessage(total);               // Sending
}
```

**✅ GOOD: Separate files for each job**
```javascript
// order-parser.js - Only parsing
export function parseOrder(message) { ... }

// price-calculator.js - Only calculation
export function calculateTotal(order) { ... }

// orders.repo.js - Only saving
export async function saveOrder(order) { ... }

// telegramService.js - Only sending
export async function sendMessage(text) { ... }
```

**Why this matters:**
- Easy to find bugs (if totals wrong, check price-calculator.js)
- Easy to test (test each part separately)
- Easy to change (change calculation without breaking saving)

---

## 6. Safe Change Playbook

### Where to Add New Features

| Feature Type | Where to Add | Example |
|--------------|--------------|---------|
| **New bot command** | `server/src/commands/` | Add `inventory.commands.js` for `/inventory` command |
| **New order field** | `server/src/repos/orders.repo.js` | Add `discount_amount` column |
| **New calculation** | `server/src/services/price-calculator.js` | Add service fee calculation |
| **New reminder type** | `server/src/services/reminder-system.js` | Add H-7 reminder |
| **New dashboard page** | `src/pages/` | Add `Reports.tsx` for reports page |
| **New API endpoint** | `server/server.js` | Add `app.get('/api/reports')` |

### When to Create a New File

**Create new file when:**
- ✅ Feature is large (100+ lines)
- ✅ Feature is independent (doesn't need other features)
- ✅ Feature might be reused (used in multiple places)

**Don't create new file when:**
- ❌ Feature is tiny (10 lines or less)
- ❌ Feature is only used once
- ❌ Feature is just a helper function

**Examples:**
- ✅ Create `inventory.commands.js` for inventory management (large, independent)
- ❌ Don't create `format-date.js` for one date formatting function (tiny, just use date-utils.js)

### How to Avoid Breaking Existing Logic

**Golden Rules:**

1. **Read before writing**
   - Read the file you're editing
   - Understand what it does
   - Check what imports it

2. **Test in isolation**
   - Test your change alone
   - Don't change multiple things at once
   - Verify old code still works

3. **Follow existing patterns**
   - If other commands use `handleX()`, use `handleY()`
   - If other repos use `saveX()`, use `saveY()`
   - Don't invent new patterns

4. **Update related files**
   - If you add a column, update header creation
   - If you add a command, register it in commandHandler
   - If you add a constant, add it to constants.js

5. **Check dependencies**
   - If you change a function signature, find all places that call it
   - Use IDE "Find References" feature
   - Update all callers

### Golden Rules for Future Changes

1. **One file = One job**
   - Don't mix parsing + calculation + saving
   - Each file should have a clear purpose

2. **Import, don't copy**
   - If code exists elsewhere, import it
   - Don't copy-paste code (creates duplicates)

3. **Test the happy path first**
   - Make it work, then make it perfect
   - Don't optimize before it works

4. **Log everything**
   - Add console.log for debugging
   - Remove logs before committing (or use logger.js)

5. **Document your changes**
   - Update this glossary if you add new files
   - Update System_How_It_Works.md if you change flows
   - Add comments for complex logic

---

## 7. Additional Modules (5W+1H Format)

➕ **Added in this update** - These modules were present in code but not previously documented.

---

### 📁 `server/src/commands/`

**WHAT**
- Organizes all admin bot command handlers into separate files
- Each file handles a group of related commands (orders, payments, reports, system)

**WHY**
- Keeps command logic organized and easy to find
- Prevents `server.js` from becoming too large
- Makes it easy to add new commands without cluttering main files

**WHO**
- **Developers** - When adding new admin commands
- **System** - When admin sends commands like `/parse_order`, `/pay`, `/recap_h1`

**WHEN**
- **Runtime** - When admin sends bot commands via Telegram
- **Manual** - When developer adds new commands

**WHERE**
- Triggered from: `server/src/handlers/commandHandler.js` (imports from `commands/index.js`)
- Also imported by: `server/server.js` (some legacy imports from `admin-bot-commands.js`)

**HOW**
1. Admin sends command (e.g., `/parse_order`)
2. `commandHandler.js` receives command
3. `commandHandler.js` imports handler from `commands/index.js`
4. `commands/index.js` re-exports from specific command file (e.g., `orders.commands.js`)
5. Handler function executes (e.g., `handleParseOrder()`)
6. Handler checks admin permission via `adminGuard.js`
7. Handler performs action (creates order, records payment, etc.)
8. Handler sends response to admin via Telegram

**FILES**
- `commands/index.js` - Re-exports all command handlers (central import point)
- `commands/orders.commands.js` - Order commands: `/parse_order`, `/order_detail`, `/edit`, `/status`, `/cancel`, `/complete`
- `commands/payments.commands.js` - Payment commands: `/pay`, `/payment_status`, `/pay` with OCR
- `commands/reports.commands.js` - Report commands: `/recap_h1`, `/orders_date`, `/orders_today`, `/orders_tomorrow`, `/orders_unpaid`
- `commands/system.commands.js` - System commands: `/admin_auth` (NOT FOUND IN CODE - may be in `admin-bot-commands.js`)

**DEPRECATED/REMOVED COMMANDS**
- `/new_order` - **REMOVED** (as of this update)
  - **Why removed:** Redundant - `/pesan` already handles order creation in groups, and private chat auto-parses order format without commands
  - **Replacement:** 
    - **Group chat:** Use `/pesan` command
    - **Private chat:** Send order format message directly (no command needed)
  - **Function status:** `handleNewOrder()` function is deprecated but kept for backward compatibility (should not be called)

**IF SOMETHING BREAKS**
- **Symptoms:** Admin command doesn't work, "Command not found" error, command executes but fails
- **First file to check:** `server/src/commands/[command-type].commands.js` (e.g., `orders.commands.js` for order commands)
- **Second file if not resolved:** `server/src/handlers/commandHandler.js` (verify command is registered)
- **What to log/inspect:**
  - Check if command handler is exported from `commands/index.js`
  - Check if command is registered in `commandHandler.js` switch statement
  - Check admin permission (verify `isAdmin()` returns true)
  - Check server logs for error messages

---

### 📁 `server/src/middleware/`

**WHAT**
- Provides authentication and authorization middleware
- Checks if Telegram users are admins before allowing admin commands

**WHY**
- Prevents non-admin users from accessing admin commands
- Centralizes admin checking logic (don't repeat in every command)
- Supports both Users sheet and environment variable fallback

**WHO**
- **System** - Automatically checks admin status when admin commands are called
- **Developers** - When writing new admin commands (use `requireAdmin()` or `isAdmin()`)

**WHEN**
- **Runtime** - Every time an admin command is executed
- **Manual** - When developer calls `isAdmin()` or `requireAdmin()` in code

**WHERE**
- Triggered from: Admin command handlers (e.g., `commands/orders.commands.js`)
- Imported by: All command files that need admin checking

**HOW**
1. Admin command handler calls `requireAdmin(userId, sendMessage, chatId)`
2. `adminGuard.js` calls `isAdmin(userId)`
3. `isAdmin()` checks Users sheet for user role
4. If not found in Users sheet, checks `ADMIN_TELEGRAM_USER_IDS` env var (fallback)
5. Returns `true` if admin, `false` if not
6. If not admin, `requireAdmin()` sends error message to user
7. If admin, command continues execution

**FILES**
- `middleware/adminGuard.js` - Admin authentication functions:
  - `isAdmin(userId)` - Returns true/false if user is admin
  - `requireAdmin(userId, sendMessage, chatId)` - Sends error if not admin, returns true/false
  - `assertAdmin(userId, chatId, message)` - Throws error if not admin (for async functions)

**IF SOMETHING BREAKS**
- **Symptoms:** Admin can't access commands, non-admin can access admin commands, "Access denied" for valid admin
- **First file to check:** `server/src/middleware/adminGuard.js` - Verify `isAdmin()` logic
- **Second file if not resolved:** `server/src/repos/users.repo.js` - Verify user role in Users sheet
- **What to log/inspect:**
  - Check Users sheet has user with `role = 'admin'`
  - Check `ADMIN_TELEGRAM_USER_IDS` env var (fallback)
  - Log `userId` being checked (may be string vs number mismatch)
  - Check server logs for "[ADMIN_CHECK]" messages

---

### 📁 `server/src/state/`

**WHAT**
- Manages in-memory state for the Telegram bot
- Tracks processed messages, order confirmations, payment confirmations, and order state
- Prevents duplicate processing and manages conversation state

**WHY**
- Prevents duplicate order confirmations (user clicks "Yes" twice)
- Prevents duplicate invoice sending
- Tracks order state per chat (e.g., "awaiting form input")
- Manages concurrency locks for order finalization

**WHO**
- **System** - Automatically manages state during runtime
- **Developers** - When implementing features that need state tracking

**WHEN**
- **Runtime** - Continuously during server operation
- **Startup** - State maps are initialized empty
- **Cleanup** - Expired entries are cleaned up periodically

**WHERE**
- Triggered from: Multiple places:
  - Order confirmation handlers (check `processedConfirmations`)
  - Command handlers (check `processedCommands`)
  - Callback handlers (check `processedCallbacks`)
  - Order state management (get/set `orderStateByChat`)

**HOW**
1. When order confirmation happens, check `processedConfirmations` Set
2. If order ID already in Set, skip (prevent duplicate)
3. If not in Set, add to Set and process
4. When command received, check `processedCommands` Set
5. If command already processed (same update_id), skip
6. Order state is stored per chat in `orderStateByChat` Map
7. State expires after 30 minutes (TTL)
8. Locks prevent concurrent order finalization (60 second TTL)

**FILES**
- `state/store.js` - All state management:
  - `processedConfirmations` - Set of confirmed order IDs (prevents duplicate confirmations)
  - `sentInvoices` - Map of sent invoices (prevents duplicate invoice sending, 10s TTL)
  - `processedCommands` - Set of processed command update_ids (prevents duplicate command processing)
  - `processedCallbacks` - Set of processed callback query IDs (prevents duplicate button clicks)
  - `orderStateByChat` - Map of chat state (tracks order creation state per chat, 30min TTL)
  - `pendingPaymentConfirmations` - Map of pending payment confirmations
  - `orderFinalizationLocks` - Map of order locks (prevents concurrent finalization, 60s TTL)
  - Functions: `getOrderState()`, `setOrderState()`, `clearOrderState()`, `acquireOrderLock()`, `releaseOrderLock()`

**IF SOMETHING BREAKS**
- **Symptoms:** Duplicate confirmations, duplicate invoices, commands processed twice, order state lost
- **First file to check:** `server/src/state/store.js` - Verify state management logic
- **Second file if not resolved:** Check where state is being used (order confirmation, command handlers)
- **What to log/inspect:**
  - Log state checks (is order ID in `processedConfirmations`?)
  - Check TTL expiration (state may expire too quickly)
  - Verify locks are released (may cause deadlock if not released)
  - Check server restart (state is lost on restart - this is expected)

---

### 📁 `server/scripts/diagnostics/`

**WHAT**
- Diagnostic scripts to check system health and find problems
- Run manually to verify Google Sheets setup, find duplicates, check OCR setup

**WHY**
- Helps diagnose issues without reading code
- Verifies system configuration is correct
- Finds data problems (duplicates, missing sheets, etc.)

**WHO**
- **Developers/Admins** - Run manually when troubleshooting
- **System** - NOT automatically run (manual only)

**WHEN**
- **Manual** - When troubleshooting issues or verifying setup
- **Debug** - When investigating specific problems

**WHERE**
- Triggered from: Command line (e.g., `npm run check:sheets` in `server/` folder)
- Scripts are in: `server/scripts/diagnostics/`

**HOW**
1. Developer runs script from command line (e.g., `node scripts/diagnostics/check-sheet-names.js`)
2. Script loads environment variables
3. Script connects to Google Sheets
4. Script performs diagnostic check (e.g., lists all sheets, finds duplicates)
5. Script prints results to console
6. Developer reviews results

**FILES**
- `scripts/diagnostics/check-sheet-names.js` - Lists all sheets in spreadsheet, compares with expected names from constants
- `scripts/diagnostics/detect-duplicates.js` - Finds duplicate orders in Orders sheet
- `scripts/diagnostics/verify-ocr-setup.js` - Verifies OCR service is configured correctly (Tesseract.js, trained data)

**IF SOMETHING BREAKS**
- **Symptoms:** Script fails to run, script shows errors, script doesn't find expected data
- **First file to check:** The diagnostic script itself (check for errors in console)
- **Second file if not resolved:** `server/src/repos/sheets.client.js` - Verify Google Sheets connection
- **What to log/inspect:**
  - Check `.env` file has required variables
  - Verify Google Sheets API connection works
  - Check script output for specific error messages
  - Verify script is run from correct directory (`server/` folder)

---

### 📁 `server/scripts/migrations/`

**WHAT**
- Migration scripts to update Google Sheets structure
- Changes column names, date formats, or other structural changes

**WHY**
- Updates existing Google Sheets to match new code requirements
- Migrates data from old format to new format
- One-time scripts (run once, not repeatedly)

**WHO**
- **Developers/Admins** - Run manually when upgrading system
- **System** - NOT automatically run (manual only)

**WHEN**
- **Manual** - When upgrading system to new version
- **Deploy** - After code changes that require sheet structure changes

**WHERE**
- Triggered from: Command line (e.g., `npm run migrate:columns` in `server/` folder)
- Scripts are in: `server/scripts/migrations/`

**HOW**
1. Developer runs migration script (e.g., `npm run migrate:columns`)
2. Script loads environment variables
3. Script connects to Google Sheets
4. Script reads current sheet structure
5. Script updates column headers or data format
6. Script saves changes to Google Sheets
7. Script prints results to console

**FILES**
- `scripts/migrations/migrate-column-names.js` - Updates column headers from Title Case to snake_case (e.g., "Order ID" → "order_id")
- `scripts/migrations/migrate-date-time-formats.js` - Updates date/time formats to standardized format (YYYY-MM-DD, HH:MM)

**IF SOMETHING BREAKS**
- **Symptoms:** Migration fails, data is lost, columns are wrong after migration
- **First file to check:** The migration script itself (check for errors in console)
- **Second file if not resolved:** `server/src/repos/sheets.client.js` - Verify Google Sheets connection
- **What to log/inspect:**
  - **⚠️ WARNING:** Make backup of Google Sheets BEFORE running migrations
  - Check migration script output for errors
  - Verify Google Sheets API permissions (needs write access)
  - Check if migration was already run (may cause issues if run twice)
  - Verify sheet structure after migration

---

### 📁 `server/scripts/reports/`

**WHAT**
- Reporting scripts to analyze Google Sheets data
- Generates reports about legacy columns, data quality, etc.

**WHY**
- Helps understand current data state
- Finds legacy data that needs migration
- Provides insights for debugging

**WHO**
- **Developers/Admins** - Run manually for analysis
- **System** - NOT automatically run (manual only)

**WHEN**
- **Manual** - When analyzing data or preparing for migration
- **Debug** - When investigating data issues

**WHERE**
- Triggered from: Command line (e.g., `npm run report:legacy` in `server/` folder)
- Scripts are in: `server/scripts/reports/`

**HOW**
1. Developer runs report script (e.g., `npm run report:legacy`)
2. Script loads environment variables
3. Script connects to Google Sheets
4. Script reads data from sheets
5. Script analyzes data (finds legacy columns, counts issues, etc.)
6. Script prints report to console

**FILES**
- `scripts/reports/report-legacy-columns.js` - Reports which sheets still have old Title Case column names (needs migration)

**IF SOMETHING BREAKS**
- **Symptoms:** Report script fails, report shows unexpected results
- **First file to check:** The report script itself (check for errors in console)
- **Second file if not resolved:** `server/src/repos/sheets.client.js` - Verify Google Sheets connection
- **What to log/inspect:**
  - Check `.env` file has required variables
  - Verify Google Sheets API connection works
  - Check report output for specific findings
  - Verify script is run from correct directory

---

### 📁 `server/services/` (OCR Services)

**WHAT**
- OCR (Optical Character Recognition) services for extracting text from images
- Extracts payment amounts from receipt photos
- Handles image preprocessing to reduce watermark interference

**WHY**
- Allows admin to upload receipt photo instead of typing amount
- Automatically extracts payment amount from receipt image
- Handles watermarked images (common in payment receipts)

**WHO**
- **Admin** - When recording payment with receipt photo
- **System** - When processing `/pay` command with photo attachment

**WHEN**
- **Runtime** - When admin sends `/pay` command with receipt photo
- **Manual** - When testing OCR with `tools/ocr-debug.js`

**WHERE**
- Triggered from: `server/admin-bot-commands.js:42` - `extractAmountFromImage()` function
- Also used by: `server/tools/ocr-debug.js` (debug tool)

**HOW**
1. Admin sends `/pay` command with receipt photo
2. `extractAmountFromImage()` downloads photo from Telegram
3. OCR service preprocesses image (removes watermarks, enhances contrast)
4. OCR service runs Tesseract.js to extract text
5. OCR service searches for amount patterns (e.g., "Rp 150.000")
6. OCR service validates amount (must be between min/max)
7. OCR service returns extracted amount or asks for confirmation if uncertain
8. Payment is recorded with extracted amount

**FILES**
- `services/ocr-service.js` - Main OCR service:
  - `extractFromImage(imageUrl, options)` - Extracts text/amount from image
  - `extractAmountFromImage(imageUrl, options)` - Extracts payment amount specifically
  - Preprocessing functions to handle watermarks
- `services/ocr-large-text-strategy.js` - Alternative OCR strategy for large text (NOT FOUND IN CODE - may be used internally)

**IF SOMETHING BREAKS**
- **Symptoms:** OCR doesn't extract amount, OCR extracts wrong amount, OCR fails completely
- **First file to check:** `server/services/ocr-service.js` - Verify OCR logic
- **Second file if not resolved:** `server/admin-bot-commands.js:42` - Check how OCR is called
- **What to log/inspect:**
  - Check Tesseract.js is installed (`npm list tesseract.js`)
  - Verify `eng.traineddata` file exists in `server/` folder
  - Check image quality (may be too blurry or watermarked)
  - Use `tools/ocr-debug.js` to test OCR with specific image
  - Check OCR confidence score (low confidence = unreliable)

---

### 📁 `server/tools/`

**WHAT**
- Development and debugging tools
- Helps test and debug specific features (like OCR)

**WHY**
- Makes it easier to test features without going through full bot flow
- Provides detailed debugging output
- Useful for development and troubleshooting

**WHO**
- **Developers** - When testing or debugging features
- **System** - NOT used in production (development tool only)

**WHEN**
- **Manual** - When testing OCR or debugging issues
- **Debug** - When investigating specific problems

**WHERE**
- Triggered from: Command line (e.g., `node tools/ocr-debug.js --image receipt.jpg`)
- Tools are in: `server/tools/`

**HOW**
1. Developer runs tool from command line with arguments
2. Tool loads required modules
3. Tool performs test/debug operation
4. Tool prints detailed results to console
5. Developer reviews results

**FILES**
- `tools/ocr-debug.js` - OCR debugging tool:
  - Tests OCR extraction with specific image
  - Shows preprocessing steps
  - Shows extracted text and confidence scores
  - Usage: `node tools/ocr-debug.js --image <path> --mode amount [options]`

**IF SOMETHING BREAKS**
- **Symptoms:** Tool doesn't run, tool shows errors, tool doesn't produce expected output
- **First file to check:** The tool script itself (check for errors in console)
- **Second file if not resolved:** Check dependencies (e.g., Tesseract.js for OCR tool)
- **What to log/inspect:**
  - Check command line arguments are correct
  - Verify required files exist (e.g., image file for OCR tool)
  - Check tool output for specific error messages
  - Verify tool is run from correct directory (`server/` folder)

---

### 📁 `server/src/services/google-calendar.js`

**WHAT**
- Creates Google Calendar events for confirmed orders
- Links orders to calendar for scheduling and reminders

**WHY**
- Helps merchant see orders on calendar
- Provides visual schedule of upcoming deliveries
- Integrates with Google Calendar for better organization

**WHO**
- **System** - Automatically creates calendar events when orders are confirmed
- **Developers** - When modifying calendar integration

**WHEN**
- **Runtime** - When order status changes to "confirmed" (in `finalizeOrder()`)
- **Manual** - NOT manually triggered (automatic)

**WHERE**
- Triggered from: `server/server.js:988` - `createCalendarEvent()` called during order finalization
- Imported by: `server/server.js` (when finalizing orders)

**HOW**
1. Order is confirmed (status changes to "confirmed")
2. `finalizeOrder()` checks if order has `event_date`
3. If `event_date` exists, calls `createCalendarEvent(order)`
4. Calendar service parses order date/time
5. Calendar service creates event in Google Calendar
6. Calendar service saves `calendar_event_id` to Orders sheet
7. Event appears in Google Calendar

**FILES**
- `src/services/google-calendar.js` - Google Calendar integration:
  - `createCalendarEvent(order)` - Creates calendar event for order
  - `parseOrderDateTime(eventDate, deliveryTime)` - Parses date/time from order
  - Uses Google Calendar API v3

**IF SOMETHING BREAKS**
- **Symptoms:** Calendar events not created, "Calendar API error", events created with wrong date/time
- **First file to check:** `server/src/services/google-calendar.js` - Verify calendar creation logic
- **Second file if not resolved:** `server/server.js:988` - Check how calendar is called
- **What to log/inspect:**
  - Check `GOOGLE_CALENDAR_ID` env var (defaults to 'primary' if not set)
  - Verify service account has Calendar API access
  - Check date/time parsing (may fail if format is wrong)
  - Verify `calendar_event_id` is saved to Orders sheet
  - Check Google Calendar API errors in logs

---

### 📁 `server/src/utils/` (Additional Files)

**WHAT**
- Additional utility files for specific tasks
- Text normalization, delivery time extraction, order formatting, message fallback, logging

**WHY**
- Keeps utility functions organized by purpose
- Makes code reusable and testable
- Separates concerns (formatting vs parsing vs validation)

**WHO**
- **System** - Used automatically by other modules
- **Developers** - When implementing features that need these utilities

**WHEN**
- **Runtime** - When processing orders, formatting messages, normalizing text
- **Manual** - NOT manually triggered (used by other code)

**WHERE**
- Triggered from: Various places:
  - Order parser uses text normalization
  - Message handlers use formatting
  - Order confirmation uses order formatter
  - All modules use logger

**HOW**
- Each utility file provides specific functions
- Other modules import and use these functions
- Functions are pure (no side effects, just transform data)

**FILES**
- `utils/logger.js` - Production-safe logging:
  - `logger.error()`, `logger.warn()`, `logger.info()`, `logger.debug()`
  - Controlled by `LOG_LEVEL` env var (ERROR/WARN/INFO/DEBUG)
  - Default: ERROR in production, DEBUG in development
- `utils/delivery-time-extractor.js` - Extracts delivery time from message text:
  - `extractDeliveryTimeFromMessage(messageText)` - Finds time in natural language
  - Handles formats like "Kirim dari outlet: 10.45 WIB", "kirim pukul 10.45"
- `utils/text-normalizer.js` - Text cleaning utilities:
  - `normalizeText(raw)` - Removes invisible Unicode characters, normalizes whitespace
  - `normalizeDeliveryMethod(method)` - Standardizes delivery method capitalization
- `utils/order-formatter.js` - Order confirmation text formatting:
  - `formatOrderConfirmation(order, calculation, orderSummary)` - Formats confirmation message
  - `calculatePackagingFee()` - Calculates packaging fee for display
- `utils/order-message-formatter.js` - Order message formatting helpers:
  - `formatOrderHeader()`, `formatOrderItems()`, `formatPaymentSummary()`, `formatNotes()`
- `utils/message-fallback.js` - Fallback messages for unhandled input:
  - `getFallbackMessage(isEnglish)` - Friendly message when bot doesn't understand
  - `getIncompleteOrderMessage(errors, isEnglish)` - Message when order format is incomplete
  - `canSendFallback(chatId)` - Checks cooldown (prevents spam)
  - `detectLanguage(text)` - Detects if message is English or Indonesian

**IF SOMETHING BREAKS**
- **Symptoms:** Text not normalized correctly, delivery time not extracted, formatting errors, too many fallback messages
- **First file to check:** The specific utility file (e.g., `text-normalizer.js` for text issues)
- **Second file if not resolved:** Check where utility is called (may be using it wrong)
- **What to log/inspect:**
  - For logger: Check `LOG_LEVEL` env var, verify logs appear at correct level
  - For text normalizer: Check input text has invisible characters, verify normalization output
  - For delivery time: Check message text format, verify time pattern matching
  - For formatters: Check order data structure, verify formatting functions receive correct data
  - For fallback: Check cooldown logic, verify fallback isn't sent too often

---

## 7. Commands & Roles

**WHAT**
- Role-based command visibility system
- Public commands visible to all users
- Admin commands visible only to admins (in private chat)
- Command menus automatically configured based on user role

**WHY**
- Better UX: Users only see commands they can use
- Security: Admin commands hidden from non-admins (though server-side validation still enforced)
- Clear separation: Public vs admin functionality

**WHO**
- **Users** - See public commands when typing "/"
- **Admins** - See public + admin commands when typing "/" in private chat
- **System** - Automatically registers commands at startup

**WHEN**
- **Startup** - Commands registered when bot starts
- **Runtime** - Command visibility based on user role and chat type
- **Manual** - Can re-register commands by restarting bot

**WHERE**
- **Command definitions:** `server/src/config/commands.js`
- **Command registration:** `server/src/services/commandRegistration.js`
- **Admin config:** `server/src/config/admin.js`
- **Admin auth:** `server/src/middleware/adminGuard.js`
- **Telegram API:** `server/src/services/telegramService.js` → `setMyCommands()`

**HOW**

**Command Registration Flow:**
1. Bot starts → `initializeCommandRegistration()` called
2. Public commands registered with default scope (all users see these)
3. Admin IDs fetched from Users sheet + env var
4. For each admin: Admin commands registered with `chat_member` scope
5. Admin sees public + admin commands in private chat
6. Normal users see only public commands

**Command Visibility:**
- **Default scope:** Public commands (visible to everyone)
- **Chat member scope:** Public + admin commands (visible to specific admin in their private chat)
- **Group chats:** Only public commands appear in menu (admin commands still work if typed manually)

**Command Categories:**

**Public Commands:**
- `/start` - Welcome message
- `/pesan` - Create order
- `/menu` - View menu and prices
- `/help` - Order format guide

**Admin Commands:**
- `/parse_order` - Parse order from template
- `/order_detail` - View order details
- `/status` - Check order status
- `/pay` - Record payment
- `/payment_status` - Check payment status
- `/edit` - Edit existing order
- `/cancel` - Cancel order
- `/complete` - Mark order as complete
- `/today_reminder` - Check and send reminders
- `/orders_today` - List today's orders
- `/orders_tomorrow` - List tomorrow's orders
- `/orders_date` - List orders by date
- `/orders_unpaid` - List unpaid orders
- `/recap_h1` - H-1 recap
- `/admin_help` - Admin command list with examples

**FILES**
- `server/src/config/commands.js` - Command definitions (PUBLIC_COMMANDS, ADMIN_COMMANDS)
- `server/src/config/admin.js` - Admin ID management
- `server/src/services/commandRegistration.js` - Command registration logic
- `server/src/services/telegramService.js` - Telegram API wrapper (setMyCommands)
- `server/src/middleware/adminGuard.js` - Admin authentication
- `server/src/commands/system.commands.js` - System commands (admin_help, admin_auth)

**IF SOMETHING BREAKS**
- **Symptoms:** Commands not showing in menu, admin commands visible to non-admins, commands not working
- **First file to check:** `server/src/config/commands.js` (verify command definitions)
- **Second file if not resolved:** `server/src/services/commandRegistration.js` (check registration logic)
- **Third file if not resolved:** `server/src/config/admin.js` (verify admin IDs are correct)
- **What to log/inspect:**
  - Check startup logs for command registration success/failure
  - Verify admin IDs are correct (Users sheet + env var)
  - Check Telegram API responses for setMyCommands
  - Verify chat type (admin commands only visible in private chat)
  - Check if bot was restarted after admin role changes

**Troubleshooting:**
- **Commands not showing:** Telegram may cache command menus - restart bot or wait a few minutes
- **Admin commands not visible:** Verify user is admin (check Users sheet or env var), ensure they're in private chat
- **Command registration fails:** Check Telegram bot token, verify API permissions, check network connection

**Updating Command List:**
1. Edit `server/src/config/commands.js`
2. Add/remove commands from `PUBLIC_COMMANDS` or `ADMIN_COMMANDS`
3. Restart bot (commands will be re-registered automatically)
4. Test in Telegram (may need to wait a few minutes for cache to clear)

---

## 8. Testing Checklist for Order Creation Entry Points

**Purpose:** Manual testing steps to verify `/pesan` and private chat order creation work correctly after removing `/new_order`

### Test Scenario 1: Group Chat - `/pesan` Command (No Payload)

**Steps:**
1. Open a Telegram group chat where the bot is added
2. Type `/pesan` (without order format)
3. Bot should respond with order template/form
4. Send order format message in the same chat
5. Bot should parse and create order
6. Bot should send confirmation with order ID

**Expected Results:**
- ✅ Bot responds with order template
- ✅ Bot accepts order format message
- ✅ Order is created with valid order ID
- ✅ Confirmation message is sent

**If Fails:**
- Check: `server/src/handlers/commandHandler.js` → `/pesan` case
- Check: State management (`AWAITING_FORM` mode)
- Check: `server/src/handlers/messageHandler.js` → order parsing logic

---

### Test Scenario 2: Group Chat - `/pesan` Command (With Payload)

**Steps:**
1. Open a Telegram group chat where the bot is added
2. Type `/pesan` followed by order format in the same message
3. Bot should parse and create order immediately
4. Bot should send confirmation with order ID

**Expected Results:**
- ✅ Bot parses order from command payload
- ✅ Order is created with valid order ID
- ✅ Confirmation message is sent
- ✅ No template message is sent (order already provided)

**If Fails:**
- Check: `server/src/handlers/commandHandler.js` → `/pesan` case → payload detection
- Check: `server/src/services/order-parser.js` → `parseOrderFromMessageAuto()`

---

### Test Scenario 3: Private Chat - Direct Order Format (Auto-Parse)

**Steps:**
1. Open private chat with the bot
2. Send order format message directly (no command)
3. Bot should auto-detect order format
4. Bot should parse and create order
5. Bot should send confirmation with order ID

**Expected Results:**
- ✅ Bot auto-detects order format
- ✅ Order is created with valid order ID
- ✅ Confirmation message is sent
- ✅ No command is required

**If Fails:**
- Check: `server/src/handlers/messageHandler.js` → `handleTelegramMessage()`
- Check: `server/src/services/order-parser.js` → `detectOrderFormat()`
- Check: Chat type detection (must be `private`)

---

### Test Scenario 4: Private Chat - Invalid Format

**Steps:**
1. Open private chat with the bot
2. Send a message that is NOT in order format (e.g., "Hello")
3. Bot should NOT try to parse it as an order
4. Bot should either ignore or send helpful error message

**Expected Results:**
- ✅ Bot does NOT try to parse invalid message
- ✅ No order is created
- ✅ Bot may send error message with format template (optional)

**If Fails:**
- Check: `server/src/services/order-parser.js` → `detectOrderFormat()` (should return false)
- Check: `server/src/handlers/messageHandler.js` → validation logic

---

### Test Scenario 5: `/new_order` Command (Should Not Work)

**Steps:**
1. Open any chat (group or private) with the bot
2. Type `/new_order`
3. Bot should NOT create an order
4. Bot should either:
   - Not respond (command not recognized), OR
   - Send deprecation message (if handler still exists)

**Expected Results:**
- ✅ `/new_order` does NOT create orders
- ✅ Command is removed from command list
- ✅ Help text does NOT mention `/new_order`

**If Fails:**
- Check: `server/src/handlers/commandHandler.js` → `/new_order` case should be removed
- Check: `server/server.js` → `/new_order` case should be removed
- Check: Help text in `system.commands.js` and `admin-bot-commands.js`

---

### Test Scenario 6: Help Text Verification

**Steps:**
1. Open any chat with the bot
2. Type `/help` or `/start`
3. Check help message content
4. Verify `/new_order` is NOT mentioned
5. Verify `/pesan` IS mentioned (if applicable)

**Expected Results:**
- ✅ `/new_order` is NOT in help text
- ✅ `/pesan` is mentioned (if help text includes order commands)
- ✅ Help text is clear about how to create orders

**If Fails:**
- Check: `server/src/commands/system.commands.js` → help text
- Check: `server/admin-bot-commands.js` → help text
- Check: `server/src/handlers/commandHandler.js` → `/help` case

---

### Test Scenario 7: Admin Auth Help Text

**Steps:**
1. Authenticate as admin (if applicable)
2. Check admin help message
3. Verify `/new_order` is NOT in admin command list

**Expected Results:**
- ✅ `/new_order` is NOT in admin command list
- ✅ Admin commands list is accurate

**If Fails:**
- Check: `server/src/commands/system.commands.js` → admin auth help text
- Check: `server/admin-bot-commands.js` → admin auth help text

---

### Quick Verification Checklist

After removing `/new_order`, verify:

- [ ] `/new_order` case removed from `commandHandler.js`
- [ ] `/new_order` case removed from `server.js`
- [ ] `/new_order` removed from help text in `system.commands.js`
- [ ] `/new_order` removed from help text in `admin-bot-commands.js`
- [ ] `handleNewOrder` function marked as deprecated (or removed)
- [ ] `/pesan` works in group chats
- [ ] Private chat auto-parsing works
- [ ] Documentation updated with entry points explanation
- [ ] No linter errors introduced

---

### 📁 `server/src/repos/waiting-list.repo.js`

**WHAT**
- Repository for WaitingList sheet operations
- **🔍 Clarification:** WaitingList sheet is DEPRECATED (replaced by Reminders sheet)
- Kept for backward compatibility

**WHY**
- Maintains backward compatibility with old code
- May still be used for legacy data migration
- **Note:** New code should use Reminders sheet instead

**WHO**
- **System** - May be used by legacy code paths
- **Developers** - Should NOT use for new features (use Reminders instead)

**WHEN**
- **Runtime** - Only if legacy code paths are still active
- **Manual** - NOT recommended for new code

**WHERE**
- May be imported by: Legacy code (NOT FOUND IN CODE - may be unused)
- **Recommendation:** Check if this file is actually used before modifying

**HOW**
- Similar to other repos: provides CRUD operations for WaitingList sheet
- **Note:** Reminders system has replaced waiting list functionality

**FILES**
- `repos/waiting-list.repo.js` - WaitingList sheet operations (DEPRECATED)

**IF SOMETHING BREAKS**
- **Symptoms:** WaitingList operations fail, sheet not found
- **First file to check:** Verify if this file is actually used (search for imports)
- **Second file if not resolved:** Use Reminders system instead (see `reminder-system.js`)
- **What to log/inspect:**
  - Check if WaitingList sheet exists (may have been deleted)
  - Verify if any code still imports this file
  - **Recommendation:** Migrate to Reminders system if still using WaitingList

---

### 📁 `server/assets/ocr/`

**WHAT**
- Storage for OCR training data and assets
- Contains Tesseract.js language data files

**WHY**
- OCR needs language data to recognize text
- Keeps training data organized and accessible

**WHO**
- **System** - OCR service reads training data from here
- **Developers** - When setting up OCR or adding new languages

**WHEN**
- **Runtime** - When OCR service initializes (loads training data)
- **Setup** - When installing OCR dependencies

**WHERE**
- Used by: `server/services/ocr-service.js` (Tesseract.js reads from here)
- Files are in: `server/assets/ocr/` (or `server/` root for `eng.traineddata`)

**HOW**
1. OCR service initializes Tesseract.js worker
2. Tesseract.js loads training data from `assets/ocr/` or root folder
3. Training data is used to recognize text in images
4. OCR service uses training data to extract text

**FILES**
- `assets/ocr/` - Folder for OCR training data (may be empty or contain language files)
- `server/eng.traineddata` - English language training data (in server root)

**IF SOMETHING BREAKS**
- **Symptoms:** OCR fails to initialize, "Language data not found" error
- **First file to check:** Verify `eng.traineddata` exists in `server/` folder
- **Second file if not resolved:** `server/services/ocr-service.js` - Check how training data is loaded
- **What to log/inspect:**
  - Check if `eng.traineddata` file exists
  - Verify Tesseract.js can find training data
  - Check OCR initialization errors in logs
  - May need to download training data: `npm install` should handle this

---

## 9. Testing Checklist for Role-Based Commands

**Purpose:** Manual testing steps to verify command visibility and admin security work correctly

### Test Scenario 1: Normal User - Private Chat Command Menu

**Steps:**
1. Open private chat with bot as normal user (non-admin)
2. Type "/" to see command menu
3. Verify only public commands appear: `/start`, `/pesan`, `/menu`, `/help`
4. Verify admin commands do NOT appear

**Expected Results:**
- ✅ Only public commands visible
- ✅ No admin commands in menu
- ✅ Command descriptions are clear

**If Fails:**
- Check: `server/src/config/commands.js` → `PUBLIC_COMMANDS` definition
- Check: Command registration logs at startup
- Check: User is not admin (verify Users sheet or env var)

---

### Test Scenario 2: Normal User - Admin Command Access

**Steps:**
1. Open private chat with bot as normal user
2. Manually type `/admin_help` (even though it's not in menu)
3. Bot should respond with "Unauthorized" message
4. Manually type `/pay DKM/20260117/000001 50000`
5. Bot should respond with "Unauthorized" message

**Expected Results:**
- ✅ `/admin_help` returns "Unauthorized"
- ✅ `/pay` returns "Unauthorized"
- ✅ No admin command list leaked to non-admins

**If Fails:**
- Check: `server/src/commands/system.commands.js` → `handleAdminHelp()` security check
- Check: `server/src/middleware/adminGuard.js` → `requireAdmin()` function
- Check: Handler functions have admin checks

---

### Test Scenario 3: Admin User - Private Chat Command Menu

**Steps:**
1. Open private chat with bot as admin user
2. Type "/" to see command menu
3. Verify public + admin commands appear
4. Verify admin commands are listed: `/parse_order`, `/order_detail`, `/status`, `/pay`, etc.

**Expected Results:**
- ✅ Public commands visible
- ✅ Admin commands visible
- ✅ All commands have descriptions
- ✅ Command menu is organized

**If Fails:**
- Check: `server/src/config/commands.js` → `ADMIN_COMMANDS` definition
- Check: Admin ID is correct (Users sheet or env var)
- Check: Command registration logs (should show admin commands registered)
- Check: User is in private chat (not group chat)

---

### Test Scenario 4: Admin User - Admin Help Command

**Steps:**
1. Open private chat with bot as admin user
2. Type `/admin_help`
3. Bot should respond with formatted admin command list
4. Verify list includes:
   - Command names
   - Descriptions
   - Usage examples (where applicable)
   - Organized by category

**Expected Results:**
- ✅ Command list is formatted nicely
- ✅ All admin commands listed
- ✅ Examples provided for commands that need them
- ✅ Categories are clear (Pesanan, Pembayaran, Laporan, Sistem)

**If Fails:**
- Check: `server/src/commands/system.commands.js` → `handleAdminHelp()` function
- Check: `server/src/config/commands.js` → `ADMIN_COMMANDS` definitions

---

### Test Scenario 5: Group Chat - Command Menu

**Steps:**
1. Open group chat where bot is added
2. Type "/" to see command menu
3. Verify only public commands appear
4. Admin commands should NOT appear (even for admin users)

**Expected Results:**
- ✅ Only public commands visible in group
- ✅ Admin commands not in menu (but still work if typed manually)

**If Fails:**
- Check: Command registration uses `chat_member` scope (private chat only)
- Check: Default scope is set correctly for public commands

---

### Test Scenario 6: Group Chat - Admin Command Execution

**Steps:**
1. Open group chat where bot is added
2. As admin user, manually type `/pay DKM/20260117/000001 50000`
3. Bot should execute command (if admin)
4. As normal user, manually type `/pay DKM/20260117/000001 50000`
5. Bot should respond with "Unauthorized"

**Expected Results:**
- ✅ Admin can execute admin commands in group (if typed manually)
- ✅ Normal user cannot execute admin commands
- ✅ Security enforced server-side (not just menu visibility)

**If Fails:**
- Check: Handler functions have admin checks (`requireAdmin()` or `isAdmin()`)
- Check: `server/src/middleware/adminGuard.js` → admin validation logic

---

### Test Scenario 7: Help Command - Role-Based Content

**Steps:**
1. As normal user, type `/help`
2. Verify help text shows order format guide
3. Verify no admin hint appears
4. As admin user, type `/help`
5. Verify help text shows order format guide
6. Verify admin hint appears: "Ketik /admin_help untuk daftar command admin"

**Expected Results:**
- ✅ Normal user: Standard help text only
- ✅ Admin user: Help text + admin hint
- ✅ Admin hint is clear and helpful

**If Fails:**
- Check: `server/src/handlers/commandHandler.js` → `/help` case
- Check: `isAdmin()` check is working correctly

---

### Test Scenario 8: Command Registration at Startup

**Steps:**
1. Restart bot server
2. Check startup logs
3. Verify command registration messages appear
4. Verify public commands registered
5. Verify admin commands registered for each admin

**Expected Results:**
- ✅ Logs show "Command registration complete"
- ✅ Public commands registered successfully
- ✅ Admin commands registered for each admin ID
- ✅ No errors in registration process

**If Fails:**
- Check: `server/server.js` → `initializeCommandRegistration()` call
- Check: `server/src/services/commandRegistration.js` → registration logic
- Check: Telegram bot token is valid
- Check: Network connection to Telegram API

---

### Quick Verification Checklist

After implementing role-based commands, verify:

- [ ] Public commands defined in `commands.js`
- [ ] Admin commands defined in `commands.js`
- [ ] Command registration called at startup
- [ ] Admin IDs correctly fetched (Users sheet + env)
- [ ] `/admin_help` command handler added
- [ ] `/help` command shows role-based content
- [ ] All admin handlers have security checks
- [ ] No linter errors
- [ ] Documentation updated

---

## 10. Empty Folders (For Future Use)

These folders exist but are currently empty (NOT FOUND IN CODE - no files):

- `server/src/services/order-parser/` - Empty folder (order parser files are directly in `services/`)
- `server/src/services/google-sheets/` - Empty folder (Google Sheets code is in `repos/`)
- `server/src/services/reminders/` - Empty folder (reminder code is in `services/reminder-system.js`)

**Note:** These folders may be placeholders for future code organization. Currently, related code is in parent directories.

---

**End of Modular System Glossary**
