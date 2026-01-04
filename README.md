# 🍧 DAWET - Telegram Bot Order Management System

**Status**: ✅ Production Ready  
**Last Updated**: 2026-01-03

---

## 📋 Overview

DAWET is a complete order management system for small food businesses, powered by a Telegram bot. Customers can place orders via Telegram, and merchants can manage orders through a web dashboard.

---

## ✨ Current Features

### ✅ Working Features

1. **Telegram Bot Integration**
   - Receive and send messages
   - Command handling: `/start`, `/menu`, `/help`
   - FAQ handling (jam buka, lokasi, ongkir, pembayaran) - Automatic keyword detection

2. **Order Management**
   - Automatic order parsing from customer messages
   - Order confirmation flow (Yes/No buttons)
   - Invoice generation
   - Payment notifications (DP 50% if >3 days, full payment if ≤3 days)
   - Order status workflow
   - Search & filter orders

3. **Waiting List System**
   - Automatic detection of future-dated orders
   - Separate storage for waiting list
   - Confirmation flow for future orders
   - **Google Calendar integration** - Automatic calendar events with reminders

4. **Google Sheets Storage**
   - Messages, Conversations, Orders, PriceList, WaitingList sheets
   - Automatic sheet creation
   - Real-time updates

5. **Frontend Dashboard**
   - Orders management page
   - Conversations page
   - Real-time data updates
   - Status management

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (or higher)
- npm or yarn
- Google Cloud Service Account (for Sheets API access)
- Telegram Bot Token

### Step 1: Create Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` command
3. Follow instructions to name your bot
4. BotFather will give you a **token** (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
5. Save this token!

### Step 2: Install Dependencies

**Backend:**
```bash
cd server
npm install
```

**Frontend:**
```bash
npm install
```

### Step 3: Set Up Environment Variables

**Backend (`server/.env`):**
```env
PORT=3001
NODE_ENV=development

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=service-account-key.json
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id

# Optional: Admin Setup
ADMIN_SETUP_CODE=your_admin_setup_code
```

**Frontend (`.env`):**
```env
VITE_API_URL=http://localhost:3001
```

### Step 4: Run the Application

**Backend:**
```bash
cd server
npm run dev
```

You should see:
```
🚀 Server running on http://localhost:3001
📡 Telegram webhook: http://localhost:3001/api/webhooks/telegram
```

**Frontend:**
```bash
npm run dev
```

Runs on `http://localhost:8080` (or configured port)

### Step 5: Test It!

1. **Health Check**
   ```bash
   curl http://localhost:3001/health
   ```

2. **Message Your Bot**
   - Open Telegram
   - Search for your bot
   - Send `/start` - bot should respond!
   - Send a regular message - it will be stored

---

## 📦 Deployment

### Deploy to Render (Backend)

1. Push code to GitHub
2. Create Web Service on Render
3. Set environment variables:
   - `PORT` (default: 3001)
   - `TELEGRAM_BOT_TOKEN`
   - `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` (upload JSON file)
   - `GOOGLE_SPREADSHEET_ID`
   - `NODE_ENV=production`
4. Set build command: `cd server && npm install`
5. Set start command: `cd server && node server.js`
6. Configure Telegram webhook:
   ```bash
   curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-app.onrender.com/api/webhooks/telegram"
   ```

### Deploy to Vercel/Render (Frontend)

1. Connect GitHub repository
2. Set `VITE_API_URL` environment variable (your backend URL)
3. Deploy!

---

## 🔧 How It Works

### Local Development

- **Backend**: Uses **polling mode** - checks Telegram for new messages every 2 seconds
- **Frontend**: Connects to backend API for data

### Production

- **Backend**: Uses **webhook mode** - Telegram sends messages directly to your server
- **Frontend**: Serves static build files

### Message Flow

1. **Customer messages your Telegram bot** → Webhook/Polling receives it → Stored in Google Sheets
2. **Merchant sends message via Dashboard** → Goes to customer's Telegram
3. **Order placed** → Automatic parsing → Confirmation flow → Invoice sent

---

## 📊 Project Structure

```
Ready to Deploy/
├── server/              # Backend (Node.js/Express)
│   ├── server.js        # Main server file
│   ├── google-sheets.js # Google Sheets integration
│   ├── order-parser.js  # Order parsing logic
│   ├── price-calculator.js # Price calculation & invoices
│   └── bot-menu.js      # Bot menu & FAQ
├── src/                 # Frontend (React/TypeScript)
│   ├── pages/           # Page components
│   ├── components/      # UI components
│   └── lib/             # API client
└── public/              # Static assets
```

---

## 🎯 Next Steps

1. ✅ Telegram bot working
2. ✅ Order management
3. ✅ Frontend dashboard
4. ✅ Payment notifications
5. ⏳ Deploy to Render
6. ⏳ Set up Telegram webhook for production
7. ⏳ Full WhatsApp integration (when API access ready)

---

## 📝 License

Private project - All rights reserved

---

## 🙏 Support

For issues or questions, check the code comments or contact the development team.
