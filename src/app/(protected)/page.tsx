import { Lock } from "lucide-react";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { getCurrentQuarter, percent, getQuarterElapsedPercentage } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { records, goals, settings, users } = await loadViewerCaseBundle();

  return (
    <>
      <PageHeader
        eyebrow={`${getCurrentQuarter()} - ${percent(getQuarterElapsedPercentage())} elapsed`}
        title="Attorney pipeline command center"
        description="Track active cases, inferred workflow signals, quarterly check-ins, policy capture, fee forecasts, and goal progress without turning attorneys into spreadsheet maintainers."
        actions={
          <>
            <Button variant="outline" disabled title="General exports are disabled in V1. Admin-only exports can be added later.">
              <Lock className="h-4 w-4" />
              Admin Export Only
            </Button>
          </>
        }
      />
      <DashboardView records={records} goals={goals} settings={settings} users={users} />
    </>
  );
}
