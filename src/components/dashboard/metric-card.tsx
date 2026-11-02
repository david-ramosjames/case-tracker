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
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  href?: string;
}) {
  const card = (
    <Card className={cn("h-full", href && "transition hover:border-pink-200 hover:bg-pink-50/20")}>
      <CardContent className="flex items-start gap-3 p-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-navy-950">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-xl font-semibold tracking-normal text-navy-950">{value}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-300">
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
