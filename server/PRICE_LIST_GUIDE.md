# 💰 Price List Management Guide

## Overview

The price list is stored in Google Sheets in a sheet called **"PriceList"**. The system automatically creates this sheet with default prices when you first start the server.

## Price List Format

The PriceList sheet uses a structured schema with multiple columns:

### Current Schema (New Format):
- **Column A**: `item_code` (e.g., "dkm_small", "topping_nangka")
- **Column B**: `item_name` (e.g., "Dawet Kemayu Small", "Topping Nangka")
- **Column C**: `category` (e.g., "minuman", "topping", "snack", "packaging")
- **Column D**: `unit_price` (price as number, e.g., 13000, 15000)
- **Column E**: `unit_type` (e.g., "cup", "botol", "pcs", "box")
- **Column F**: `is_active` (TRUE/FALSE - only TRUE items are loaded)

### Example:
```
item_code          | item_name              | category  | unit_price | unit_type | is_active
dkm_small          | Dawet Kemayu Small     | minuman   | 13000      | cup       | TRUE
dkm_medium         | Dawet Kemayu Medium    | minuman   | 15000      | cup       | TRUE
dkm_large          | Dawet Kemayu Large    | minuman   | 20000      | cup       | TRUE
topping_durian     | Topping Durian         | topping   | 5000       | topping   | TRUE
topping_nangka     | Topping Nangka        | topping   | 3000       | topping   | TRUE
```

### Legacy Format Support:
The system also supports the old 2-column format (A=Item Name, B=Price) for backward compatibility.

## How It Works

### 1. Combined Items (Toppings)

When customers order items with toppings, the system automatically calculates:
- Base item price (e.g., "Dawet Kemayu Medium" = Rp 15,000)
- Topping prices (e.g., "Topping Nangka" = Rp 3,000, "Topping Durian" = Rp 5,000)
- Total per item = Base + All Toppings

**Example:**
- Customer orders: "20 x Dawet Medium + Nangka + Durian"
- Calculation:
  - Base: 20 × Rp 15,000 = Rp 300,000
  - Topping Nangka: 20 × Rp 3,000 = Rp 60,000
  - Topping Durian: 20 × Rp 5,000 = Rp 100,000
  - **Total: Rp 460,000**

### 2. Item Name Normalization

The system automatically normalizes item names:
- "Dawet Medium" → "Dawet Kemayu Medium"
- "Dawet Small" → "Dawet Kemayu Small"
- "Dawet Large" → "Dawet Kemayu Large"
- "+ Nangka" → "Topping Nangka"
- "+ Durian" → "Topping Durian"

### 3. Invoice Generation

When a customer sends an order, they automatically receive:
- ✅ Order confirmation
- 💰 Detailed invoice with:
  - Item breakdown (base + toppings)
  - Quantity and prices
  - **Total payment amount**
  - Payment methods

## Updating Prices

### Method 1: Edit in Google Sheets (Recommended)

1. Open your Google Spreadsheet
2. Go to the **"PriceList"** sheet
3. Edit prices in **Column D** (`unit_price`)
4. Ensure **Column F** (`is_active`) is set to `TRUE` for active items
5. **No server restart needed** - prices are fetched fresh each time

### Method 2: Add New Items

1. Add new row in PriceList sheet
2. **Column A**: `item_code` (e.g., "dkm_small", "topping_nangka")
3. **Column B**: `item_name` (e.g., "Dawet Kemayu Small", "Topping Nangka")
4. **Column C**: `category` (e.g., "minuman", "topping", "snack", "packaging")
5. **Column D**: `unit_price` (number only, no currency symbols)
6. **Column E**: `unit_type` (e.g., "cup", "botol", "pcs", "box")
7. **Column F**: `is_active` (set to `TRUE` for active items)

**Note**: The system uses `item_name` (Column B) as the primary lookup key, but also supports `item_code` (Column A) for flexible matching.
4. System will automatically use new prices

## Current Price List (as of 2026-01-04)

See `docs/CURRENT_PRICELIST.md` for the complete current price list with all details.

### Quick Reference:

| Item | Price (IDR) |
|------|-------------|
| Dawet Kemayu Small | 13,000 |
| Dawet Kemayu Medium | 15,000 |
| Dawet Kemayu Large | 20,000 |
| Topping Durian | 5,000 |
| Topping Nangka | 3,000 |
| Dawet Kemayu Botol 250ml | 20,000 |
| Dawet Kemayu Botol 1L | 80,000 |
| Hampers Packaging | 10,000 |
| Mini Pack | 45,000 |
| Family Pack | 80,000 |
| Extra Family Pack | 90,000 |
| Teh Kemayu | 5,000 |
| Air Mineral | 5,000 |
| Molen Original | 3,000 |
| Molen Keju | 3,000 |
| Molen Coklat | 3,000 |
| Roti Srikaya Original | 5,000 |
| Roti Srikaya Pandan | 5,000 |
| Packaging Styrofoam (50 cup) | 40,000 |

**Note**: Prices are stored in Google Sheets and can be updated there. The system reads prices fresh on each order calculation.

## Troubleshooting

### Prices not updating?
- Make sure you're editing the **"PriceList"** sheet (not "Price List" or "Prices")
- Check that prices are numbers only (no "Rp" or commas)
- Restart server if prices still don't update

### Item not found in price list?
- Check exact spelling in PriceList sheet
- Make sure item name matches exactly (case-sensitive)
- Add the item to PriceList sheet if missing

### Wrong calculation?
- Verify base item price in PriceList
- Verify topping prices in PriceList
- Check item name normalization (system converts "Dawet Medium" to "Dawet Kemayu Medium")

## Example Invoice

When customer orders:
```
20 x Dawet Medium + Nangka
5 x Dawet Medium Original
10 x Dawet Medium + Durian
```

They receive:
```
🧾 INVOICE PEMESANAN

👤 Customer: Iris
📞 Phone: 081288288987
📍 Alamat: Taman kebon jeruk...

📦 DETAIL PESANAN:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Dawet Medium + Nangka
   20x @ Rp 15.000
   + Topping: Topping Nangka (Rp 3.000)
   Subtotal: Rp 360.000

2. Dawet Medium Original
   5x @ Rp 15.000
   Subtotal: Rp 75.000

3. Dawet Medium + Durian
   10x @ Rp 15.000
   + Topping: Topping Durian (Rp 5.000)
   Subtotal: Rp 200.000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 TOTAL PEMBAYARAN:
   Rp 635.000

💳 Metode Pembayaran:
   • QRIS
   • Transfer Bank
   • OVO/DANA/GoPay

✅ Pesanan Anda telah diterima dan sedang diproses.
Terima kasih atas kepercayaan Anda! 🙏
```
