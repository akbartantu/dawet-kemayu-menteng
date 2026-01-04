# 🔧 Create PriceList Sheet Manually (If Needed)

If the PriceList sheet wasn't created automatically, you can create it manually or run this command:

## Option 1: Restart Server (Recommended)

Just restart your server - it will create the PriceList sheet automatically:

```bash
cd "On Production/server"
npm run dev
```

You should see:
```
🔄 Checking for PriceList sheet...
📝 Creating PriceList sheet...
✅ PriceList sheet created
📝 Adding default prices...
✅ Price list initialized with 19 items
```

## Option 2: Create Manually in Google Sheets

1. Open your Google Spreadsheet
2. Click the "+" button at the bottom to add a new sheet
3. Name it exactly: **PriceList** (case-sensitive)
4. Add these headers in Row 1:
   - Column A: `Pesanan`
   - Column B: `Harga`
5. Add all your prices:

| Pesanan | Harga |
|---------|-------|
| Dawet Kemayu Small | 13000 |
| Dawet Kemayu Medium | 15000 |
| Dawet Kemayu Large | 20000 |
| Topping Durian | 5000 |
| Topping Nangka | 3000 |
| Dawet Kemayu Botol 250ml | 20000 |
| Dawet Kemayu Botol 1L | 80000 |
| Hampers Packaging | 10000 |
| Mini Pack | 45000 |
| Family Pack | 80000 |
| Extra Family Pack | 90000 |
| Teh Kemayu | 5000 |
| Air Mineral | 5000 |
| Molen Original | 3000 |
| Molen Keju | 3000 |
| Molen Coklat | 3000 |
| Roti Srikaya Original | 5000 |
| Roti Srikaya Pandan | 5000 |
| Packaging Styrofoam | 40000 |

**Important**: 
- Sheet name must be exactly **"PriceList"** (no spaces, case-sensitive)
- Prices must be numbers only (no "Rp" or commas)
- Headers must be in Row 1

## Option 3: Run Initialization Script

If you want to force-create it, you can run:

```bash
cd "On Production/server"
node -e "import('./google-sheets.js').then(m => m.initializePriceList()).catch(e => console.error(e))"
```

This will create the sheet and add all default prices.

## Verify It Works

After creating the sheet, test by sending an order to your bot. The bot should:
1. Parse the order
2. Calculate prices using the PriceList
3. Send invoice with total payment

If prices are wrong or missing, check:
- Sheet name is exactly "PriceList"
- Item names match exactly (case-sensitive)
- Prices are numbers only
