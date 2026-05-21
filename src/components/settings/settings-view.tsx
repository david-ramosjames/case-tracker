import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BackfillImportCard } from "@/components/settings/backfill-import-card";
import { type AppUser, type AttorneyGoal, type CaseTrackerSettings } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export function SettingsView({
  settings,
  users,
  goals,
}: {
  settings: CaseTrackerSettings;
  users: AppUser[];
  goals: AttorneyGoal[];
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
      <div className="space-y-6">
        <BackfillImportCard />

        <Card>
          <CardHeader>
            <CardTitle>Attorney Goals</CardTitle>
            <CardDescription>Supabase-backed admin surface for yearly and quarterly fee goals.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attorney</TableHead>
                  <TableHead>Annual fee goal</TableHead>
                  <TableHead>Q1</TableHead>
                  <TableHead>Q2</TableHead>
                  <TableHead>Q3</TableHead>
                  <TableHead>Q4</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {goals.map((goal) => {
                  const attorney = users.find((user) => user.id === goal.attorneyId);

                  return (
                    <TableRow key={goal.id}>
                      <TableCell className="font-semibold">{attorney?.name}</TableCell>
                      <TableCell>{formatCurrency(goal.annualFeeGoal)}</TableCell>
                      <TableCell>{formatCurrency(goal.q1Goal)}</TableCell>
                      <TableCell>{formatCurrency(goal.q2Goal)}</TableCell>
                      <TableCell>{formatCurrency(goal.q3Goal)}</TableCell>
                      <TableCell>{formatCurrency(goal.q4Goal)}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm">
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>User Roles</CardTitle>
            <CardDescription>Role-aware access model for attorneys, paralegals, managers, admins, and super admins.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-semibold">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === "manager" || user.role === "admin" ? "pink" : "outline"}>
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>{user.active ? "Active" : "Inactive"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
