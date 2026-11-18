"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight, Gavel, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type SessionUser } from "@/lib/auth/types";
import {
  isNavItemActive,
  visibleNavGroups,
  type NavBadges,
  type NavItemDef,
} from "@/lib/navigation/nav-config";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "case-tracker.sidebar-collapsed";

function formatBadge(count: number | undefined) {
  if (!count || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

function NavLink({
  item,
  collapsed,
  badges,
  onNavigate,
}: {
  item: NavItemDef;
  collapsed: boolean;
  badges: NavBadges;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isNavItemActive(pathname, item.href);
  const Icon = item.icon;
  const badge = item.badgeKey ? formatBadge(badges[item.badgeKey]) : null;

  return (
    <Link
      href={item.href}
      title={collapsed ? (badge ? `${item.label} (${badge})` : item.label) : undefined}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-2",
        active
          ? "bg-pink-100 text-pink-600 shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-navy-950",
        active &&
          "before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-full before:bg-pink-500",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-pink-600" : "text-muted-foreground group-hover:text-navy-950",
        )}
      />
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {badge ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                active ? "bg-pink-500 text-white" : "bg-navy-950 text-white",
              )}
            >
              {badge}
            </span>
          ) : null}
        </>
      ) : badge ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-pink-500 px-1 text-[9px] font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function SidebarNavBody({
  sessionUser,
  badges,
  collapsed,
  onNavigate,
}: {
  sessionUser: SessionUser;
  badges: NavBadges;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const groups = visibleNavGroups(sessionUser);

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
      {groups.map((group) => (
        <div key={group.id} className="space-y-1">
          {!collapsed ? (
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </p>
          ) : (
            <div className="mx-auto mb-1 h-px w-6 bg-border" aria-hidden />
          )}
          {group.items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              collapsed={collapsed}
              badges={badges}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function BrandMark({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      href="/"
      className={cn("flex min-w-0 items-center gap-3", collapsed && "justify-center")}
      title="Case Tracker"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-pink-500 text-white">
        <Gavel className="h-4 w-4" />
      </div>
      {!collapsed ? (
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-pink-500">
            Ramos James Law
          </p>
          <p className="truncate text-sm font-semibold text-navy-950">Case Tracker</p>
        </div>
      ) : null}
    </Link>
  );
}

export function DesktopSidebar({
  sessionUser,
  badges,
  collapsed,
  onToggle,
}: {
  sessionUser: SessionUser;
  badges: NavBadges;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-white lg:flex",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className={cn("flex h-16 items-center border-b", collapsed ? "justify-center px-2" : "px-4")}>
        <BrandMark collapsed={collapsed} />
      </div>
      <SidebarNavBody sessionUser={sessionUser} badges={badges} collapsed={collapsed} />
      <div className="border-t p-2">
        <Button
          type="button"
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className={cn("w-full", !collapsed && "justify-start gap-2")}
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed ? <span>Collapse</span> : null}
        </Button>
      </div>
    </aside>
  );
}

export function MobileSidebarDrawer({
  open,
  onClose,
  sessionUser,
  badges,
}: {
  open: boolean;
  onClose: () => void;
  sessionUser: SessionUser;
  badges: NavBadges;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-navy-950/40"
        aria-label="Close menu"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 left-0 flex w-[min(18rem,88vw)] flex-col bg-white shadow-soft">
        <div className="flex h-16 items-center justify-between gap-2 border-b px-3">
          <BrandMark collapsed={false} />
          <Button type="button" variant="ghost" size="icon" aria-label="Close menu" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <SidebarNavBody
          sessionUser={sessionUser}
          badges={badges}
          collapsed={false}
          onNavigate={onClose}
        />
      </aside>
    </div>
  );
}

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // ignore
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed, ready]);

  return {
    collapsed,
    toggle: () => setCollapsed((value) => !value),
  };
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="lg:hidden"
      aria-label="Open menu"
      onClick={onClick}
    >
      <Menu className="h-4 w-4" />
    </Button>
  );
}
