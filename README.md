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
   - Command handling:
     - ✅ `/start` - Welcome message (working)
     - ⚠️ `/menu` - Display menu (code exists, needs testing)
     - ⚠️ `/help` - Help instructions (code exists, needs testing)
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

### Local Development

**Backend**:
```bash
cd server
npm install
# Create .env file with your credentials
npm run dev
```

**Frontend**:
```bash
npm install
npm run dev
```

See `server/README.md` for detailed setup instructions.

---

## 📦 Deployment

### Deploy to Render (Backend)

1. Push code to GitHub
2. Create Web Service on Render
3. Set environment variables
4. Configure Telegram webhook

**Full guide**: See `DEPLOYMENT_GUIDE.md`

### Deploy to Vercel/Render (Frontend)

1. Connect GitHub repository
2. Set `VITE_API_URL` environment variable
3. Deploy!

---

## 📚 Documentation

- **Current Features**: `CURRENT_FEATURES.md`
- **Deployment Guide**: `DEPLOYMENT_GUIDE.md`
- **Server Setup**: `server/README.md`
- **Order Flow**: `server/ORDER_CONFIRMATION_FLOW.md`
- **Price List**: `server/PRICE_LIST_GUIDE.md`

---

## 🔧 Environment Variables

### Backend (`server/.env`)

```env
PORT=3001
TELEGRAM_BOT_TOKEN=your_bot_token
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=service-account-key.json
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id
NODE_ENV=development
```

### Frontend (`.env`)

```env
VITE_API_URL=http://localhost:3001
```

---

## 📊 Project Structure

```
On Production/
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
└── docs/                # Documentation
```

---

## 🎯 Next Steps

1. **Deploy to Render** - Follow `DEPLOYMENT_GUIDE.md`
2. **Set up Telegram webhook** - For production
3. **Test end-to-end** - Verify all features work in production
4. **Monitor** - Check logs and performance

---

## 📝 License

Private project - All rights reserved

---

## 🙏 Support

For issues or questions, check the documentation files or contact the development team.
