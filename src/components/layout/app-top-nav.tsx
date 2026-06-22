"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BriefcaseBusiness,
  CircleDollarSign,
  Gavel,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  Sparkles,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type SessionUser } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases", label: "Cases", icon: BriefcaseBusiness },
  { href: "/stage-suggestions", label: "Suggestions", icon: Sparkles },
  { href: "/results", label: "Results", icon: CircleDollarSign },
  { href: "/output", label: "Output", icon: BarChart3 },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/client-sms", label: "Client SMS", icon: MessageSquare, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
  { href: "/faq", label: "FAQ", icon: HelpCircle, adminOnly: true },
];

export function AppTopNav({ sessionUser }: { sessionUser: SessionUser }) {
  const pathname = usePathname();
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || sessionUser.role === "admin" || sessionUser.role === "super_admin");

  return (
    <div className="flex min-w-0 items-center gap-4">
      <Link href="/" className="flex shrink-0 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-500 text-white">
          <Gavel className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-pink-500">Ramos James Law</p>
          <h1 className="text-base font-semibold tracking-normal text-navy-950">Case Tracker</h1>
        </div>
      </Link>

      <nav className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex">
        {visibleNavItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-navy-950",
                isActive && "bg-navy-950 text-white shadow-sm hover:bg-navy-950 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function AppMobileNav({ sessionUser }: { sessionUser: SessionUser }) {
  const pathname = usePathname();
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || sessionUser.role === "admin" || sessionUser.role === "super_admin");

  return (
    <div className="border-t bg-white lg:hidden">
      <nav className="flex gap-2 overflow-x-auto px-4 py-2">
      {visibleNavItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground",
              isActive && "bg-navy-950 text-white",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
      </nav>
      <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-navy-950">{sessionUser.name}</p>
          <p className="truncate text-xs text-muted-foreground">{sessionUser.email}</p>
        </div>
        {sessionUser.role === "admin" ? <Badge variant="pink">Admin</Badge> : null}
        {!sessionUser.role ? <Badge variant="warning">Role pending</Badge> : null}
        <form action="/auth/signout" method="post">
          <Button variant="outline" size="sm" type="submit">
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
