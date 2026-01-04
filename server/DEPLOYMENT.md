# 🚀 Server Deployment Guide

Quick reference for deploying the DAWET backend server.

## Environment Variables Required

```env
PORT=3001
TELEGRAM_BOT_TOKEN=your_bot_token_here
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=service-account-key.json
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id_here
NODE_ENV=production
```

## For Render Deployment

**Option 1: Use Environment Variable for Service Account Key**

Set `GOOGLE_SERVICE_ACCOUNT_KEY` as environment variable (JSON string, single line).

**Option 2: Use Secret File**

Upload `service-account-key.json` via Render's Secret Files feature.

## Production vs Development

- **Production**: Uses webhook (set via Telegram API)
- **Development**: Uses polling (automatic)

The server automatically detects `NODE_ENV=production` and disables polling.

## Start Command

```bash
npm start
```

## Health Check

```bash
GET /health
```

Returns: `{"status":"ok","timestamp":"..."}`
