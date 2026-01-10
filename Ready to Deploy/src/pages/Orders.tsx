import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Filter,
  Download,
  Plus,
  MoreHorizontal,
  Eye,
  MessageSquare,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useOrders, useUpdateOrderStatus, useOrder } from "@/hooks/useOrders";
import { formatDistanceToNow } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const statusConfig: Record<string, { label: string; variant: "success" | "info" | "warning" | "destructive" }> = {
  pending: { label: "Pending", variant: "warning" },
  pending_confirmation: { label: "Pending Confirmation", variant: "warning" },
  confirmed: { label: "Confirmed", variant: "info" },
  processing: { label: "Processing", variant: "info" },
  ready: { label: "Ready", variant: "info" },
  delivering: { label: "Delivering", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  waiting: { label: "Waiting", variant: "warning" },
};

/**
 * Valid status transitions - matches backend rules
 */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  'pending': ['pending_confirmation', 'cancelled'],
  'pending_confirmation': ['confirmed', 'cancelled'],
  'confirmed': ['processing', 'cancelled'],
  'processing': ['ready', 'cancelled'],
  'ready': ['delivering', 'cancelled'],
  'delivering': ['completed', 'cancelled'],
  'completed': [], // Terminal state
  'cancelled': [], // Terminal state
  'waiting': ['pending_confirmation', 'cancelled'],
};

/**
 * Action button labels for status transitions
 * Note: 'completed' is not included as it's customer action
 */
const STATUS_ACTION_LABELS: Record<string, string> = {
  'pending_confirmation': 'Request Confirmation',
  'confirmed': 'Confirm Order',
  'processing': 'Start Processing',
  'ready': 'Mark Ready',
  'delivering': 'Start Delivery',
  'cancelled': 'Cancel Order',
};

