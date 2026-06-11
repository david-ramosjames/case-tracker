import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsView } from "@/components/settings/settings-view";
import { getSessionUser } from "@/lib/auth/session";
import { dataRepository } from "@/lib/data/repository";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || (sessionUser.role !== "admin" && sessionUser.role !== "super_admin")) {
    redirect("/");
  }
  const [settings, users, goals] = await Promise.all([
    dataRepository.getSettings(),
    dataRepository.getUsers(),
    dataRepository.getAttorneyGoals(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Tracker settings"
        description="Admin screens for goals, stages, confidence levels, required fields, stale review threshold, and user roles."
      />
      <SettingsView
        settings={settings}
        users={users}
        goals={goals}
        canDeleteGoals={sessionUser.role === "admin" || sessionUser.role === "super_admin"}
      />
    </>
  );
}
