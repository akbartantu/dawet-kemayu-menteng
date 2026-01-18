/**
 * API Client for DAWET Backend
 * 
 * API Base URL Configuration:
 * - Production: Set VITE_API_URL environment variable (e.g., https://dawet-kemayu-menteng.onrender.com)
 * - Local Dev: Falls back to http://localhost:3001 if VITE_API_URL not set
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

/**
 * Fetch conversations from backend
 */
export async function getConversations() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to fetch conversations');
    }
    const data = await response.json();
    return data.conversations || [];
  } catch (error: any) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Dashboard cannot reach backend API. Please check API URL or backend status.');
    }
    throw error;
  }
}

/**
 * Fetch messages for a specific conversation
 * Returns messages in ascending order (oldest first, newest last) for chat UX
 */
export async function getConversationMessages(conversationId: string) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/conversations/${conversationId}/messages`
    );
    if (!response.ok) {
      throw new Error('Failed to fetch messages');
    }
    const data = await response.json();
    const messages = data.messages || [];
    
    // Sort messages by created_at ascending (oldest first, newest last) for chat UX
    // Backend may return descending, so we ensure ascending order here
    return messages.sort((a: any, b: any) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return timeA - timeB; // Ascending: oldest first
    });
  } catch (error: any) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Dashboard cannot reach backend API. Please check API URL or backend status.');
    }
    throw error;
  }
}

/**
 * Send message via Telegram
 */
export async function sendMessage(chatId: string | number, text: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ chatId, text }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to send message' }));
      throw new Error(error.error || 'Failed to send message');
    }

    return await response.json();
  } catch (error: any) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Dashboard cannot reach backend API. Please check API URL or backend status.');
    }
    throw error;
  }
}

/**
 * Add manual WhatsApp message
 */
export async function addWhatsAppMessage(from: string, text: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/messages/whatsapp-manual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, text }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to add message' }));
      throw new Error(error.error || 'Failed to add message');
    }

    return await response.json();
  } catch (error: any) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Dashboard cannot reach backend API. Please check API URL or backend status.');
    }
    throw error;
  }
}

/**
 * Get all messages
 */
export async function getAllMessages() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/messages`);
    if (!response.ok) {
      throw new Error('Failed to fetch messages');
    }
    const data = await response.json();
    return data.messages || [];
  } catch (error: any) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Dashboard cannot reach backend API. Please check API URL or backend status.');
    }
    throw error;
  }
}

/**
 * Get spreadsheet link
 */
export async function getSpreadsheetLink() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/spreadsheet`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error: any) {
    // Silent fail for spreadsheet link (non-critical)
    return null;
  }
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
  try {
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
  } catch (error: any) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Dashboard cannot reach backend API. Please check API URL or backend status.');
    }
    throw error;
  }
}

/**
 * Get single order by ID
 */
export async function getOrder(orderId: string) {
  try {
    // URL encode the order ID to handle slashes (e.g., DKM/20260103/000003)
    const encodedOrderId = encodeURIComponent(orderId);
    const response = await fetch(`${API_BASE_URL}/api/orders/${encodedOrderId}`);
    if (!response.ok) {
      throw new Error('Failed to fetch order');
    }
    return await response.json();
  } catch (error: any) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Dashboard cannot reach backend API. Please check API URL or backend status.');
    }
    throw error;
  }
}

/**
 * Update order status
 */
export async function updateOrderStatus(orderId: string, status: string) {
  try {
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
      const error = await response.json().catch(() => ({ error: 'Failed to update order status' }));
      throw new Error(error.error || 'Failed to update order status');
    }

    return await response.json();
  } catch (error: any) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Dashboard cannot reach backend API. Please check API URL or backend status.');
    }
    throw error;
  }
}

/**
 * Get orders by event date (for today/tomorrow filtering)
 */
export async function getOrdersByEventDate(eventDate: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/orders?eventDate=${eventDate}`);
    if (!response.ok) {
      throw new Error('Failed to fetch orders by event date');
    }
    return await response.json();
  } catch (error: any) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Dashboard cannot reach backend API. Please check API URL or backend status.');
    }
    throw error;
  }
}
