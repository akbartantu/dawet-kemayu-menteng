/**
 * Spreadsheet-based Storage
 * Uses JSON file that can be opened in Excel/Google Sheets
 * Simple, no database setup needed!
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Storage file path
const STORAGE_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(STORAGE_DIR, 'messages.json');
const CONVERSATIONS_FILE = path.join(STORAGE_DIR, 'conversations.json');

/**
 * Ensure storage directory exists
 */
async function ensureStorageDir() {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  } catch (error) {
    // Directory already exists, that's fine
  }
}

/**
 * Read JSON file (returns empty array if file doesn't exist)
 */
async function readFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // File doesn't exist, return empty array
    return [];
  }
}

/**
 * Write JSON file
 */
async function writeFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Initialize storage (create files if they don't exist)
 */
export async function initializeStorage() {
  await ensureStorageDir();
  
  // Initialize messages file
  const messages = await readFile(MESSAGES_FILE);
  if (messages.length === 0) {
    await writeFile(MESSAGES_FILE, []);
  }

  // Initialize conversations file
  const conversations = await readFile(CONVERSATIONS_FILE);
  if (conversations.length === 0) {
    await writeFile(CONVERSATIONS_FILE, []);
  }

}

/**
 * Save message to storage
 */
export async function saveMessage(messageData) {
  await ensureStorageDir();
  
  const messages = await readFile(MESSAGES_FILE);
  
  // Check if message already exists (prevent duplicates)
  const exists = messages.find(m => m.id === messageData.id);
  if (exists) {
    return exists;
  }

  // Add timestamp if not provided
  if (!messageData.created_at) {
    messageData.created_at = new Date().toISOString();
  }

  // Add message
  messages.push(messageData);

  // Save to file
  await writeFile(MESSAGES_FILE, messages);
  
  return messageData;
}

/**
 * Get or create conversation
 */
export async function getOrCreateConversation(telegramChatId, fromName, fromId) {
  await ensureStorageDir();
  
  const conversations = await readFile(CONVERSATIONS_FILE);

  // Try to find existing conversation
  let conversation = conversations.find(c => c.telegram_chat_id === telegramChatId);

  if (conversation) {
    // Update last message time
    conversation.last_message_at = new Date().toISOString();
    conversation.updated_at = new Date().toISOString();
    await writeFile(CONVERSATIONS_FILE, conversations);
    return conversation;
  }

  // Create new conversation
  conversation = {
    id: `conv_telegram_${telegramChatId}_${Date.now()}`,
    telegram_chat_id: telegramChatId,
    customer_id: `telegram_${fromId}`,
    customer_name: fromName,
    status: 'active',
    last_message_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  conversations.push(conversation);
  await writeFile(CONVERSATIONS_FILE, conversations);

  return conversation;
}

/**
 * Get all messages
 */
export async function getAllMessages(limit = 100) {
  const messages = await readFile(MESSAGES_FILE);
  
  // Sort by created_at descending, limit results
  return messages
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

/**
 * Get messages by conversation
 */
export async function getMessagesByConversation(conversationId, limit = 50) {
  const messages = await readFile(MESSAGES_FILE);
  
  return messages
    .filter(m => m.conversation_id === conversationId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(0, limit);
}

/**
 * Get all conversations
 */
export async function getAllConversations(limit = 50) {
  const conversations = await readFile(CONVERSATIONS_FILE);
  
  // Get message count and last message for each conversation
  const messages = await readFile(MESSAGES_FILE);
  
  const conversationsWithStats = conversations.map(conv => {
    const convMessages = messages.filter(m => m.conversation_id === conv.id);
    const lastMessage = convMessages
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    
    return {
      ...conv,
      message_count: convMessages.length,
      last_message: lastMessage?.text || null,
    };
  });

  return conversationsWithStats
    .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
    .slice(0, limit);
}

/**
 * Export to CSV (for Excel/Google Sheets)
 */
export async function exportToCSV() {
  const messages = await readFile(MESSAGES_FILE);
  const conversations = await readFile(CONVERSATIONS_FILE);

  // Convert messages to CSV
  const messagesCSV = [
    // Header
    ['ID', 'Conversation ID', 'From', 'From Name', 'Text', 'Source', 'Direction', 'Status', 'Created At'].join(','),
    // Data
    ...messages.map(m => [
      m.id,
      m.conversation_id || '',
      m.from || '',
      m.from_name || '',
      `"${(m.text || '').replace(/"/g, '""')}"`, // Escape quotes in CSV
      m.source || '',
      m.direction || '',
      m.status || '',
      m.created_at || '',
    ].join(','))
  ].join('\n');

  // Convert conversations to CSV
  const conversationsCSV = [
    // Header
    ['ID', 'Telegram Chat ID', 'Customer ID', 'Customer Name', 'Status', 'Last Message At', 'Created At'].join(','),
    // Data
    ...conversations.map(c => [
      c.id,
      c.telegram_chat_id || '',
      c.customer_id || '',
      c.customer_name || '',
      c.status || '',
      c.last_message_at || '',
      c.created_at || '',
    ].join(','))
  ].join('\n');

  return {
    messages: messagesCSV,
    conversations: conversationsCSV,
  };
}
