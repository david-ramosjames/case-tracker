"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/performance/overview", label: "Overview" },
  { href: "/performance/team", label: "Team" },
  { href: "/performance/my-work", label: "My Work" },
  { href: "/performance/history", label: "History" },
  { href: "/performance/settings", label: "Settings" },
] as const;

export function PerformanceShell({
  children,
  showSettings,
}: {
  children: React.ReactNode;
  showSettings?: boolean;
}) {
  const pathname = usePathname();
  const visible = tabs.filter((tab) => tab.href !== "/performance/settings" || showSettings);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {visible.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-navy-950",
                active && "bg-navy-950 text-white hover:bg-navy-950 hover:text-white",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
