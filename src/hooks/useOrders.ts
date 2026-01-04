/**
 * React Query hooks for orders
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrders, getOrder, updateOrderStatus } from '@/lib/api';
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
 * Update order status mutation
 */
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      updateOrderStatus(orderId, status),
    onSuccess: () => {
      // Refetch orders after status update
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
    },
  });
}
