"use client";

import { Suspense, useState } from "react";
import { Bell, LogOut } from "lucide-react";
import { GlobalCaseSearch } from "@/components/layout/global-case-search";
import {
  DesktopSidebar,
  MobileMenuButton,
  MobileSidebarDrawer,
  useSidebarCollapsed,
} from "@/components/layout/app-sidebar";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isAdminRole } from "@/lib/auth/access";
import { type SessionUser } from "@/lib/auth/types";
import { type NavBadges } from "@/lib/navigation/nav-config";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  sessionUser,
  badges = {},
}: {
  children: React.ReactNode;
  sessionUser: SessionUser;
  badges?: NavBadges;
}) {
  const { collapsed, toggle } = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>

      <DesktopSidebar
        sessionUser={sessionUser}
        badges={badges}
        collapsed={collapsed}
        onToggle={toggle}
      />
      <MobileSidebarDrawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sessionUser={sessionUser}
        badges={badges}
      />

      <div
        className={cn(
          "flex min-h-screen min-w-0 flex-col transition-[padding] duration-200 ease-out",
          collapsed ? "lg:pl-16" : "lg:pl-64",
        )}
      >
        <header className="sticky top-0 z-20 border-b bg-white/88 backdrop-blur">
          <div className="flex min-h-16 items-center gap-3 px-4 py-3 sm:px-6">
            <MobileMenuButton onClick={() => setMobileOpen(true)} />
            <div className="min-w-0 flex-1 lg:max-w-md">
              <GlobalCaseSearch />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="icon" aria-label="Notifications" className="hidden sm:inline-flex">
                <Bell className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2 rounded-full border bg-white px-2 py-1.5 sm:px-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-white">
                  {sessionUser.avatarInitials}
                </div>
                <div className="hidden min-w-0 sm:block">
                  <p className="truncate text-sm font-semibold text-navy-950">{sessionUser.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{sessionUser.email}</p>
                </div>
                {isAdminRole(sessionUser.role) ? (
                  <Badge variant="pink" className="hidden md:inline-flex">
                    Admin
                  </Badge>
                ) : null}
                {!sessionUser.role ? <Badge variant="warning">Role pending</Badge> : null}
                <form action="/auth/signout" method="post">
                  <Button variant="ghost" size="icon" aria-label="Sign out" type="submit">
                    <LogOut className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
