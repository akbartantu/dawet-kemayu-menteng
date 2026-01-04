# Building DAWET - Step by Step Guide

## 🎯 Current Feature: WhatsApp Business Integration

### ✅ Step 1: Feature Document Created
Location: `Ready to Deploy/docs/sprints/feature-whatsapp-integration.md`

### ✅ Step 2: Backend Server Created
Location: `On Production/server/`

### 📋 Next Steps (In Order):

#### Step 3: Install Backend Dependencies
```bash
cd "On Production/server"
npm install
```

#### Step 4: Set Up Environment Variables
1. Create `On Production/server/.env` file
2. Copy values from `.env.example`
3. Get WhatsApp credentials from Facebook Developer Portal

#### Step 5: Test the Server
```bash
cd "On Production/server"
npm run dev
```

#### Step 6: Connect to Database
- Set up PostgreSQL database
- Create tables from ERD design
- Connect server to database

#### Step 7: Test End-to-End
- Send test message from WhatsApp
- Verify it's stored in database
- Send reply from dashboard
- Verify customer receives it

---

## 🚀 How to Run Everything

### Frontend (React App)
```bash
cd "On Production"
npm run dev
```
Runs on: http://localhost:5173

### Backend (Node.js Server)
```bash
cd "On Production/server"
npm run dev
```
Runs on: http://localhost:3001

---

## 📚 Documentation

- **Master Plan**: `Ready to Deploy/docs/master-plan.md`
- **Feature Document**: `Ready to Deploy/docs/sprints/feature-whatsapp-integration.md`
- **ERD Design**: `Ready to Deploy/docs/erd-design.md`
- **Data Flow**: `Ready to Deploy/docs/data-flow.md`
