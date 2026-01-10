/**
 * React Query hooks for orders
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrders, getOrder, updateOrderStatus, getOrdersByEventDate } from '@/lib/api';

/**
 * Fetch all orders with filters
 */
export function useOrders(params?: {
  limit?: number;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}) {
  return useQuery({
    queryKey: ['orders', params],
    queryFn: () => getOrders(params),
    refetchInterval: 10000, // Refetch every 10 seconds
  });
}

/**
 * Fetch single order
 */
export function useOrder(orderId: string | null) {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => orderId ? getOrder(orderId) : null,
    enabled: !!orderId,
  });
}

/**
 * Fetch orders by event date (for today/tomorrow)
 */
export function useOrdersByEventDate(eventDate: string | null) {
  return useQuery({
    queryKey: ['orders', 'eventDate', eventDate],
    queryFn: () => eventDate ? getOrdersByEventDate(eventDate) : { orders: [], count: 0 },
    enabled: !!eventDate,
    refetchInterval: 10000, // Refetch every 10 seconds
  });
}

/**
 * Update order status mutation with optimistic updates
 */
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      updateOrderStatus(orderId, status),
    onMutate: async ({ orderId, status }) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['orders'] });

      // Snapshot the previous value for rollback
      const previousQueries = queryClient.getQueriesData({ queryKey: ['orders'] });

      // Optimistically update all orders queries
      queryClient.setQueriesData({ queryKey: ['orders'] }, (old: any) => {
        if (!old) return old;
        
        // The API returns { orders: [...] }
        if (!old.orders || !Array.isArray(old.orders)) return old;

        const updatedOrders = old.orders.map((order: any) =>
          order.id === orderId
            ? { ...order, status, updated_at: new Date().toISOString() }
            : order
        );

        return { ...old, orders: updatedOrders };
      });

      // Return context with snapshot for rollback
      return { previousQueries };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSuccess: (data, { orderId }) => {
      // Update cache with server response (more accurate than optimistic update)
      queryClient.setQueriesData({ queryKey: ['orders'] }, (old: any) => {
        if (!old || !old.orders || !Array.isArray(old.orders)) return old;

        const updatedOrders = old.orders.map((order: any) =>
          order.id === orderId ? data.order : order
        );

        return { ...old, orders: updatedOrders };
      });

      // Also update single order query if it exists
      queryClient.setQueryData(['order', orderId], data.order);
    },
    onSettled: () => {
      // Don't invalidate queries - we've already updated the cache
      // This prevents the full reload of all orders
    },
  });
}
