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
} from "lucide-react";

export default function Dashboard() {
  return (
    <DashboardLayout
      title="Dashboard"
      subtitle="Welcome back! Here's what's happening with your business."
    >
      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard
          title="Today's Revenue"
          value="Rp 4.5M"
          change={12.5}
          icon={<DollarSign className="h-5 w-5" />}
          variant="accent"
        />
        <StatCard
          title="Total Orders"
          value="156"
          change={8.2}
          icon={<ShoppingCart className="h-5 w-5" />}
        />
        <StatCard
          title="Active Chats"
          value="24"
          change={-3.1}
          icon={<MessageSquare className="h-5 w-5" />}
        />
        <StatCard
          title="New Customers"
          value="18"
          change={24.5}
          icon={<Users className="h-5 w-5" />}
        />
      </div>

      {/* Charts & Lists */}
      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <SalesChart />
        <div className="space-y-6">
          <div className="grid gap-4 grid-cols-2">
            <StatCard
              title="Conversion Rate"
              value="68%"
              change={5.2}
              icon={<TrendingUp className="h-5 w-5" />}
              variant="success"
            />
            <StatCard
              title="Low Stock Items"
              value="5"
              icon={<Package className="h-5 w-5" />}
              variant="warning"
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
