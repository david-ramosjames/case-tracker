import Link from "next/link";
import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  href,
  alert = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  href?: string;
  /** Red attention treatment when this metric needs action. */
  alert?: boolean;
}) {
  const card = (
    <Card
      className={cn(
        "relative h-full",
        href && !alert && "transition hover:border-pink-200 hover:bg-pink-50/20",
        alert && "border-red-300 bg-red-50/60 shadow-[inset_3px_0_0_0_#dc2626]",
        href && alert && "transition hover:border-red-400 hover:bg-red-50",
      )}
    >
      <CardContent className="flex items-start gap-3 p-3.5">
        <div
          className={cn(
            "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            alert ? "bg-red-100 text-red-700" : "bg-secondary text-navy-950",
          )}
        >
          <Icon className="h-4 w-4" />
          {alert ? (
            <span
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold leading-none text-white"
              aria-hidden
            >
              !
            </span>
          ) : null}
        </div>
        <div className="min-w-0">
          <p className={cn("text-xs font-medium", alert ? "text-red-700" : "text-muted-foreground")}>{label}</p>
          <p className={cn("mt-0.5 text-xl font-semibold tracking-normal", alert ? "text-red-700" : "text-navy-950")}>
            {value}
          </p>
          <p className={cn("mt-0.5 text-[11px] leading-snug", alert ? "text-red-700/80" : "text-muted-foreground")}>
            {detail}
          </p>
        </div>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          "block rounded-xl focus-visible:outline-none focus-visible:ring-2",
          alert ? "focus-visible:ring-red-300" : "focus-visible:ring-pink-300",
        )}
      >
        {card}
      </Link>
    );
  }

  return card;
}

export function MetricSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}
