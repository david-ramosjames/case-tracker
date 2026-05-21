import { Bell, LogOut, Search } from "lucide-react";
import { AppMobileNav, AppTopNav } from "@/components/layout/app-top-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type SessionUser } from "@/lib/auth/types";

export function AppShell({ children, sessionUser }: { children: React.ReactNode; sessionUser: SessionUser }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-white/88 backdrop-blur">
        <div className="flex min-h-16 items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="min-w-0 flex-1">
            <AppTopNav sessionUser={sessionUser} />
          </div>
          <div className="ml-auto hidden items-center gap-2 xl:flex">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="w-72 pl-9" placeholder="Search cases, clients, attorneys..." />
            </div>
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 rounded-full border bg-white px-3 py-1.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-white">
                {sessionUser.avatarInitials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-navy-950">{sessionUser.name}</p>
                <p className="truncate text-xs text-muted-foreground">{sessionUser.email}</p>
              </div>
              {sessionUser.role === "admin" ? <Badge variant="pink">Admin</Badge> : null}
              <form action="/auth/signout" method="post">
                <Button variant="ghost" size="icon" aria-label="Sign out" type="submit">
                  <LogOut className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </div>
        </div>
        <AppMobileNav sessionUser={sessionUser} />
      </header>
      <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
