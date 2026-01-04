# DAWET Order Management System

Production-ready Telegram bot-based order management system with web dashboard.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express
- **Storage**: Google Sheets API
- **Bot**: Telegram Bot API

## Prerequisites

- Node.js 18+ (or higher)
- npm or yarn
- Google Cloud Service Account (for Sheets API access)
- Telegram Bot Token

## Installation

### 1. Install Dependencies

**Frontend:**
```bash
npm install
```

**Backend:**
```bash
cd server
npm install
```

### 2. Environment Configuration

Create environment files with the following variables:

**Frontend (`.env`):**
```env
VITE_API_URL=http://localhost:3001
```

**Backend (`server/.env`):**
```env
PORT=3001
NODE_ENV=production

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=path/to/service-account-key.json
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id

# Optional: Admin Setup
ADMIN_SETUP_CODE=your_admin_setup_code
ADMIN_TELEGRAM_USER_IDS=comma_separated_user_ids
```

**Important**: Never commit `.env` files. Use `.env.example` as a template.

## Running

### Development Mode

**Frontend:**
```bash
npm run dev
```
Runs on `http://localhost:8080` (or configured port)

**Backend:**
```bash
cd server
npm run dev
```
Runs on `http://localhost:3001` (or configured PORT)

### Production Build

**Frontend:**
```bash
npm run build
```
Output: `dist/` directory

**Backend:**
```bash
cd server
node server.js
```

## Deployment Notes

- Ensure all environment variables are set in production environment
- Google Service Account must have access to the target Spreadsheet
- Telegram webhook URL must be configured if using webhook mode (not polling)
- Frontend build output (`dist/`) should be served by a web server (nginx, Apache, etc.)
- Backend should run as a service (PM2, systemd, etc.)

## Environment Variables Reference

### Frontend
- `VITE_API_URL` - Backend API base URL (required)

### Backend
- `PORT` - Server port (default: 3001)
- `TELEGRAM_BOT_TOKEN` - Telegram bot token (required)
- `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` - Path to Google service account JSON key file (required)
- `GOOGLE_SPREADSHEET_ID` - Google Spreadsheet ID (required)
- `NODE_ENV` - Environment mode (production/development)
- `ADMIN_SETUP_CODE` - Code for initial admin setup (optional)
- `ADMIN_TELEGRAM_USER_IDS` - Comma-separated Telegram user IDs for admin access (optional, legacy)

## License

Private project - All rights reserved
