# Testing Guide - Telegram Bot

## Quick Troubleshooting

### Error: 404 Not Found

**Problem**: Server isn't running or wrong URL

**Solution**:
1. Make sure server is running:
   ```bash
   cd "On Production/server"
   npm run dev
   ```

2. You should see:
   ```
   🚀 Server running on http://localhost:3001
   ```

3. Test in browser: Open http://localhost:3001
   - Should show: `{"message":"DAWET Server is running!",...}`

4. Test health: Open http://localhost:3001/health
   - Should show: `{"status":"ok","timestamp":"..."}`

---

### Error: Telegram webhook not working

**Problem**: Telegram can't reach your local server

**Solution for Local Testing**:

1. **Option A: Use ngrok (Recommended)**
   ```bash
   # Install ngrok: https://ngrok.com/download
   ngrok http 3001
   ```
   - Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
   - Set webhook:
     ```bash
     curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://abc123.ngrok.io/api/webhooks/telegram"
     ```

2. **Option B: Test without webhook (Manual)**
   - Don't set webhook
   - Use polling instead (we'll add this if needed)

---

### Error: TELEGRAM_BOT_TOKEN not found

**Problem**: Missing .env file or token

**Solution**:
1. Create `.env` file in `server` folder:
   ```env
   PORT=3001
   TELEGRAM_BOT_TOKEN=your_token_here
   ```

2. Get token from @BotFather on Telegram

---

## Step-by-Step Testing

### Step 1: Start Server
```bash
cd "On Production/server"
npm install  # If first time
npm run dev
```

### Step 2: Test Server is Running
Open browser: http://localhost:3001

Should see JSON response with endpoints list.

### Step 3: Test Health Endpoint
Open browser: http://localhost:3001/health

Should see: `{"status":"ok",...}`

### Step 4: Test Send Message (Need Chat ID)
```bash
# First, message your bot on Telegram
# Then get your chat ID from the webhook or use this:
curl -X POST http://localhost:3001/api/messages/send \
  -H "Content-Type: application/json" \
  -d "{\"chatId\": \"YOUR_CHAT_ID\", \"text\": \"Test message\"}"
```

### Step 5: Test Manual WhatsApp Input
```bash
curl -X POST http://localhost:3001/api/messages/whatsapp-manual \
  -H "Content-Type: application/json" \
  -d "{\"from\": \"6281234567890\", \"text\": \"Test WhatsApp message\"}"
```

### Step 6: Check Stored Messages
Open browser: http://localhost:3001/api/messages

Should see all stored messages.

---

## Common Issues

### "Cannot GET /"
- Server not running → Start with `npm run dev`
- Wrong port → Check PORT in .env (default: 3001)

### "TELEGRAM_BOT_TOKEN not configured"
- Missing .env file → Create it
- Wrong token → Get new one from @BotFather

### "Telegram API error"
- Invalid token → Check token in .env
- Wrong chat ID → Make sure you message the bot first

### CORS errors in browser
- Already fixed in server.js
- Make sure you're using the latest server.js

---

## Next Steps After Testing

1. ✅ Server running
2. ✅ Can send messages
3. ⏳ Set up webhook (for production)
4. ⏳ Connect to database
5. ⏳ Connect frontend
