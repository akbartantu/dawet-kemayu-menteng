# DAWET Backend Server

Simple Node.js server to handle Telegram bot and manual WhatsApp message input.

## Quick Start Guide

### Step 1: Install Dependencies

```bash
cd server
npm install
```

### Step 2: Create Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` command
3. Follow instructions to name your bot
4. BotFather will give you a **token** (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
5. Save this token!

### Step 3: Set Up Environment Variables

Create a `.env` file in the `server` folder:

```env
PORT=3001
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
```

**Example:**
```env
PORT=3001
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

### Step 4: Run the Server

```bash
npm run dev
```

You should see:
```
🚀 Server running on http://localhost:3001
📡 Telegram webhook: http://localhost:3001/api/webhooks/telegram
💬 Send Telegram: POST http://localhost:3001/api/messages/send
📝 Manual WhatsApp: POST http://localhost:3001/api/messages/whatsapp-manual
```

### Step 5: How It Works

**For Local Development (Automatic):**
- The server uses **polling mode** - it checks Telegram for new messages every 2 seconds
- No webhook setup needed!
- Just start the server and message your bot

**For Production (Webhook):**
When you deploy your server, set the webhook URL:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-server.com/api/webhooks/telegram"
```

Or use **ngrok** for local testing with webhook:
```bash
ngrok http 3001
```
Then set webhook to: `https://your-ngrok-url.ngrok.io/api/webhooks/telegram`

### Step 6: Test It!

**Test 1: Health Check**
```bash
curl http://localhost:3001/health
```

**Test 2: Send Telegram Message**
```bash
curl -X POST http://localhost:3001/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{"chatId": "YOUR_TELEGRAM_CHAT_ID", "text": "Hello from DAWET!"}'
```

**Test 3: Manual WhatsApp Message Input**
```bash
curl -X POST http://localhost:3001/api/messages/whatsapp-manual \
  -H "Content-Type: application/json" \
  -d '{"from": "6281234567890", "text": "Customer sent this via WhatsApp"}'
```

**Test 4: Message Your Bot**
1. Open Telegram
2. Search for your bot (the name you gave it)
3. Send `/start` - bot should respond!
4. Send a regular message - it will be stored

## How It Works

1. **Customer messages your Telegram bot** → Webhook receives it → Stored in system
2. **Merchant sends message via API** → Goes to customer's Telegram
3. **Merchant receives WhatsApp message** → Manually inputs it → Stored in system

## What's Next?

1. ✅ Telegram bot working (DONE)
2. ✅ Manual WhatsApp input (DONE)
3. ✅ Google Sheets storage (DONE)
4. ✅ Order parsing & management (DONE)
5. ✅ Frontend dashboard (DONE)
6. ✅ Payment notifications (DONE)
7. ⏳ Deploy to Render (Next step - see DEPLOYMENT_GUIDE.md)
8. ⏳ Set up Telegram webhook for production
9. ⏳ Full WhatsApp integration (when API access ready)
