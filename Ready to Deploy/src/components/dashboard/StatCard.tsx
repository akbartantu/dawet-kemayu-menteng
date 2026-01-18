import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: ReactNode;
  variant?: "default" | "accent" | "success" | "warning";
}

export function StatCard({
  title,
  value,
  change,
  changeLabel = "vs last period",
  icon,
  variant = "default",
}: StatCardProps) {
  const isPositive = change && change > 0;
  const isNegative = change && change < 0;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl p-6 transition-all duration-300 hover:shadow-card-hover",
        variant === "default" && "bg-card border border-border",
        variant === "accent" && "bg-accent-gradient text-accent-foreground",
        variant === "success" && "bg-success/10 border border-success/20",
        variant === "warning" && "bg-warning/10 border border-warning/20"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p
            className={cn(
              "text-sm font-medium",
              variant === "default" && "text-muted-foreground",
              variant === "accent" && "text-accent-foreground/80"
            )}
          >
            {title}
          </p>
          <p
            className={cn(
              "text-3xl font-bold tracking-tight",
              variant === "default" && "text-foreground"
            )}
          >
            {value}
          </p>
          {change !== undefined && (
            <div className="flex items-center gap-1.5">
              {isPositive && (
                <TrendingUp className="h-4 w-4 text-success" />
              )}
              {isNegative && (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
              <span
                className={cn(
                  "text-sm font-medium",
                  isPositive && "text-success",
                  isNegative && "text-destructive",
                  !isPositive && !isNegative && "text-muted-foreground"
                )}
              >
                {isPositive && "+"}
                {change}%
              </span>
              <span
                className={cn(
                  "text-xs",
                  variant === "default" && "text-muted-foreground",
                  variant === "accent" && "text-accent-foreground/70"
                )}
              >
                {changeLabel}
              </span>
            </div>
          )}
        </div>
        <div
          className={cn(
            "rounded-lg p-2.5",
            variant === "default" && "bg-accent/10 text-accent",
            variant === "accent" && "bg-white/20 text-accent-foreground",
            variant === "success" && "bg-success/20 text-success",
            variant === "warning" && "bg-warning/20 text-warning"
          )}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
