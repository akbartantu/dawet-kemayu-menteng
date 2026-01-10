import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const data = [
  { name: "Mon", sales: 2400000, orders: 45 },
  { name: "Tue", sales: 1398000, orders: 32 },
  { name: "Wed", sales: 3200000, orders: 58 },
  { name: "Thu", sales: 2780000, orders: 51 },
  { name: "Fri", sales: 4890000, orders: 89 },
  { name: "Sat", sales: 5390000, orders: 102 },
  { name: "Sun", sales: 4490000, orders: 85 },
];

export function SalesChart() {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-6">
        <h3 className="font-semibold text-foreground">Weekly Sales</h3>
        <p className="text-sm text-muted-foreground">Revenue performance this week</p>
      </div>
      
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(142, 70%, 45%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(142, 70%, 45%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 32%, 91%)" />
            <XAxis
              dataKey="name"
              tick={{ fill: "hsl(215, 16%, 47%)", fontSize: 12 }}
              axisLine={{ stroke: "hsl(214, 32%, 91%)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "hsl(215, 16%, 47%)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(0, 0%, 100%)",
                border: "1px solid hsl(214, 32%, 91%)",
                borderRadius: "8px",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
              }}
              formatter={(value: number) => [
                `Rp ${value.toLocaleString("id-ID")}`,
                "Sales",
              ]}
            />
            <Area
              type="monotone"
              dataKey="sales"
              stroke="hsl(142, 70%, 45%)"
              strokeWidth={2}
              fill="url(#salesGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
