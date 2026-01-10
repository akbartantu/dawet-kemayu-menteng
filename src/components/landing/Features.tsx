import {
  ShoppingCart,
  MessageSquare,
  Megaphone,
  Bot,
  TrendingUp,
  FileText,
  Bell,
  BarChart3,
} from "lucide-react";

const features = [
  {
    icon: ShoppingCart,
    title: "Order Management",
    description:
      "Receive, process, and track orders directly through WhatsApp. Real-time status updates for you and your customers.",
  },
  {
    icon: Bot,
    title: "AI Auto-Reply",
    description:
      "Smart chatbot that answers FAQs, takes orders, and guides customers 24/7. Seamless handoff to human agents when needed.",
  },
  {
    icon: Megaphone,
    title: "Marketing Campaigns",
    description:
      "Send broadcasts, promotions, and personalized messages to your customer segments with template compliance.",
  },
  {
    icon: MessageSquare,
    title: "Customer Assistant",
    description:
      "Help customers browse products, answer questions, and provide support through conversational commerce.",
  },
  {
    icon: TrendingUp,
    title: "Sales & Stock Tracking",
    description:
      "Monitor sales performance, track inventory levels, and get alerts when stock runs low.",
  },
  {
    icon: FileText,
    title: "Invoice Generation",
    description:
      "Create and send professional invoices directly via WhatsApp. Track payments and manage billing effortlessly.",
  },
  {
    icon: Bell,
    title: "Smart Reminders",
    description:
      "Automated reminders for payments, deliveries, and follow-ups. Never miss an opportunity to engage.",
  },
  {
    icon: BarChart3,
    title: "Owner Dashboard",
    description:
      "Complete visibility into cashflow, sales insights, customer patterns, and business analytics.",
  },
];

export function Features() {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-6">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Everything You Need to{" "}
            <span className="text-gradient">Run Your Business</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            A complete suite of tools designed specifically for SMEs to manage
            sales, customers, and operations through WhatsApp.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <div
              key={index}
              className="group relative p-6 rounded-xl border border-border bg-card hover:border-accent/50 hover:shadow-glow transition-all duration-300"
            >
              <div className="h-12 w-12 rounded-lg bg-accent/10 flex items-center justify-center mb-4 group-hover:bg-accent group-hover:scale-110 transition-all duration-300">
                <feature.icon className="h-6 w-6 text-accent group-hover:text-accent-foreground transition-colors" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
