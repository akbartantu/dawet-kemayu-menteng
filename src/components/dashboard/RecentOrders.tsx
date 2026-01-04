import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Eye } from "lucide-react";

const orders = [
  {
    id: "ORD-001",
    customer: "Ahmad Rizky",
    product: "Nasi Goreng Special",
    amount: "Rp 45.000",
    status: "completed",
    time: "10 min ago",
  },
  {
    id: "ORD-002",
    customer: "Siti Aminah",
    product: "Mie Ayam + Es Teh",
    amount: "Rp 32.000",
    status: "processing",
    time: "25 min ago",
  },
  {
    id: "ORD-003",
    customer: "Budi Santoso",
    product: "Paket Hemat A",
    amount: "Rp 55.000",
    status: "pending",
    time: "32 min ago",
  },
  {
    id: "ORD-004",
    customer: "Dewi Lestari",
    product: "Soto Ayam",
    amount: "Rp 28.000",
    status: "completed",
    time: "1 hour ago",
  },
  {
    id: "ORD-005",
    customer: "Eko Prasetyo",
    product: "Ayam Geprek Level 5",
    amount: "Rp 35.000",
    status: "processing",
    time: "1.5 hours ago",
  },
];

const statusConfig = {
  completed: { label: "Completed", variant: "success" as const },
  processing: { label: "Processing", variant: "info" as const },
  pending: { label: "Pending", variant: "warning" as const },
  cancelled: { label: "Cancelled", variant: "destructive" as const },
};

export function RecentOrders() {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between p-6 border-b border-border">
        <div>
          <h3 className="font-semibold text-foreground">Recent Orders</h3>
          <p className="text-sm text-muted-foreground">Latest customer orders via WhatsApp</p>
        </div>
        <Button variant="outline" size="sm">
          View All
        </Button>
      </div>
      
      <div className="divide-y divide-border">
        {orders.map((order) => {
          const status = statusConfig[order.status as keyof typeof statusConfig];
          return (
            <div
              key={order.id}
              className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-accent/10 flex items-center justify-center">
                  <span className="text-sm font-medium text-accent">
                    {order.customer.split(" ").map(n => n[0]).join("")}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-foreground">{order.customer}</p>
                  <p className="text-sm text-muted-foreground">{order.product}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="font-medium text-foreground">{order.amount}</p>
                  <p className="text-xs text-muted-foreground">{order.time}</p>
                </div>
                <Badge variant={status.variant}>{status.label}</Badge>
                <Button variant="ghost" size="icon-sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
