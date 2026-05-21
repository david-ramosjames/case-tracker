import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full bg-pink-500 transition-all" style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}
