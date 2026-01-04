# 🔧 Create WaitingList Sheet Manually (If Needed)

If the WaitingList sheet wasn't created automatically, you can create it manually or run this command:

## Option 1: Restart Server (Recommended)

Just restart your server - it will create the WaitingList sheet automatically:

```bash
cd "On Production/server"
npm run dev
```

You should see:
```
📝 Creating WaitingList sheet...
✅ WaitingList sheet created
✅ WaitingList sheet initialized with headers
```

## Option 2: Create Manually in Google Sheets

1. Open your Google Spreadsheet
2. Click the "+" button at the bottom to add a new sheet
3. Name it exactly: **WaitingList** (case-sensitive)
4. Add these headers in Row 1:

| Column | Header |
|--------|--------|
| A | Order ID |
| B | Customer Name |
| C | Phone Number |
| D | Address |
| E | Event Name |
| F | Event Duration |
| G | Event Date |
| H | Delivery Time |
| I | Items (JSON) |
| J | Notes (JSON) |
| K | Status |
| L | Total Items |
| M | Created At |
| N | Updated At |
| O | Conversation ID |
| P | Reminder Sent |

## Option 3: Run Initialization Script

If you want to force-create it, you can run:

```bash
cd "D:\02 PERSONAL\03 PROJECT\09 DAWET\On Production\server"
node -e "import('./google-sheets.js').then(m => m.initializeWaitingList()).catch(e => console.error(e))"
```

This will create the sheet and add all headers.

## Verify It Works

After creating the sheet, test by sending an order with a future date (e.g., 10/01/2026). The order should:
1. Be saved to WaitingList sheet (not Orders sheet)
2. Customer should receive "PESANAN DITAMBAHKAN KE WAITING LIST" message
3. When the date arrives, reminder will be sent

## Troubleshooting

**Sheet not appearing?**
- Check if sheet name is exactly "WaitingList" (no spaces, case-sensitive)
- Refresh your Google Sheets page
- Check server console for errors
- Make sure service account has Editor permissions

**Orders not going to waiting list?**
- Check if order date is in the future (format: DD/MM/YYYY)
- Check server console logs
- Verify date parsing is working correctly
