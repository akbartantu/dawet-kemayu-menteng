/**
 * API Client for DAWET Backend
 */

// Normalize API base URL - remove trailing slash if present
const rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const API_BASE_URL = rawApiUrl.replace(/\/+$/, '');

/**
 * Fetch conversations from backend
 */
export async function getConversations() {
  const response = await fetch(`${API_BASE_URL}/api/conversations`);
  if (!response.ok) {
    throw new Error('Failed to fetch conversations');
  }
  const data = await response.json();
  return data.conversations || [];
}

/**
 * Fetch messages for a specific conversation
 */
export async function getConversationMessages(conversationId: string) {
  const response = await fetch(
    `${API_BASE_URL}/api/conversations/${conversationId}/messages`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch messages');
  }
  const data = await response.json();
  return data.messages || [];
}

/**
 * Send message via Telegram
 */
export async function sendMessage(chatId: string | number, text: string) {
  const response = await fetch(`${API_BASE_URL}/api/messages/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chatId, text }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send message');
  }

  return await response.json();
}

/**
 * Add manual WhatsApp message
 */
export async function addWhatsAppMessage(from: string, text: string) {
  const response = await fetch(`${API_BASE_URL}/api/messages/whatsapp-manual`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, text }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add message');
  }

  return await response.json();
}

/**
 * Get all messages
 */
export async function getAllMessages() {
  const response = await fetch(`${API_BASE_URL}/api/messages`);
  if (!response.ok) {
    throw new Error('Failed to fetch messages');
  }
  const data = await response.json();
  return data.messages || [];
}

/**
 * Get spreadsheet link
 */
export async function getSpreadsheetLink() {
  const response = await fetch(`${API_BASE_URL}/api/spreadsheet`);
  if (!response.ok) {
    return null;
  }
  return await response.json();
}

/**
 * Get all orders with optional filters
 */
export async function getOrders(params?: {
  limit?: number;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}) {
  const queryParams = new URLSearchParams();
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.status) queryParams.append('status', params.status);
  if (params?.search) queryParams.append('search', params.search);
  if (params?.startDate) queryParams.append('startDate', params.startDate);
  if (params?.endDate) queryParams.append('endDate', params.endDate);

  const url = `${API_BASE_URL}/api/orders${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch orders');
  }
  return await response.json();
}

/**
 * Get single order by ID
 */
export async function getOrder(orderId: string) {
  // URL encode the order ID to handle slashes (e.g., DKM/20260103/000003)
  const encodedOrderId = encodeURIComponent(orderId);
  const response = await fetch(`${API_BASE_URL}/api/orders/${encodedOrderId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch order');
  }
  return await response.json();
}

/**
 * Update order status
 */
export async function updateOrderStatus(orderId: string, status: string) {
  // URL encode the order ID to handle slashes (e.g., DKM/20260103/000003)
  const encodedOrderId = encodeURIComponent(orderId);
  const response = await fetch(`${API_BASE_URL}/api/orders/${encodedOrderId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update order status');
  }

  return await response.json();
}
