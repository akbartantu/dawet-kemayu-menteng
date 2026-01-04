import { MessageSquare, Settings, Zap, TrendingUp } from "lucide-react";

const steps = [
  {
    icon: Settings,
    step: "01",
    title: "Connect Your WhatsApp",
    description:
      "Link your WhatsApp Business account in minutes. No technical skills required.",
  },
  {
    icon: MessageSquare,
    step: "02",
    title: "Set Up Auto-Replies",
    description:
      "Configure your chatbot with menus, FAQs, and order flows that match your business.",
  },
  {
    icon: Zap,
    step: "03",
    title: "Start Receiving Orders",
    description:
      "Customers message you, the bot handles initial interactions, and orders flow into your dashboard.",
  },
  {
    icon: TrendingUp,
    step: "04",
    title: "Grow Your Business",
    description:
      "Track performance, run campaigns, and use insights to scale your operations.",
  },
];

export function HowItWorks() {
  return (
    <section className="py-24 bg-secondary">
      <div className="container mx-auto px-6">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Get Started in <span className="text-gradient">Minutes</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Four simple steps to transform how you manage your business through
            WhatsApp.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((item, index) => (
            <div key={index} className="relative">
              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-12 left-1/2 w-full h-0.5 bg-gradient-to-r from-accent to-accent/20" />
              )}

              <div className="relative text-center">
                {/* Step Number */}
                <div className="relative inline-flex mb-6">
                  <div className="h-24 w-24 rounded-2xl bg-card border-2 border-accent/20 flex items-center justify-center shadow-soft">
                    <item.icon className="h-10 w-10 text-accent" />
                  </div>
                  <span className="absolute -top-2 -right-2 h-8 w-8 rounded-full bg-accent text-accent-foreground text-sm font-bold flex items-center justify-center">
                    {item.step}
                  </span>
                </div>

                <h3 className="text-xl font-semibold text-foreground mb-3">
                  {item.title}
                </h3>
                <p className="text-muted-foreground">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
