import { redirect } from "next/navigation";
import { AdminFaqView } from "@/components/faq/admin-faq-view";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function FaqPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || (sessionUser.role !== "admin" && sessionUser.role !== "super_admin")) {
    redirect("/");
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Product FAQ"
        description="How Case Tracker fits together — data sources, scoring, stages, Slack automation, and admin setup."
      />
      <AdminFaqView />
    </>
  );
}
