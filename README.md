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

## 📦 Deployment to Render

### SECTION A — Deploy to Render (Step-by-Step Guide)

Follow these steps to deploy your DAWET bot to Render:

#### Step 1: Create a New Web Service in Render

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** button (top right)
3. Select **"Web Service"**
4. You'll be asked to connect a Git repository

#### Step 2: Connect GitHub Repository

1. Click **"Connect account"** if you haven't connected GitHub yet
2. Authorize Render to access your GitHub repositories
3. Select your repository from the list
4. Select the branch you want to deploy (usually `main` or `master`)

#### Step 3: Configure Root Directory

**Important:** If your repository contains both "On Production" and "Ready to Deploy" folders:

1. In the **"Root Directory"** field, enter: `Ready to Deploy`
2. This tells Render to use only the "Ready to Deploy" folder

**If your repository contains only "Ready to Deploy" files:**
- Leave **"Root Directory"** blank (empty)

#### Step 4: Set Build Command

1. In the **"Build Command"** field, enter:
   ```
   cd server && npm install
   ```
2. This installs all Node.js dependencies

**Note:** If you have a frontend that needs building, you may need:
   ```
   npm install && cd server && npm install
   ```
   (But for bot-only deployment, the first command is sufficient)

#### Step 5: Set Start Command

1. In the **"Start Command"** field, enter:
   ```
   cd server && npm start
   ```
   Or alternatively:
   ```
   cd server && node server.js
   ```

#### Step 6: Add Environment Variables

See **SECTION B** below for detailed instructions on setting environment variables.

#### Step 7: Deploy Latest Commit

1. Click **"Create Web Service"**
2. Render will start building and deploying your service
3. Wait for the build to complete (usually 2-5 minutes)
4. You'll see build logs in real-time

#### Step 8: Check Runtime Logs

1. Once deployed, go to the **"Logs"** tab
2. Look for:
   - ✅ `Server running on port XXXX`
   - ✅ `Google Sheets initialized`
   - ✅ `Production mode: Using webhook`
3. If you see errors, check:
   - Missing environment variables (see Section B)
   - Import/module errors (check logs)
   - Google Sheets authentication issues

#### Step 9: Quick Smoke Test

1. Open your Telegram bot
2. Send `/start` - bot should respond
3. Send a test order message
4. Check Render logs to see if message was received

---

### SECTION B — Environment Variables on Render (Step-by-Step)

#### Step 1: Open Environment Tab

1. In Render Dashboard, select your web service
2. Click **"Environment"** tab (left sidebar)

#### Step 2: Add Each Required Variable

Click **"Add Environment Variable"** for each variable below:

#### Required Environment Variables:

1. **`TELEGRAM_BOT_TOKEN`**
   - **Value:** Your Telegram bot token from BotFather
   - **Example:** `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
   - **Important:** Keep this secret!

2. **`GOOGLE_SPREADSHEET_ID`**
   - **Value:** Your Google Spreadsheet ID (from the spreadsheet URL)
   - **Example:** `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t`
   - **How to find:** Open your Google Sheet → Look at the URL → Copy the long ID between `/d/` and `/edit`

3. **`GOOGLE_SERVICE_ACCOUNT_KEY`**
   - **Value:** The entire contents of your `service-account.json` file as a JSON string
   - **Special handling for newlines:** See "Private Key Newline Handling" below
   - **Important:** This is a multi-line JSON. See instructions below.

4. **`TZ`**
   - **Value:** `Asia/Jakarta`
   - **Why:** Ensures reminder scheduler uses correct timezone

5. **`NODE_ENV`**
   - **Value:** `production`
   - **Why:** Enables production mode (webhook instead of polling)

#### Optional Environment Variables:

6. **`ADMIN_TELEGRAM_USER_IDS`**
   - **Value:** Comma-separated list of Telegram user IDs
   - **Example:** `123456789,987654321`
   - **How to find:** Send `/start` to your bot, check logs for your user ID

7. **`ADMIN_SETUP_CODE`**
   - **Value:** A secret code for admin setup (optional)
   - **Example:** `mySecretCode123`

8. **`GOOGLE_CALENDAR_ID`**
   - **Value:** Google Calendar ID (default: `primary`)
   - **Example:** `primary` or `your-calendar-id@group.calendar.google.com`

9. **`LOG_LEVEL`**
   - **Value:** `info`, `debug`, `warn`, or `error` (default: `info`)

10. **`OCR_DEBUG`**
    - **Value:** `true` or `false` (default: `false`)

#### Step 3: Private Key Newline Handling (CRITICAL)

The `GOOGLE_SERVICE_ACCOUNT_KEY` contains a private key with newlines. Render's UI may escape these.

**Option A: Paste with Escaped Newlines (Recommended)**
1. Open your `service-account.json` file
2. Copy the entire file content
3. In Render, paste it directly into the value field
4. The code automatically converts `\\n` to `\n` if needed

**Option B: Manual Escape (If Option A doesn't work)**
1. Open your `service-account.json` file
2. Replace all actual newlines in the `private_key` field with `\n` (backslash + n)
3. Make it a single line JSON string
4. Paste into Render

**Example format:**
```json
{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n",...}
```

#### Step 4: Save Changes

1. After adding all variables, click **"Save Changes"**
2. Render will automatically redeploy your service
3. Wait for redeployment to complete

#### Step 5: Verify Environment Variables

1. Check the **"Logs"** tab after redeployment
2. Look for startup messages confirming:
   - ✅ Environment variables validated
   - ✅ Google Sheets connected
   - ✅ Telegram webhook registered

---

### Common Mistakes to Avoid

1. **❌ Forgetting PORT binding**
   - ✅ **Fixed:** The code automatically uses `process.env.PORT` (Render sets this automatically)

2. **❌ Private key newline issues**
   - ✅ **Fixed:** Code automatically handles `\\n` → `\n` conversion
   - ⚠️ **Still check:** Make sure the JSON is valid after pasting

3. **❌ Missing spreadsheet ID**
   - ⚠️ **Check:** Verify `GOOGLE_SPREADSHEET_ID` is set correctly
   - ⚠️ **Check:** Ensure the spreadsheet is shared with your service account email

4. **❌ Wrong bot token**
   - ⚠️ **Check:** Get a fresh token from @BotFather if needed
   - ⚠️ **Check:** Make sure there are no extra spaces in the token

5. **❌ Root Directory not set**
   - ⚠️ **Check:** If your repo has both folders, set Root Directory to `Ready to Deploy`

6. **❌ Wrong start command**
   - ✅ **Correct:** `cd server && npm start` or `cd server && node server.js`
   - ❌ **Wrong:** `npm start` (this won't work because package.json is in server/)

---

### Git Commands to Commit Ready to Deploy

If you need to commit only the "Ready to Deploy" folder to a separate repository:

```bash
# Navigate to Ready to Deploy folder
cd "Ready to Deploy"

# Initialize git (if not already initialized)
git init

# Add remote repository
git remote add origin <your-repository-url>

# Add all files
git add .

# Commit changes
git commit -m "Deploy: update Ready to Deploy with latest modular structure"

# Push to repository
git push -u origin main
```

**Note:** Make sure `.gitignore` is in place to exclude secrets and `node_modules/`.

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
