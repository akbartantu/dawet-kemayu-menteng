/**
 * React Query hook for conversations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getConversations, getConversationMessages, sendMessage } from '@/lib/api';

/**
 * Fetch all conversations
 */
export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: getConversations,
    refetchInterval: 5000, // Refetch every 5 seconds
  });
}

/**
 * Fetch messages for a conversation
 */
export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['conversation-messages', conversationId],
    queryFn: () => conversationId ? getConversationMessages(conversationId) : [],
    enabled: !!conversationId,
    refetchInterval: 3000, // Refetch every 3 seconds
  });
}

/**
 * Send message mutation
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ chatId, text }: { chatId: string | number; text: string }) =>
      sendMessage(chatId, text),
    onSuccess: () => {
      // Refetch conversations and messages after sending
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-messages'] });
    },
    onError: (error) => {
      // Log error for debugging
      console.error('Error sending message:', error);
    },
  });
}
