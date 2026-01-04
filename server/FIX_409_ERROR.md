# Fix: Telegram Error 409

## What is Error 409?

**Error 409 = Conflict**

This happens when your Telegram bot has a **webhook** set, but you're trying to use **polling** mode.

Telegram doesn't allow both at the same time!

## ✅ Solution (Already Fixed!)

The server now **automatically removes webhooks** before starting polling.

### If you still get 409:

**Option 1: Manual Fix (Quick)**
Run this command to remove webhook manually:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/deleteWebhook?drop_pending_updates=true"
```

Replace `<YOUR_BOT_TOKEN>` with your actual token from `.env` file.

**Option 2: Restart Server**
The server should automatically remove webhook when it starts. Just restart:
```bash
# Stop server (Ctrl+C)
npm run dev
```

You should see:
```
✅ Webhook removed (required for polling mode)
✅ Polling started!
```

## 🔍 How to Check

**Check if webhook exists:**
```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

If it shows `"url": ""` or empty, webhook is removed ✅

## 📝 Summary

- **409 Error** = Webhook conflict
- **Solution** = Server now auto-removes webhook
- **If still happens** = Restart server or manually delete webhook

The fix is already in the code - just restart your server! 🚀