export default function Orders() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  // Per-order, per-action loading state - tracks which action is being performed for each order
  // Format: { orderId: 'start_delivery' | 'cancel' | 'start_processing' | 'mark_ready' | null }
  const [loadingActionByOrderId, setLoadingActionByOrderId] = useState<Record<string, string | null>>({});

  // Fetch orders with filters
  const { data, isLoading, error } = useOrders({
    limit: 100,
    status: statusFilter !== "all" ? statusFilter : undefined,
    search: searchQuery || undefined,
  });

  const orders = data?.orders || [];
  const updateStatusMutation = useUpdateOrderStatus();
  
  // Fetch full order details when modal is open (includes all pricing/payment fields)
  const { data: orderDetailData } = useOrder(selectedOrderId);
  
  // Get selected order for detail view
  // Prefer detailed order data from API, fallback to list order
  const selectedOrder = selectedOrderId 
    ? (orderDetailData?.order || orders.find((o: any) => o.id === selectedOrderId))
    : null;

  // Format order items for display
  const formatOrderItems = (items: any[]) => {
    if (!items || items.length === 0) return "No items";
    return items.map(item => `${item.quantity}x ${item.name}`).join(", ");
  };

  // Calculate total cups from items (for packaging calculation)
  const calculateTotalCups = (items: any[]): number => {
    if (!items || items.length === 0) return 0;
    let totalCups = 0;
    items.forEach(item => {
      const itemName = (item.name || '').toLowerCase();
      // Check if item is a cup-based product (Dawet Small/Medium/Large)
      if (itemName.includes('dawet') && 
          (itemName.includes('small') || itemName.includes('medium') || itemName.includes('large'))) {
        // Exclude botol items (they're not cups)
        if (!itemName.includes('botol')) {
          totalCups += parseInt(item.quantity || 0);
        }
      }
    });
    return totalCups;
  };

  // Check if packaging is requested (from notes)
  const hasPackagingRequest = (notes: string[]): boolean => {
    if (!notes || notes.length === 0) return false;
    return notes.some(note => {
      const noteLower = note.toLowerCase().trim();
      return noteLower.includes('packaging styrofoam') && 
             (noteLower.includes(': ya') || noteLower.includes(': yes') || 
              noteLower === 'packaging styrofoam: ya' || noteLower === 'packaging styrofoam: yes');
    });
  };

  // Calculate total from items (if not provided)
  const calculateTotal = (order: any) => {
    // For now, we'll show total_items count
    // In future, we can calculate from price list
    return order.total_items || 0;
  };

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch {
      return dateString;
    }
  };

  // Format Indonesian Rupiah
  const formatIDR = (amount: number | null | undefined): string => {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return 'Rp 0';
    }
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Get action name from status transition
  const getActionName = (newStatus: string): string => {
    const actionMap: Record<string, string> = {
      'pending_confirmation': 'request_confirmation',
      'confirmed': 'confirm_order',
      'processing': 'start_processing',
      'ready': 'mark_ready',
      'delivering': 'start_delivery',
      'cancelled': 'cancel',
    };
    return actionMap[newStatus] || newStatus;
  };

  // Handle status update with action-specific loading state
  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    const actionName = getActionName(newStatus);
    
    // Set loading state for this specific order and action immediately
    // This ensures the spinner shows right away
    setLoadingActionByOrderId(prev => ({ ...prev, [orderId]: actionName }));
    
    try {
      await updateStatusMutation.mutateAsync({ orderId, status: newStatus });
    } catch (error: any) {
      console.error("Error updating status:", error);
      // Show user-friendly error message
      const errorMessage = error?.response?.data?.error || error?.message || "Failed to update order status";
      alert(errorMessage);
    } finally {
      // Clear loading state for this specific order
      setLoadingActionByOrderId(prev => {
        const updated = { ...prev };
        delete updated[orderId];
        return updated;
      });
    }
  };

  // Get valid next statuses for an order
  const getValidNextStatuses = (currentStatus: string): string[] => {
    return STATUS_TRANSITIONS[currentStatus] || [];
  };

  return (
    <DashboardLayout
      title="Orders"
      subtitle="Manage and track all your customer orders"
    >
      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between mb-6">
        <div className="flex gap-3">
          <div className="relative flex-1 sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="pending_confirmation">Pending Confirmation</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="delivering">Delivering</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="waiting">Waiting</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-3">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button variant="whatsapp">
            <Plus className="h-4 w-4 mr-2" />
            New Order
          </Button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <Alert className="m-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load orders. Make sure the server is running.
            </AlertDescription>
          </Alert>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <p>No orders found</p>
            <p className="text-sm mt-2">
              {searchQuery || statusFilter !== "all" 
                ? "Try adjusting your filters" 
                : "Orders will appear here when customers place orders"}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Order ID
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Customer
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Items
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Total Items
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Date
                    </th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order: any) => {
                    const status = statusConfig[order.status] || { label: order.status, variant: "info" as const };

                    return (
                      <tr
                        key={order.id}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-lg bg-whatsapp-light flex items-center justify-center">
                              <MessageSquare className="h-4 w-4 text-whatsapp-dark" />
                            </div>
                            <span className="font-medium text-foreground font-mono text-sm">
                              {order.id}
                            </span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div>
                            <p className="font-medium text-foreground">
                              {order.customer_name || "Unknown"}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {order.phone_number || "N/A"}
                            </p>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="max-w-[250px]">
                            <p className="text-sm text-foreground line-clamp-2">
                              {formatOrderItems(order.items || [])}
                            </p>
                            {order.notes && order.notes.length > 0 && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Notes: {order.notes.length} item(s)
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="font-semibold text-foreground">
                            {order.total_items || 0} item(s)
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Badge variant={status.variant} className="font-medium">
                              {status.label}
                            </Badge>
                            {order.status === 'delivering' && (
                              <span className="text-xs text-muted-foreground italic">
                                Waiting for customer confirmation
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="text-sm text-muted-foreground">
                            {formatDate(order.created_at)}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button 
                              variant="ghost" 
                              size="icon-sm"
                              onClick={() => setSelectedOrderId(order.id)}
                              title="View order details"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <div className="flex items-center gap-1">
                              {(() => {
                                const validNextStatuses = getValidNextStatuses(order.status);
                                
                                // If no valid transitions (terminal state), show current status only
                                if (validNextStatuses.length === 0) {
                                  return (
                                    <span className="text-xs text-muted-foreground italic">
                                      {statusConfig[order.status]?.label || order.status}
                                    </span>
                                  );
                                }
                                
                                // Show action buttons for valid next statuses
                                const rowBusy = loadingActionByOrderId[order.id] != null;
                                
                                return validNextStatuses.map((nextStatus) => {
                                  const isCancelled = nextStatus === 'cancelled';
                                  const actionLabel = STATUS_ACTION_LABELS[nextStatus] || 
                                    statusConfig[nextStatus]?.label || nextStatus;
                                  
                                  // Get action name for this button
                                  const actionName = getActionName(nextStatus);
                                  
                                  // Only show spinner if THIS specific action is loading
                                  const isThisActionLoading = loadingActionByOrderId[order.id] === actionName;
                                  
                                  // Disable button if ANY action is running for this row
                                  const isDisabled = rowBusy;
                                  
                                  return (
                                    <Button
                                      key={nextStatus}
                                      variant={isCancelled ? "destructive" : "default"}
                                      size="sm"
                                      onClick={() => {
                                        if (confirm(`Are you sure you want to ${actionLabel.toLowerCase()}?`)) {
                                          handleStatusUpdate(order.id, nextStatus);
                                        }
                                      }}
                                      disabled={isDisabled}
                                      className="h-8 text-xs whitespace-nowrap"
                                    >
                                      {isThisActionLoading && (
                                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                      )}
                                      {actionLabel}
                                    </Button>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between p-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Showing {orders.length} order(s)
              </p>
            </div>
          </>
        )}
      </div>

      {/* Order Detail Dialog */}
      {selectedOrder && (
        <Dialog open={!!selectedOrderId} onOpenChange={(open) => !open && setSelectedOrderId(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Order Details: {selectedOrder.id}</DialogTitle>
              <DialogDescription>
                View complete order information
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Customer</p>
                  <p className="text-foreground">{selectedOrder.customer_name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Phone</p>
                  <p className="text-foreground">{selectedOrder.phone_number}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-sm font-medium text-muted-foreground">Address</p>
                  <p className="text-foreground">{selectedOrder.address}</p>
                </div>
                {selectedOrder.event_date && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Event Date</p>
                    <p className="text-foreground">{selectedOrder.event_date}</p>
                  </div>
                )}
                {selectedOrder.delivery_time && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Delivery Time</p>
                    <p className="text-foreground">{selectedOrder.delivery_time}</p>
                  </div>
                )}
                {selectedOrder.delivery_method && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Delivery Method</p>
                    <p className="text-foreground">{selectedOrder.delivery_method}</p>
                  </div>
                )}
              </div>
              
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Items</p>
                <div className="space-y-2">
                  {(() => {
                    const items = selectedOrder.items || [];
                    const notes = selectedOrder.notes || [];
                    const totalCups = calculateTotalCups(items);
                    const packagingRequested = hasPackagingRequest(notes);
                    const requiredPackagingBoxes = totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
                    let packagingShown = false;

                    return (
                      <>
                        {/* Display regular items (excluding packaging items) */}
                        {items.map((item: any, index: number) => {
                          const itemName = (item.name || '').toLowerCase();
                          // Skip packaging items (they'll be replaced with calculated quantity)
                          if (itemName.includes('packaging') || itemName.includes('styrofoam')) {
                            // If packaging is requested, show calculated quantity once
                            if (packagingRequested && requiredPackagingBoxes > 0 && !packagingShown) {
                              packagingShown = true;
                              return (
                                <div key={`packaging-${index}`} className="flex justify-between p-2 bg-muted rounded">
                                  <span>{requiredPackagingBoxes}x Packaging Styrofoam (50 cup)</span>
                                </div>
                              );
                            }
                            // Skip original packaging item
                            return null;
                          }
                          // Display other items normally
                          return (
                            <div key={index} className="flex justify-between p-2 bg-muted rounded">
                              <span>{item.quantity}x {item.name}</span>
                            </div>
                          );
                        })}
                        {/* If packaging requested but not found in items, add it */}
                        {packagingRequested && requiredPackagingBoxes > 0 && !packagingShown && (
                          <div className="flex justify-between p-2 bg-muted rounded">
                            <span>{requiredPackagingBoxes}x Packaging Styrofoam (50 cup)</span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Notes section - filter out Packaging Styrofoam notes */}
              {(() => {
                const filteredNotes = (selectedOrder.notes || []).filter((note: string) => {
                  const noteLower = note.toLowerCase().trim();
                  // Filter out packaging-related notes
                  return !(noteLower.includes('packaging styrofoam') && 
                          (noteLower.includes(': ya') || noteLower.includes(': yes') || 
                           noteLower === 'packaging styrofoam: ya' || noteLower === 'packaging styrofoam: yes'));
                });
                return filteredNotes.length > 0 ? (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Notes</p>
                    <div className="space-y-1">
                      {filteredNotes.map((note: string, index: number) => (
                        <p key={index} className="text-sm text-foreground">• {note}</p>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              {/* Price Breakdown Section - Always show if order has pricing data */}
              {(selectedOrder && (selectedOrder.total_amount !== undefined || selectedOrder.product_total !== undefined || selectedOrder.packaging_fee !== undefined || selectedOrder.delivery_fee !== undefined)) && (
                <div className="pt-4 border-t">
                  <p className="text-sm font-medium text-muted-foreground mb-3">Price Breakdown</p>
                  <div className="space-y-2 bg-muted/50 p-3 rounded-lg">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Product Total</span>
                      <span className="text-foreground font-medium">
                        {(selectedOrder.product_total !== undefined && selectedOrder.product_total !== null) 
                          ? formatIDR(selectedOrder.product_total) 
                          : '-'}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Packaging Fee</span>
                      <span className="text-foreground font-medium">
                        {(selectedOrder.packaging_fee !== undefined && selectedOrder.packaging_fee !== null)
                          ? formatIDR(selectedOrder.packaging_fee)
                          : '-'}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Delivery Fee</span>
                      <span className="text-foreground font-medium">
                        {(selectedOrder.delivery_fee !== undefined && selectedOrder.delivery_fee !== null)
                          ? formatIDR(selectedOrder.delivery_fee)
                          : '-'}
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-border font-semibold">
                      <span className="text-foreground">Total Amount</span>
                      <span className="text-foreground">
                        {(selectedOrder.total_amount !== undefined && selectedOrder.total_amount !== null && selectedOrder.total_amount > 0)
                          ? formatIDR(selectedOrder.total_amount)
                          : '-'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Payment Info Section - Always show if order exists */}
              {(selectedOrder && (selectedOrder.total_amount !== undefined || selectedOrder.paid_amount !== undefined || selectedOrder.payment_status !== undefined)) && (
                <div className="pt-4 border-t">
                  <p className="text-sm font-medium text-muted-foreground mb-3">Payment Info</p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Payment Status</span>
                      <Badge 
                        variant={
                          selectedOrder.payment_status === 'PAID' || selectedOrder.payment_status === 'FULL PAID' 
                            ? 'success'
                            : selectedOrder.payment_status === 'DP PAID'
                            ? 'info'
                            : 'warning'
                        }
                      >
                        {selectedOrder.payment_status || 'UNPAID'}
                      </Badge>
                    </div>
                    <div className="space-y-2 bg-muted/50 p-3 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Paid Amount</span>
                        <span className="text-foreground font-medium">
                          {formatIDR(selectedOrder.paid_amount ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Remaining Balance</span>
                        <span className="text-foreground font-medium">
                          {formatIDR(selectedOrder.remaining_balance ?? 0)}
                        </span>
                      </div>
                      {(selectedOrder.dp_min_amount !== undefined && selectedOrder.dp_min_amount > 0) && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">DP Min Amount</span>
                          <span className="text-foreground font-medium">
                            {formatIDR(selectedOrder.dp_min_amount)}
                          </span>
                        </div>
                      )}
                      {(selectedOrder.total_amount !== undefined && selectedOrder.total_amount > 0) && (
                        <div className="pt-2 border-t border-border">
                          <p className="text-xs text-muted-foreground">
                            Paid: {formatIDR(selectedOrder.paid_amount ?? 0)} of {formatIDR(selectedOrder.total_amount)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                  <Badge variant={statusConfig[selectedOrder.status]?.variant || "info"}>
                    {statusConfig[selectedOrder.status]?.label || selectedOrder.status}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-muted-foreground">Total Items</p>
                  <p className="text-lg font-semibold">{selectedOrder.total_items || 0} item(s)</p>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </DashboardLayout>
  );
}
