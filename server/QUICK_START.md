# 🚀 Quick Start - Telegram Bot

## 3 Simple Steps to Get Your Bot Working

### Step 1: Create Telegram Bot
1. Open Telegram app
2. Search for **@BotFather**
3. Send: `/newbot`
4. Follow instructions (name it "DAWET Bot" or whatever you want)
5. **Copy the token** BotFather gives you (looks like: `123456789:ABCdef...`)

### Step 2: Set Up Environment
1. Go to `On Production/server` folder
2. Create `.env` file:
   ```env
   PORT=3001
   TELEGRAM_BOT_TOKEN=paste_your_token_here
   ```
3. Paste your bot token from Step 1

### Step 3: Start Server
```bash
cd "On Production/server"
npm install  # Only first time
npm run dev
```

You should see:
```
🚀 Server running on http://localhost:3001
🔄 Starting polling mode for local development...
✅ Polling started! Bot will check for new messages every 2 seconds.
```

### Step 4: Test It!
1. Open Telegram
2. Search for your bot (the name you gave it)
3. Click "Start" or send `/start`
4. **Bot should respond!** 🎉

---

## ✅ What Should Happen

When you send `/start` to your bot:
- Bot responds: "👋 Selamat datang di DAWET!..."
- Server console shows: "💬 New Telegram message received"
- Message is stored in server

---

## ❌ Troubleshooting

### Bot doesn't respond?
1. **Check server is running** - Look for "✅ Polling started" message
2. **Check .env file** - Make sure `TELEGRAM_BOT_TOKEN` is set correctly
3. **Check token** - Get a new token from @BotFather if needed
4. **Restart server** - Stop (Ctrl+C) and run `npm run dev` again

### Still not working?
Check server console for errors. Common issues:
- `TELEGRAM_BOT_TOKEN not configured` → Check .env file
- `Telegram API error` → Check token is correct
- No messages in console → Server might not be receiving updates

---

## 🎯 Next Steps

Once bot is working:
1. ✅ Bot responds to messages
2. ⏳ Connect to database (store messages permanently)
3. ⏳ Connect frontend (show messages in dashboard)
4. ⏳ Add bot conversation logic (order taking)
