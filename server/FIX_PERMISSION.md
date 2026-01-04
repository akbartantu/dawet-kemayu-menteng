# 🔧 Fix: "The caller does not have permission"

## Problem
Your service account doesn't have access to the Google Spreadsheet.

## ✅ Quick Fix (2 minutes)

### Step 1: Find Your Service Account Email

Open `service-account-key.json` and look for:
```json
{
  "client_email": "dawet-sheets@your-project.iam.gserviceaccount.com"
}
```

**Copy that email address** (the `client_email` value)

### Step 2: Share Spreadsheet with Service Account

1. Open your Google Spreadsheet:
   - URL: https://docs.google.com/spreadsheets/d/1Tq-84e0SOFp8OoerIeu3NKakjrNxeIXM6FmciYXeagM

2. Click the **Share** button (top right)

3. In the "Add people and groups" field, paste the service account email:
   - Example: `dawet-sheets@your-project.iam.gserviceaccount.com`

4. **IMPORTANT**: Change permission from "Viewer" to **"Editor"**

5. **Uncheck** "Notify people" (service accounts don't have email)

6. Click **Share**

### Step 3: Restart Server

```bash
npm run dev
```

You should now see:
```
✅ Google Sheets initialized
   Spreadsheet: https://docs.google.com/spreadsheets/d/...
```

## 🎯 That's It!

After sharing, your bot messages will save directly to Google Sheets!

---

## 📋 Quick Checklist

- [ ] Found service account email in `service-account-key.json`
- [ ] Opened Google Spreadsheet
- [ ] Clicked Share button
- [ ] Added service account email
- [ ] Set permission to **Editor** (not Viewer!)
- [ ] Unchecked "Notify people"
- [ ] Clicked Share
- [ ] Restarted server

---

## ❓ Still Not Working?

**Check:**
1. Did you use the exact email from `client_email` in the JSON file?
2. Did you set permission to **Editor** (not Viewer)?
3. Did you wait a few seconds after sharing? (Sometimes takes a moment)

**Try:**
- Close and reopen the spreadsheet
- Wait 10 seconds, then restart server
- Double-check the email address matches exactly
