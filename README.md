# 🥤 DAWET - Telegram Bot Order Management System

**Production-ready Telegram bot for managing Dawet Kemayu orders with Google Sheets integration**

---

## 📋 OVERVIEW

DAWET is a comprehensive order management system built for Dawet Kemayu business operations. It integrates Telegram Bot API with Google Sheets for seamless order tracking, payment processing, and customer management.

### ✨ KEY FEATURES

#### 📦 Order Management
- ✅ Automated order parsing from customer messages
- ✅ Real-time order tracking and status updates
- ✅ Smart duplicate detection
- ✅ Order confirmation workflow with Y/N responses
- ✅ Admin-only order commands (`/orders_date`, `/orders_unpaid`)

#### 💰 Payment Processing
- ✅ Payment history tracking
- ✅ **Simplified payment confirmation** - Just reply "Ya" or "Tidak"
- ✅ OCR-based receipt scanning
- ✅ Automatic payment status updates
- ✅ Unpaid order tracking with `/orders_unpaid`

#### 🔔 Smart Reminders
- ✅ Automated delivery reminders
- ✅ Daily order recaps for admins
- ✅ Anti-spam protection (no duplicate reminders)

#### 📊 Google Sheets Integration
- ✅ Real-time sync with Google Sheets
- ✅ Automatic header mapping
- ✅ Payment history audit trail
- ✅ Comprehensive order data storage

#### 🤖 OCR Integration
- ✅ Automatic receipt text extraction
- ✅ Multiple preprocessing modes
- ✅ Support for Indonesian & English text

---

## 🚀 QUICK START

### Prerequisites
- Node.js 18+
- Google Cloud Project with Sheets API enabled
- Telegram Bot Token
- Service Account Key (Google Sheets)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd DAWET

# Navigate to server
cd "Ready to Deploy/server"

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start server
npm run dev
```

---

## 📂 PROJECT STRUCTURE

```
DAWET/
├── Ready to Deploy/          # ✅ Production-ready code
│   └── server/
│       ├── server.js         # Main bot server
│       ├── admin-bot-commands.js  # Admin commands
│       ├── google-sheets.js  # Google Sheets integration
│       ├── payment-tracker.js
│       ├── order-parser.js
│       ├── reminder-system.js
│       └── services/
│           └── ocr-service.js
│
└── On Production/            # 🧪 Development & testing
    └── server/
        ├── *.js              # Active development files
        └── *.md              # Documentation
```

---

## 🎯 RECENT UPDATES (Last Session)

### ✅ Completed Features

#### 1. Command Rename: `/complete` → `/close`
- Shorter, more intuitive name
- Backward compatible

#### 2. New Command: `/orders_unpaid`
- Track unpaid & partial payment orders
- Same format as `/orders_date`
- Admin-only access

#### 3. Payment UX Simplification
**Before:** `/pay_confirm PAY/20260110/021726/3855`  
**After:** Just reply "**Ya**" or "**Tidak**"

- ✅ One-word response
- ✅ No copy-paste required
- ✅ Works in group & private chats
- ✅ Auto-expire after 5 minutes

#### 4. Critical Bug Fixes
- ✅ Fixed `requireSnakeCase` errors (4 locations)
- ✅ Fixed payment vs order confirmation priority
- ✅ Fixed `paid_amount` column updates
- ✅ Fixed group chat confirmation responses

---

## 📱 BOT COMMANDS

### Customer Commands
- `/start` - Start interaction with bot
- `/cancel <order_id>` - Cancel an order

### Admin Commands
- `/orders_date [date]` - List orders by date
- `/orders_unpaid [date]` - List unpaid orders
- `/pay <order_id> <amount>` - Record payment without proof
- `/close <order_id>` - Mark order as completed
- `/help` - Show help menu

### Date Format Support
- `today`, `tomorrow`
- `YYYY-MM-DD` (2026-01-15)
- `DD/MM/YYYY` (15/01/2026)

---

## 🔧 CONFIGURATION

### Environment Variables

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Google Sheets
GOOGLE_SHEET_ID=your_sheet_id_here
SERVICE_ACCOUNT_KEY=path/to/service-account-key.json

# Admin Settings
ADMIN_USER_IDS=123456789,987654321

# Timezone
TIMEZONE=Asia/Jakarta
```

---

## 📊 GOOGLE SHEETS SCHEMA

### Orders Sheet
- order_id, customer_name, phone_number
- delivery_date, delivery_time, delivery_method
- product_details, total_amount
- **paid_amount**, **total_paid**, **payment_status**
- order_status, created_at, updated_at

### Payment_History Sheet
- payment_id, order_id, amount_paid
- payment_method, payment_date
- proof_file_id (optional)
- status, confirmed_by, confirmed_at

---

## 🧪 TESTING

### Manual Testing Checklist
- [ ] Test `/orders_unpaid` with real data
- [ ] Test payment "Ya"/"Tidak" flow (private chat)
- [ ] Test payment "Ya"/"Tidak" flow (group chat)
- [ ] Verify `paid_amount` updates in Google Sheets
- [ ] Test `/close` command
- [ ] Verify Payment_History audit trail

---

## 📚 DOCUMENTATION

Comprehensive documentation available in `On Production/server/`:
- `FINAL-SESSION-SUMMARY-COMPLETE.md` - Latest session summary
- `ORDERS-UNPAID-COMMAND-DOC.md` - `/orders_unpaid` documentation
- `PAYMENT-CONFIRMATION-UX-FIX.md` - Payment UX improvements
- `COMPLETE-SYSTEM-DOCUMENTATION.md` - Full system docs

---

## 🤝 CONTRIBUTING

This is a private business project. For questions or support, contact the project maintainer.

---

## 📄 LICENSE

Proprietary - All rights reserved

---

## 🎉 ACKNOWLEDGMENTS

Built with:
- Node.js & Express
- Telegram Bot API
- Google Sheets API v4
- Tesseract.js (OCR)

---

**Status:** ✅ Production Ready  
**Last Updated:** 10 Januari 2026  
**Version:** 2.0.0  

**🚀 Ready for real-world usage with customers!**
