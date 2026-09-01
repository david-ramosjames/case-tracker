import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AttorneyGoalsManager } from "@/components/settings/attorney-goals-manager";
import { AttorneyScoreExplainer } from "@/components/attorney-score/attorney-score";
import { BackfillImportCard } from "@/components/settings/backfill-import-card";
import { DailyJobsCard } from "@/components/settings/daily-jobs-card";
import { SettlementSyncCard } from "@/components/settings/settlement-sync-card";
import { SlackFieldAlertsCard } from "@/components/settings/slack-field-alerts-card";
import { SlackSyncCard } from "@/components/settings/slack-sync-card";
import { UserRolesCard } from "@/components/settings/user-roles-card";
import { type AppUser, type AttorneyGoal, type CaseTrackerSettings } from "@/lib/types";

export function SettingsView({
  settings,
  users,
  goals,
  canDeleteGoals = false,
}: {
  settings: CaseTrackerSettings;
  users: AppUser[];
  goals: AttorneyGoal[];
  canDeleteGoals?: boolean;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button variant="outline" size="sm" asChild>
            <Link href="/faq">Product FAQ</Link>
          </Button>
        </div>

        <BackfillImportCard />

        <SlackSyncCard />
        <SlackFieldAlertsCard settings={settings} users={users} />
        <SettlementSyncCard />

        <AttorneyGoalsManager users={users} goals={goals} canDeleteGoals={canDeleteGoals} />

        <Card>
          <CardHeader>
            <CardTitle>How Case Tracker Score is calculated</CardTitle>
            <CardDescription>Case-level scoring rolled up per attorney on the dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <AttorneyScoreExplainer />
          </CardContent>
        </Card>

        <UserRolesCard users={users} />

        <DailyJobsCard />
      </div>

      <aside className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Tracker Settings</CardTitle>
            <CardDescription>Defaults loaded from `case_tracker_settings` when configured.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label>
              <span className="mb-2 block text-sm font-medium text-navy-950">Stale review threshold</span>
              <Input value={`${settings.staleReviewThresholdDays} days`} readOnly />
            </label>
            <label>
              <span className="mb-2 block text-sm font-medium text-navy-950">Paralegal limited edit</span>
              <Select value={settings.paralegalLimitedEditEnabled ? "enabled" : "disabled"} disabled>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </Select>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Case Stages</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {settings.stages.map((stage) => (
              <Badge key={stage} variant="outline">
                {stage}
              </Badge>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Required Fields</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {settings.requiredFields.map((field) => (
              <Badge key={field} variant="warning">
                {field}
              </Badge>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Confidence Levels</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {settings.confidenceLevels.map((level) => (
              <Badge key={level} variant={level === "High" ? "success" : level === "Medium" ? "pink" : "warning"}>
                {level}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
