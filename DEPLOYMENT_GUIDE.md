# 🚀 Deployment Guide: GitHub + Render

**Last Updated**: 2026-01-03  
**Purpose**: Deploy DAWET to Render so Telegram bot works 24/7 (even when laptop is off)

---

## 📋 Prerequisites

- GitHub account
- Render account (free tier available)
- Telegram bot token (already have)
- Google Service Account key (already have)
- Google Spreadsheet ID (already have)

---

## Step 1: Prepare Repository for GitHub

### 1.1 Create `.gitignore` Files

**Root `.gitignore`** (if not exists):
```gitignore
# Dependencies
node_modules/
.pnp
.pnp.js

# Testing
coverage/

# Production
dist/
build/

# Environment variables
.env
.env.local
.env.production

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Editor
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Service account key (IMPORTANT - don't commit!)
server/service-account-key.json
```

**Server `.gitignore`** (if not exists):
```gitignore
node_modules/
.env
service-account-key.json
*.log
```

### 1.2 Remove Sensitive Files from Git (if already committed)

```bash
# Remove service account key from git history (if committed)
git rm --cached server/service-account-key.json

# Remove .env files
git rm --cached server/.env
git rm --cached .env
```

---

## Step 2: Push to GitHub

### 2.1 Initialize Git Repository (if not already)

```bash
cd "D:\02 PERSONAL\03 PROJECT\09 DAWET\On Production"
git init
git add .
git commit -m "Initial commit: DAWET Telegram bot ready for deployment"
```

### 2.2 Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `dawet-bot` (or your preferred name)
3. Description: "DAWET - Telegram Bot Order Management System"
4. **Make it Private** (recommended for production)
5. Click "Create repository"

### 2.3 Push to GitHub

```bash
# Add remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/dawet-bot.git

# Push to GitHub
git branch -M main
git push -u origin main
```

---

## Step 3: Deploy Backend to Render

### 3.1 Create New Web Service on Render

1. Go to https://dashboard.render.com
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account (if not connected)
4. Select your repository: `dawet-bot`
5. Configure service:

**Basic Settings**:
- **Name**: `dawet-backend`
- **Region**: Singapore (closest to Indonesia)
- **Branch**: `main`
- **Root Directory**: `server` (important!)
- **Runtime**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`

**Environment Variables** (click "Add Environment Variable" for each):

```
PORT=3001
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=service-account-key.json
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id_here
NODE_ENV=production
```

### 3.2 Upload Service Account Key

**Option A: Environment Variable (Recommended for Render)**

1. In Render dashboard, go to your service
2. Click "Environment" tab
3. Add new variable:
   - **Key**: `GOOGLE_SERVICE_ACCOUNT_KEY`
   - **Value**: Paste the entire JSON content from `service-account-key.json`
   - **Important**: Paste it as a single line (remove all line breaks)

**Option B: Secret File (Alternative)**

1. In Render dashboard, go to your service
2. Click "Environment" tab
3. Use "Secret Files" feature to upload `service-account-key.json`

### 3.3 Update Code to Use Environment Variable (if using Option A)

Update `server/google-sheets.js` to read from environment variable:

```javascript
// At the top of google-sheets.js, replace the key file reading:
let serviceAccountKey;
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  // Read from environment variable (Render)
  serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
} else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
  // Read from file (local development)
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const keyData = await import('fs').then(fs => 
    fs.readFileSync(keyFile, 'utf8')
  );
  serviceAccountKey = JSON.parse(keyData);
} else {
  throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY_FILE must be set');
}
```

### 3.4 Deploy

1. Click **"Create Web Service"**
2. Render will:
   - Clone your repository
   - Install dependencies
   - Start your server
3. Wait for deployment (usually 2-3 minutes)
4. Your service will be available at: `https://dawet-backend.onrender.com` (or your custom domain)

---

## Step 4: Set Up Telegram Webhook

### 4.1 Get Your Render URL

After deployment, your backend URL will be:
```
https://dawet-backend.onrender.com
```

### 4.2 Set Telegram Webhook

