"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BriefcaseBusiness, CircleDollarSign, Gavel, LayoutDashboard, Scale, Settings, Sparkles, Target } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases", label: "Cases", icon: BriefcaseBusiness },
  { href: "/stage-suggestions", label: "Suggestions", icon: Sparkles },
  { href: "/results", label: "Results", icon: CircleDollarSign },
  { href: "/litigation", label: "Litigation", icon: Scale },
  { href: "/output", label: "Output", icon: BarChart3 },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r bg-navy-950 text-white lg:flex lg:flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-500 text-white">
          <Gavel className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-white/60">Ramos James Law</p>
          <h1 className="text-lg font-semibold tracking-normal">Case Tracker</h1>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-5">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-white/72 transition-colors hover:bg-white/10 hover:text-white",
                isActive && "bg-white text-navy-950 shadow-sm hover:bg-white hover:text-navy-950",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="rounded-lg bg-white/8 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-pink-400" />
            Firm View
          </div>
          <p className="text-sm leading-6 text-white/68">
            Live Supabase data with DocketFlow case fields kept as the source of truth.
          </p>
        </div>
      </div>
    </aside>
  );
}
