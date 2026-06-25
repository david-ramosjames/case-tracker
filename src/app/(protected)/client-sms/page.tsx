import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ClientSmsSettingsView } from "@/components/settings/client-sms-settings-view";
import { getSessionUser } from "@/lib/auth/session";
import { dataRepository } from "@/lib/data/repository";

export const dynamic = "force-dynamic";

export default async function ClientSmsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || (sessionUser.role !== "admin" && sessionUser.role !== "super_admin")) {
    redirect("/");
  }

  const users = await dataRepository.getUsers();

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Client SMS automations"
        description="Configure Quo SMS messages by stage, attorney, signing delay, and case type. Each send is posted to Slack for approval before the client receives it."
      />
      <ClientSmsSettingsView users={users} />
    </>
  );
}
