import { Button } from "@/components/ui/button";
import { MessageSquare, ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";

const features = [
  "Auto-reply to customer messages",
  "Order management via chat",
  "Smart payment reminders",
  "Sales analytics dashboard",
];

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-hero min-h-screen flex items-center">
      {/* Background Elements */}
      <div className="absolute inset-0">
        <div className="absolute top-20 left-10 w-72 h-72 bg-accent/20 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-accent/5 to-transparent rounded-full" />
      </div>

      <div className="container mx-auto px-6 py-24 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="space-y-8 animate-slide-up">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/20">
              <MessageSquare className="h-4 w-4 text-accent" />
              <span className="text-sm font-medium text-accent">
                WhatsApp Business Platform
              </span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-primary-foreground leading-tight">
              Manage Your SME{" "}
              <span className="text-gradient">Sales & Operations</span>{" "}
              via WhatsApp
            </h1>

            <p className="text-lg text-primary-foreground/70 max-w-xl">
              The all-in-one platform that connects your business to customers through WhatsApp. 
              Automate orders, track sales, send reminders, and grow your revenue.
            </p>

            <ul className="space-y-3">
              {features.map((feature, index) => (
                <li
                  key={index}
                  className="flex items-center gap-3 text-primary-foreground/80"
                >
                  <CheckCircle2 className="h-5 w-5 text-accent flex-shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row gap-4">
              <Link to="/dashboard">
                <Button variant="hero" size="xl">
                  Get Started Free
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <Button variant="hero-outline" size="xl">
                Watch Demo
              </Button>
            </div>

            <p className="text-sm text-primary-foreground/50">
              No credit card required • 14-day free trial • Cancel anytime
            </p>
          </div>

          {/* Right Content - Phone Mockup */}
          <div className="relative animate-fade-in lg:block hidden">
            <div className="relative mx-auto w-[320px]">
              {/* Phone Frame */}
              <div className="relative bg-primary rounded-[3rem] p-3 shadow-2xl">
                <div className="bg-background rounded-[2.5rem] overflow-hidden">
                  {/* Status Bar */}
                  <div className="h-8 bg-whatsapp-dark flex items-center justify-center">
                    <div className="w-20 h-1 bg-primary-foreground/30 rounded-full" />
                  </div>
                  
                  {/* WhatsApp Header */}
                  <div className="bg-whatsapp-dark px-4 py-3 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary-foreground/20" />
                    <div>
                      <p className="text-primary-foreground font-semibold text-sm">
                        Warung Makan Barokah
                      </p>
                      <p className="text-primary-foreground/70 text-xs">Online</p>
                    </div>
                  </div>

                  {/* Chat Messages */}
                  <div className="bg-[#e5ddd5] p-4 space-y-3 h-[400px]">
                    {/* Customer Message */}
                    <div className="flex justify-start">
                      <div className="bg-primary-foreground rounded-lg rounded-tl-none px-4 py-2 max-w-[80%] shadow">
                        <p className="text-sm text-foreground">
                          Halo, mau pesan nasi goreng 2 porsi ya
                        </p>
                        <p className="text-[10px] text-muted-foreground text-right mt-1">
                          10:30
                        </p>
                      </div>
                    </div>

                    {/* Bot Response */}
                    <div className="flex justify-end">
                      <div className="bg-whatsapp-light rounded-lg rounded-tr-none px-4 py-2 max-w-[80%] shadow">
                        <p className="text-sm text-foreground">
                          Halo! Terima kasih sudah menghubungi kami 🙏
                        </p>
                        <p className="text-sm text-foreground mt-2">
                          Pesanan Anda:
                          <br />
                          • Nasi Goreng x2 = Rp 50.000
                        </p>
                        <p className="text-sm text-foreground mt-2">
                          Mau diantar atau diambil sendiri?
                        </p>
                        <p className="text-[10px] text-muted-foreground text-right mt-1">
                          10:30 ✓✓
                        </p>
                      </div>
                    </div>

                    {/* Customer Reply */}
                    <div className="flex justify-start">
                      <div className="bg-primary-foreground rounded-lg rounded-tl-none px-4 py-2 max-w-[80%] shadow">
                        <p className="text-sm text-foreground">Diantar ke rumah</p>
                        <p className="text-[10px] text-muted-foreground text-right mt-1">
                          10:31
                        </p>
                      </div>
                    </div>

                    {/* Bot Response */}
                    <div className="flex justify-end">
                      <div className="bg-whatsapp-light rounded-lg rounded-tr-none px-4 py-2 max-w-[80%] shadow">
                        <p className="text-sm text-foreground">
                          Siap! Total: Rp 55.000 (termasuk ongkir)
                        </p>
                        <p className="text-sm text-foreground mt-2">
                          📍 Kirim ke alamat mana?
                        </p>
                        <p className="text-[10px] text-muted-foreground text-right mt-1">
                          10:31 ✓✓
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating Elements */}
              <div className="absolute -right-16 top-20 glass-dark rounded-lg p-4 shadow-xl animate-float">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center">
                    <MessageSquare className="h-5 w-5 text-accent-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary-foreground">
                      +156
                    </p>
                    <p className="text-xs text-primary-foreground/70">
                      Orders today
                    </p>
                  </div>
                </div>
              </div>

              <div className="absolute -left-12 bottom-32 glass-dark rounded-lg p-4 shadow-xl animate-float" style={{ animationDelay: "2s" }}>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-success flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5 text-success-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary-foreground">
                      Auto-reply
                    </p>
                    <p className="text-xs text-primary-foreground/70">Active</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
