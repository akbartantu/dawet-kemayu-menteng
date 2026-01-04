# 📊 Google Sheets Column Structure

**Last Updated**: 2026-01-03

This document lists all column names for each sheet in the Google Spreadsheet.

---

## 1. Messages Sheet

**Sheet Name**: `Messages`  
**Range**: `A1:J1` (10 columns)

| Column | Header | Description |
|--------|--------|-------------|
| A | ID | Unique message ID (e.g., `telegram_123` or `whatsapp_manual_1234567890`) |
| B | Conversation ID | Links message to a conversation |
| C | Telegram Chat ID | Telegram chat ID (for Telegram messages) |
| D | From | Sender ID (Telegram user ID or phone number) |
| E | From Name | Sender's display name |
| F | Text | Message content |
| G | Source | Message source: `telegram` or `whatsapp_manual` |
| H | Direction | Message direction: `inbound` (from customer) or `outbound` (to customer) |
| I | Status | Message status: `sent`, `delivered`, `read`, `failed` |
| J | Created At | ISO timestamp when message was created |

---

## 2. Conversations Sheet

**Sheet Name**: `Conversations`  
**Range**: `A1:G1` (7 columns)

| Column | Header | Description |
|--------|--------|-------------|
| A | ID | Unique conversation ID |
| B | Telegram Chat ID | Telegram chat ID |
| C | Customer ID | Customer identifier (Telegram user ID) |
| D | Customer Name | Customer's display name |
| E | Status | Conversation status: `active`, `waiting`, `resolved`, `closed` |
| F | Last Message At | ISO timestamp of last message in conversation |
| G | Created At | ISO timestamp when conversation was created |

---

## 3. Orders Sheet

**Sheet Name**: `Orders`  
**Range**: `A1:O1` (15 columns)

| Column | Header | Description |
|--------|--------|-------------|
| A | Order ID | Unique order ID (format: `DKM/YYYYMMDD/000001`) |
| B | Customer Name | Customer's name |
| C | Phone Number | Customer's phone number |
| D | Address | Delivery address |
| E | Event Name | Event name (if order is for an event) |
| F | Event Duration | Event duration (if applicable) |
| G | Event Date | Delivery/event date (format: `DD/MM/YYYY`) |
| H | Delivery Time | Delivery time (e.g., `14.00`) |
| I | Items (JSON) | Order items as JSON array: `[{"quantity": 20, "name": "Dawet Medium + Nangka"}, ...]` |
| J | Notes (JSON) | Additional notes as JSON array: `["Es batu dikit", "Gula 1.5 sendok"]` |
| K | Status | Order status: `pending_confirmation`, `confirmed`, `processing`, `ready`, `delivering`, `completed`, `cancelled` |
| L | Total Items | Total quantity of items |
| M | Created At | ISO timestamp when order was created |
| N | Updated At | ISO timestamp when order was last updated |
| O | Conversation ID | Links order to a conversation |

---

## 4. PriceList Sheet

**Sheet Name**: `PriceList`  
**Range**: `A1:B1` (2 columns)

| Column | Header | Description |
|--------|--------|-------------|
| A | Item Name | Name of the menu item (e.g., `Dawet Kemayu Small`, `Topping Durian`) |
| B | Price | Price in Rupiah (number, e.g., `13000` for Rp 13.000) |

**Example Data**:
```
Item Name                    | Price
----------------------------|-------
Dawet Kemayu Small         | 13000
Dawet Kemayu Medium        | 15000
Dawet Kemayu Large         | 20000
Topping Durian             | 5000
Topping Nangka             | 3000
Packaging Styrofoam        | 40000
```

---

## 5. WaitingList Sheet

**Sheet Name**: `WaitingList`  
**Range**: `A1:P1` (16 columns)

| Column | Header | Description |
|--------|--------|-------------|
| A | Order ID | Unique order ID (format: `DKM/YYYYMMDD/000001`) |
| B | Customer Name | Customer's name |
| C | Phone Number | Customer's phone number |
| D | Address | Delivery address |
| E | Event Name | Event name (if order is for an event) |
| F | Event Duration | Event duration (if applicable) |
| G | Event Date | Delivery/event date (format: `DD/MM/YYYY`) |
| H | Delivery Time | Delivery time (e.g., `14.00`) |
| I | Items (JSON) | Order items as JSON array |
| J | Notes (JSON) | Additional notes as JSON array |
| K | Status | Order status: `waiting`, `confirmed`, `cancelled`, etc. |
| L | Total Items | Total quantity of items |
| M | Created At | ISO timestamp when order was created |
| N | Updated At | ISO timestamp when order was last updated |
| O | Conversation ID | Links order to a conversation |
| P | Reminder Sent | Boolean: `true` or `false` (whether reminder was sent when order date arrived) |

---

## 📝 Notes

1. **JSON Columns**: 
   - `Items (JSON)` and `Notes (JSON)` store data as JSON strings
   - Example Items: `[{"quantity": 20, "name": "Dawet Medium + Nangka"}]`
   - Example Notes: `["Es batu dikit", "Gula 1.5 sendok"]`

2. **Date Formats**:
   - `Event Date`: `DD/MM/YYYY` (e.g., `10/01/2026`)
   - `Created At`, `Updated At`, `Last Message At`: ISO 8601 format (e.g., `2026-01-03T10:30:00.000Z`)

3. **Order ID Format**:
   - Format: `DKM/YYYYMMDD/000001`
   - Example: `DKM/20260103/000001`
   - Daily incrementing number (resets each day)

4. **Automatic Creation**:
   - All sheets are automatically created with headers when the server starts
   - You don't need to manually create them

---

## 🔍 How to View Data

1. Open your Google Spreadsheet
2. Each sheet tab is at the bottom
3. Column headers are in Row 1
4. Data starts from Row 2

---

## ⚠️ Important

- **Don't delete or modify column headers** (Row 1)
- **Don't change column order** - the code expects columns in this exact order
- **JSON columns** must contain valid JSON - don't edit manually unless you know JSON format
- **Order ID** is auto-generated - don't edit manually
