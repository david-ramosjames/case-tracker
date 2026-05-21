import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ensureProvisionedSessionUser } from "@/lib/auth/session";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await ensureProvisionedSessionUser();
  if (!sessionUser) {
    redirect("/login");
  }

  return <AppShell sessionUser={sessionUser}>{children}</AppShell>;
}
