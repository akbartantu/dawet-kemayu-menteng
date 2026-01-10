import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import { ConversationsList } from "@/components/dashboard/ConversationsList";
import { SalesChart } from "@/components/dashboard/SalesChart";
import {
  ShoppingCart,
  MessageSquare,
  DollarSign,
  Users,
  TrendingUp,
  Package,
  Calendar,
  CalendarDays,
} from "lucide-react";
import { useOrders, useOrdersByEventDate } from "@/hooks/useOrders";
import { useQuery } from "@tanstack/react-query";
import { getConversations } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";

// Helper function to get today's date in YYYY-MM-DD format (Jakarta timezone)
function getTodayDate(): string {
  const now = new Date();
  const jakartaDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  const year = jakartaDate.getFullYear();
  const month = String(jakartaDate.getMonth() + 1).padStart(2, "0");
  const day = String(jakartaDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Helper function to get tomorrow's date in YYYY-MM-DD format (Jakarta timezone)
function getTomorrowDate(): string {
  const today = getTodayDate();
  const [year, month, day] = today.split("-").map(Number);
  const tomorrow = new Date(year, month - 1, day + 1);
  const tomorrowYear = tomorrow.getFullYear();
  const tomorrowMonth = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const tomorrowDay = String(tomorrow.getDate()).padStart(2, "0");
  return `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay}`;
}

// Format Indonesian Rupiah
function formatIDR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return 'Rp 0';
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Helper function to get order items (handles both parsed array and JSON string)
function getOrderItems(order: any): any[] {
  if (!order) return [];
  
  // Try items array first
  if (Array.isArray(order.items)) {
    return order.items;
  }
  
  // Try items_json string
  if (order.items_json) {
    try {
      const parsed = typeof order.items_json === 'string' 
        ? JSON.parse(order.items_json) 
        : order.items_json;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  
  return [];
}

// Helper function to calculate total cups and packaging boxes
function calculatePackagingInfo(items: any[], notes: string[]): { totalCups: number; packagingBoxes: number } {
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
  
  // Check if packaging is requested in notes
  const hasPackagingRequest = notes.some(note => {
    const noteLower = String(note || '').toLowerCase().trim();
    return noteLower.includes('packaging styrofoam') && 
           (noteLower.includes(': ya') || noteLower.includes(': yes') || 
            noteLower === 'packaging styrofoam: ya' || noteLower === 'packaging styrofoam: yes');
  });
  
  const packagingBoxes = hasPackagingRequest && totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
  
  return { totalCups, packagingBoxes };
}

// Helper function to get order notes (handles both parsed array and JSON string)
function getOrderNotes(order: any): string[] {
  if (!order) return [];
  
  // Try notes array first
  if (Array.isArray(order.notes)) {
    return order.notes;
  }
  
  // Try notes_json string
  if (order.notes_json) {
    try {
      const parsed = typeof order.notes_json === 'string' 
        ? JSON.parse(order.notes_json) 
        : order.notes_json;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  
  return [];
}

// Helper function to format order items for display (including packaging)
function formatOrderItemsForDisplay(order: any): any[] {
  const items = getOrderItems(order);
  const notes = getOrderNotes(order);
  
  const { packagingBoxes } = calculatePackagingInfo(items, notes);
  
  // Filter out packaging items from items list (we'll add calculated one)
  const filteredItems = items.filter((item: any) => {
    const itemName = (item.name || '').toLowerCase();
    return !(itemName.includes('packaging') || itemName.includes('styrofoam'));
  });
  
  // Add packaging if requested
  if (packagingBoxes > 0) {
    filteredItems.push({
      quantity: packagingBoxes,
      name: 'Packaging Styrofoam (50 cup)'
    });
  }
  
  return filteredItems;
}

export default function Dashboard() {
  const todayDate = getTodayDate();
  const tomorrowDate = getTomorrowDate();

  // Fetch all orders for statistics
  const { data: allOrdersData, isLoading: ordersLoading } = useOrders({ limit: 1000 });
  const orders = allOrdersData?.orders || [];

  // Fetch orders for today
  const { data: todayOrdersData, isLoading: todayLoading } = useOrdersByEventDate(todayDate);
  const todayOrders = todayOrdersData?.orders || [];

  // Fetch orders for tomorrow
  const { data: tomorrowOrdersData, isLoading: tomorrowLoading } = useOrdersByEventDate(tomorrowDate);
  const tomorrowOrders = tomorrowOrdersData?.orders || [];

  // Fetch conversations for active chats
  const { data: conversations, isLoading: conversationsLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: getConversations,
    refetchInterval: 10000,
  });

  // Calculate statistics
  const totalOrders = orders.length;
  const activeChats = conversations?.length || 0;
  
  // Calculate today's revenue (from orders created today, not event_date)
  const todayRevenue = orders
    .filter(order => {
      if (!order.created_at) return false;
      const orderDate = new Date(order.created_at);
      const today = new Date();
      return orderDate.toDateString() === today.toDateString();
    })
    .reduce((sum, order) => sum + (order.total_amount || order.final_total || 0), 0);

  // Calculate total revenue
  const totalRevenue = orders.reduce((sum, order) => sum + (order.total_amount || order.final_total || 0), 0);

  // Count unique customers
  const uniqueCustomers = new Set(orders.map(order => order.phone_number).filter(Boolean)).size;

  // Count orders by status
  const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'pending_confirmation').length;
  const processingOrders = orders.filter(o => o.status === 'processing' || o.status === 'ready').length;

  // Filter today's orders by payment status (FULLPAID only for preparation)
  const todayOrdersToPrepare = todayOrders.filter(order => 
    order.payment_status === 'FULLPAID' || order.payment_status === 'FULL PAID' || order.payment_status === 'PAID'
  );

  // Filter tomorrow's orders by payment status (FULLPAID only for preparation)
  const tomorrowOrdersToPrepare = tomorrowOrders.filter(order => 
    order.payment_status === 'FULLPAID' || order.payment_status === 'FULL PAID' || order.payment_status === 'PAID'
  );

  return (
    <DashboardLayout
      title="Dashboard"
      subtitle="Welcome back! Here's what's happening with your business."
    >
      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard
          title="Today's Revenue"
          value={formatIDR(todayRevenue)}
          icon={<DollarSign className="h-5 w-5" />}
          variant="accent"
        />
        <StatCard
          title="Total Orders"
          value={totalOrders || 0}
          icon={<ShoppingCart className="h-5 w-5" />}
        />
        <StatCard
          title="Active Chats"
          value={activeChats || 0}
          icon={<MessageSquare className="h-5 w-5" />}
        />
        <StatCard
          title="Total Customers"
          value={uniqueCustomers || 0}
          icon={<Users className="h-5 w-5" />}
        />
      </div>

      {/* Orders Today & Tomorrow */}
      <div className="grid gap-6 md:grid-cols-2 mb-6">
        {/* Orders Today */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2.5 bg-accent/10 text-accent">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Orders Today</h3>
                <p className="text-sm text-muted-foreground">Orders to prepare for today ({todayDate})</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-foreground">
                {todayLoading ? '...' : (todayOrdersToPrepare.length || 0)}
              </p>
              <p className="text-xs text-muted-foreground">FULLPAID orders</p>
            </div>
          </div>
          <div className="p-6">
            {todayLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : todayOrdersToPrepare.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders to prepare for today</p>
            ) : (
              <div className="space-y-3">
                {todayOrdersToPrepare.slice(0, 5).map((order: any) => (
                  <div key={order.id} className="p-3 bg-muted/50 rounded-lg border border-border">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{order.customer_name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground font-mono">{order.id}</p>
                      </div>
                      <div className="text-right ml-4">
                        <p className="text-sm font-medium text-foreground">{formatIDR(order.total_amount || order.final_total || 0)}</p>
                        {order.delivery_time && (
                          <p className="text-xs text-muted-foreground">{order.delivery_time}</p>
                        )}
                      </div>
                    </div>
                    {/* Order Items */}
                    {(() => {
                      const displayItems = formatOrderItemsForDisplay(order);
                      return displayItems.length > 0 ? (
                        <div className="mt-2 pt-2 border-t border-border">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Items:</p>
                          <div className="space-y-1">
                            {displayItems.slice(0, 3).map((item: any, idx: number) => (
                              <p key={idx} className="text-xs text-foreground">
                                • {item.quantity}x {item.name}
                              </p>
                            ))}
                            {displayItems.length > 3 && (
                              <p className="text-xs text-muted-foreground">
                                +{displayItems.length - 3} more item(s)
                              </p>
                            )}
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                ))}
                {todayOrdersToPrepare.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    +{todayOrdersToPrepare.length - 5} more orders
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Orders Tomorrow */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2.5 bg-success/10 text-success">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Orders Tomorrow</h3>
                <p className="text-sm text-muted-foreground">Orders to prepare for tomorrow ({tomorrowDate})</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-foreground">
                {tomorrowLoading ? '...' : (tomorrowOrdersToPrepare.length || 0)}
              </p>
              <p className="text-xs text-muted-foreground">FULLPAID orders</p>
            </div>
          </div>
          <div className="p-6">
            {tomorrowLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : tomorrowOrdersToPrepare.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders to prepare for tomorrow</p>
            ) : (
              <div className="space-y-3">
                {tomorrowOrdersToPrepare.slice(0, 5).map((order: any) => (
                  <div key={order.id} className="p-3 bg-muted/50 rounded-lg border border-border">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{order.customer_name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground font-mono">{order.id}</p>
                      </div>
                      <div className="text-right ml-4">
                        <p className="text-sm font-medium text-foreground">{formatIDR(order.total_amount || order.final_total || 0)}</p>
                        {order.delivery_time && (
                          <p className="text-xs text-muted-foreground">{order.delivery_time}</p>
                        )}
                      </div>
                    </div>
                    {/* Order Items */}
                    {(() => {
                      const displayItems = formatOrderItemsForDisplay(order);
                      return displayItems.length > 0 ? (
                        <div className="mt-2 pt-2 border-t border-border">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Items:</p>
                          <div className="space-y-1">
                            {displayItems.slice(0, 3).map((item: any, idx: number) => (
                              <p key={idx} className="text-xs text-foreground">
                                • {item.quantity}x {item.name}
                              </p>
                            ))}
                            {displayItems.length > 3 && (
                              <p className="text-xs text-muted-foreground">
                                +{displayItems.length - 3} more item(s)
                              </p>
                            )}
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                ))}
                {tomorrowOrdersToPrepare.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    +{tomorrowOrdersToPrepare.length - 5} more orders
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Charts & Lists */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <SalesChart />
        <div className="space-y-6">
          <div className="grid gap-4 grid-cols-2">
            <StatCard
              title="Pending Orders"
              value={pendingOrders || 0}
              icon={<Package className="h-5 w-5" />}
              variant="warning"
            />
            <StatCard
              title="Processing Orders"
              value={processingOrders || 0}
              icon={<TrendingUp className="h-5 w-5" />}
              variant="success"
            />
          </div>
          <ConversationsList />
        </div>
      </div>

      {/* Recent Orders */}
      <RecentOrders />
    </DashboardLayout>
  );
}
