# 📊 Spreadsheet Storage Guide

## How It Works

Instead of a database, we use **JSON files** that you can easily:
- Open in Excel
- Import to Google Sheets
- View and edit manually
- Export to CSV

## 📁 Storage Location

All data is stored in: `On Production/server/data/`

Files created:
- `messages.json` - All messages (Telegram + WhatsApp)
- `conversations.json` - All conversations

## 🔍 Viewing Your Data

### Option 1: View JSON Files Directly
```bash
# Open in any text editor
code On Production/server/data/messages.json
```

### Option 2: Export to CSV (Excel/Google Sheets)

**Via Browser:**
- Messages: http://localhost:3001/api/export/csv?type=messages
- Conversations: http://localhost:3001/api/export/csv?type=conversations

**Via API:**
```bash
# Download messages CSV
curl http://localhost:3001/api/export/csv?type=messages > messages.csv

# Download conversations CSV
curl http://localhost:3001/api/export/csv?type=conversations > conversations.csv
```

### Option 3: Import JSON to Google Sheets

1. Open Google Sheets
2. File → Import
3. Upload `messages.json` or `conversations.json`
4. Choose "Convert text to columns" if needed

### Option 4: Open in Excel

1. Open Excel
2. Data → Get Data → From File → From JSON
3. Select `messages.json` or `conversations.json`

## 📋 Data Structure

### Messages JSON
```json
[
  {
    "id": "telegram_123",
    "conversation_id": "conv_telegram_456",
    "telegram_chat_id": 123456789,
    "from": "123456789",
    "from_name": "Customer Name",
    "text": "Hello!",
    "source": "telegram",
    "direction": "inbound",
    "status": "delivered",
    "created_at": "2026-01-03T10:00:00.000Z"
  }
]
```

### Conversations JSON
```json
[
  {
    "id": "conv_telegram_456",
    "telegram_chat_id": 123456789,
    "customer_id": "telegram_123456789",
    "customer_name": "Customer Name",
    "status": "active",
    "last_message_at": "2026-01-03T10:00:00.000Z",
    "created_at": "2026-01-03T09:00:00.000Z"
  }
]
```

## ✅ Advantages

- ✅ **No setup needed** - Works immediately
- ✅ **Easy to view** - Open in Excel/Sheets
- ✅ **Portable** - Just copy the JSON files
- ✅ **Human readable** - Edit manually if needed
- ✅ **Free** - No database costs

## ⚠️ Limitations

- ⚠️ **Not for high volume** - Best for < 10,000 messages
- ⚠️ **Single server only** - Can't share between multiple servers
- ⚠️ **No concurrent writes** - One write at a time

## 🔄 Migrating to Real Database Later

When you're ready, you can:
1. Export all data to CSV
2. Import into PostgreSQL/MySQL
3. Update code to use database instead

The API stays the same, just swap `storage.js` for `database.js`!

## 🎯 Next Steps

1. ✅ Storage working (JSON files)
2. ⏳ View data in Excel/Sheets
3. ⏳ Connect frontend to show messages
4. ⏳ Add more features

---

**Your data is stored in:** `On Production/server/data/`

Open those JSON files anytime! 📊
