/**
 * Shared Constants
 * Centralized constants used across the application
 */

// Google Sheets Sheet Names
export const SHEET_NAMES = {
  ORDERS: 'Orders',
  MESSAGES: 'Messages',
  CONVERSATIONS: 'Conversations',
  USERS: 'Users',
  // WAITING_LIST: 'WaitingList', // DEPRECATED: Replaced by Reminders sheet
  PRICE_LIST: 'PriceList',
  REMINDERS: 'Reminders',
  PAYMENT_HISTORY: 'Payment_History',
};

// Order Status Values
export const ORDER_STATUS = {
  PENDING_CONFIRMATION: 'pending_confirmation',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  CLOSED: 'closed',
  WAITING: 'waiting',
};

// Payment Status Values
export const PAYMENT_STATUS = {
  UNPAID: 'UNPAID',
  DP_PAID: 'DP PAID',
  FULL_PAID: 'FULL PAID',
};

// Reminder Status Values
export const REMINDER_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  SENT_UPPERCASE: 'SENT', // For Reminders sheet
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
};

// Reminder Types
export const REMINDER_TYPES = {
  H_MINUS_4: 'H-4',
  H_MINUS_3: 'H-3',
  H_MINUS_1: 'H-1',
};

// User Roles
export const USER_ROLES = {
  ADMIN: 'admin',
  STAFF: 'staff',
  CUSTOMER: 'customer',
};

// Platforms
export const PLATFORMS = {
  TELEGRAM: 'telegram',
  WHATSAPP: 'whatsapp',
};

// Delivery Methods
export const DELIVERY_METHODS = {
  PICKUP: 'Pickup',
  GRAB_EXPRESS: 'GrabExpress',
  CUSTOM: 'Custom',
  NOT_SELECTED: '-',
};

// Delivery Fee Sources
export const DELIVERY_FEE_SOURCE = {
  USER_INPUT: 'USER_INPUT',
  USER_EMPTY: 'USER_EMPTY',
  NOT_PROVIDED: 'NOT_PROVIDED',
};

// Cache TTL (Time To Live) in milliseconds
export const CACHE_TTL = {
  HEADER_MAP: 10 * 60 * 1000, // 10 minutes
  ADMIN_CHAT_IDS: 10 * 60 * 1000, // 10 minutes
};

// Payment Thresholds
export const PAYMENT_THRESHOLDS = {
  DP_PERCENTAGE: 0.5, // 50% for down payment
  FULL_PERCENTAGE: 1.0, // 100% for full payment
};

// Retry Configuration
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 5,
  BASE_DELAY_MS: 500, // 500ms base delay
  JITTER_MAX_MS: 250, // Random jitter up to 250ms
};
