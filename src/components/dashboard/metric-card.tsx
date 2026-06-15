import Link from "next/link";
import { type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

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
    <Card className={href ? "transition hover:border-pink-200 hover:bg-pink-50/20" : undefined}>
      <CardContent className="flex items-start gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-secondary text-navy-950">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-normal text-navy-950">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
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
