# 📊 Google Sheets Setup Guide

## Quick Setup (5 minutes)

### Step 1: Create Google Cloud Project

1. Go to https://console.cloud.google.com
2. Create a new project (or use existing)
3. Name it "DAWET" or whatever you want

### Step 2: Enable Google Sheets API

1. In Google Cloud Console, go to **APIs & Services** → **Library**
2. Search for "Google Sheets API"
3. Click **Enable**

### Step 3: Create Service Account

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **Service Account**
3. Name it "dawet-sheets" (or any name)
4. Click **Create and Continue**
5. Skip role assignment (click **Continue**)
6. Click **Done**

### Step 4: Create Service Account Key

1. Click on the service account you just created
2. Go to **Keys** tab
3. Click **Add Key** → **Create new key**
4. Choose **JSON**
5. Download the JSON file
6. **Save it securely!** This is your private key.

### Step 5: Create Google Spreadsheet

1. Go to https://sheets.google.com
2. Create a new spreadsheet
3. Name it "DAWET Messages" (or any name)
4. **Share it with the service account email**
   - Click **Share** button
   - Paste the service account email (looks like: `dawet-sheets@your-project.iam.gserviceaccount.com`)
   - Give it **Editor** permission
   - Click **Send**

### Step 6: Get Spreadsheet ID

From the spreadsheet URL:
```
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
```

Copy the `SPREADSHEET_ID_HERE` part.

### Step 7: Update .env File

Add these to your `.env` file:

```env
# Google Sheets
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=path/to/your-service-account-key.json
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id_here
```

**Example:**
```env
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account-key.json
GOOGLE_SPREADSHEET_ID=1a2b3c4d5e6f7g8h9i0j
```

### Step 8: Place Service Account Key File

1. Copy the downloaded JSON file to `On Production/server/` folder
2. Rename it to `service-account-key.json` (or use the path in .env)

**Important:** Add to `.gitignore`:
```
service-account-key.json
*.json
```

### Step 9: Restart Server

```bash
npm run dev
```

You should see:
```
✅ Google Sheets initialized
   Spreadsheet: https://docs.google.com/spreadsheets/d/...
```

## ✅ That's It!

Now all messages will be saved directly to your Google Spreadsheet!

## 📋 What Gets Created

The server automatically creates two sheets:

1. **Messages** - All Telegram and WhatsApp messages
2. **Conversations** - All chat conversations

## 🔍 Viewing Your Data

Just open your Google Spreadsheet! All messages appear in real-time.

Or get the link via API:
```bash
curl http://localhost:3001/api/spreadsheet
```

## 🛠️ Troubleshooting

### "Error: Could not load the default credentials"
- Check `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` path in .env
- Make sure the JSON file exists

### "Error: The caller does not have permission"
- Make sure you shared the spreadsheet with the service account email
- Give it **Editor** permission (not Viewer)

### "Error: Unable to parse range"
- Spreadsheet might not exist
- Check `GOOGLE_SPREADSHEET_ID` in .env

## 📝 File Structure

```
On Production/server/
├── .env
├── service-account-key.json  ← Your Google service account key
├── server.js
└── google-sheets.js
```

## 🎯 Next Steps

1. ✅ Google Sheets connected
2. ⏳ Messages saving to spreadsheet
3. ⏳ Connect frontend to show messages
4. ⏳ Add more features

---

**Your data is now in Google Sheets!** 📊✨