```bash
# Replace YOUR_BOT_TOKEN and YOUR_RENDER_URL
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://dawet-backend.onrender.com/api/webhooks/telegram"
```

**Expected Response**:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

### 4.3 Verify Webhook

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

**Expected Response**:
```json
{
  "ok": true,
  "result": {
    "url": "https://dawet-backend.onrender.com/api/webhooks/telegram",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

### 4.4 Update Server Code for Production

Update `server/server.js` to disable polling in production:

```javascript
// After server starts, check if webhook is set
if (process.env.NODE_ENV === 'production') {
  console.log('🌐 Production mode: Using webhook (polling disabled)');
  // Don't start polling in production
} else {
  console.log('🔄 Development mode: Starting polling...');
  startPolling();
}
```

---

## Step 5: Deploy Frontend (Optional)

### 5.1 Deploy to Vercel (Recommended)

1. Go to https://vercel.com
2. Import your GitHub repository
3. Configure:
   - **Framework Preset**: Vite
   - **Root Directory**: `.` (root)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Add Environment Variable:
   - **Key**: `VITE_API_URL`
   - **Value**: `https://dawet-backend.onrender.com`
5. Deploy!

### 5.2 Deploy to Render (Alternative)

1. In Render dashboard, click **"New +"** → **"Static Site"**
2. Connect GitHub repository
3. Configure:
   - **Name**: `dawet-frontend`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
4. Add Environment Variable:
   - **Key**: `VITE_API_URL`
   - **Value**: `https://dawet-backend.onrender.com`
5. Deploy!

---

## Step 6: Test Deployment

### 6.1 Test Backend Health

```bash
curl https://dawet-backend.onrender.com/health
```

**Expected**: `{"status":"ok","timestamp":"..."}`

### 6.2 Test Telegram Bot

1. Open Telegram
2. Message your bot
3. Send `/start`
4. Bot should respond!

### 6.3 Test Order Flow

1. Send an order message to your bot
2. Bot should:
   - Parse the order
   - Send confirmation with buttons
   - After confirmation, send invoice + payment notification

---

## 🔧 Troubleshooting

### Issue: Bot Not Responding

**Check**:
1. Webhook is set correctly: `curl "https://api.telegram.org/botTOKEN/getWebhookInfo"`
2. Render service is running (check logs in Render dashboard)
3. Environment variables are set correctly

### Issue: Google Sheets Error

**Check**:
1. Service account key is correctly set in environment variables
2. Service account has "Editor" access to spreadsheet
3. Spreadsheet ID is correct

### Issue: Server Crashes

**Check Render Logs**:
1. Go to Render dashboard
2. Click on your service
3. Click "Logs" tab
4. Look for error messages

---

## 📝 Important Notes

1. **Free Tier Limitations**:
   - Render free tier spins down after 15 minutes of inactivity
   - First request after spin-down takes ~30 seconds (cold start)
   - Consider upgrading to paid plan for 24/7 uptime

2. **Environment Variables**:
   - Never commit `.env` or `service-account-key.json` to GitHub
   - Always use Render's environment variables for secrets

3. **Webhook vs Polling**:
   - Production: Use webhook (faster, more reliable)
   - Development: Use polling (easier for local testing)

4. **Monitoring**:
   - Check Render dashboard regularly
   - Set up email alerts for service failures
   - Monitor Telegram bot activity

---

## ✅ Deployment Checklist

- [ ] Repository pushed to GitHub
- [ ] `.gitignore` configured (no secrets committed)
- [ ] Backend deployed to Render
- [ ] Environment variables set in Render
- [ ] Telegram webhook configured
- [ ] Backend health check passes
- [ ] Telegram bot responds to messages
- [ ] Order flow tested end-to-end
- [ ] Frontend deployed (optional)
- [ ] Frontend connected to backend API

---

## 🎉 Success!

Your DAWET bot is now running 24/7 on Render! Even when your laptop is off, customers can:
- Message your bot
- Place orders
- Receive confirmations and invoices
- Get payment notifications

**Next Steps**:
- Monitor usage and performance
- Set up custom domain (optional)
- Upgrade to paid plan for better performance (optional)
- Add more features as needed
