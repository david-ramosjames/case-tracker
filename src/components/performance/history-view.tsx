"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type AppUser } from "@/lib/types";
import { type PerformanceCommitment, type PerformanceDeliverable } from "@/lib/performance/types";

type HistoryPayload = {
  weekStart: string;
  monday: { payload: Record<string, unknown>; frozenAt: string } | null;
  deliverables: PerformanceDeliverable[];
  commitments: Array<PerformanceCommitment & { inMondayPlan?: boolean; addedAfterMonday?: boolean }>;
  eventsByDeliverable: Record<string, Array<{ eventType: string; createdAt: string; payload: Record<string, unknown> }>>;
};

export function HistoryView({
  users,
  initialWeekStart,
}: {
  users: AppUser[];
  initialWeekStart: string;
}) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/performance/history?userId=${encodeURIComponent(userId)}&weekStart=${encodeURIComponent(weekStart)}`,
      );
      const body = (await res.json()) as HistoryPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load history");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  const deliverableMap = new Map((data?.deliverables ?? []).map((d) => [d.id, d]));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Employee week history</CardTitle>
          <CardDescription>
            Monday commitments vs work added later, completions, moves, and cancels. Live plan stays editable; Monday
            snapshot does not change.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Employee</span>
            <select
              className="block min-w-[14rem] rounded-md border px-3 py-2"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Week start (Monday)</span>
            <Input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
          </label>
          <Button onClick={() => void load()} disabled={loading || !userId}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Load week
          </Button>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Monday snapshot</CardTitle>
              <CardDescription>
                {data.monday
                  ? `Frozen ${data.monday.frozenAt}`
                  : "No Monday snapshot for this week yet — live commitments still shown below."}
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Commitments</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Monday plan?</TableHead>
                    <TableHead>Changes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.commitments.map((c) => {
                    const d = deliverableMap.get(c.deliverableId);
                    const events = data.eventsByDeliverable[c.deliverableId] ?? [];
                    return (
                      <TableRow key={c.id}>
                        <TableCell>{d?.caseNumber ?? "—"}</TableCell>
                        <TableCell>{d?.deliverableType ?? "—"}</TableCell>
                        <TableCell>{c.outcome}</TableCell>
                        <TableCell>
                          {c.inMondayPlan ? "Yes" : c.addedAfterMonday ? "Added after" : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {events.map((e) => `${e.createdAt.slice(0, 16)} ${e.eventType}`).join(" · ") || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {data.commitments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        No commitments for this employee/week.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Backlog / outstanding for employee</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Identified</TableHead>
                    <TableHead>Moves</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.deliverables
                    .filter((d) => d.workflowStatus === "backlog" || d.workflowStatus === "committed")
                    .map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{d.caseNumber}</TableCell>
                        <TableCell>{d.deliverableType}</TableCell>
                        <TableCell>{d.workflowStatus}</TableCell>
                        <TableCell>{d.identifiedAt.slice(0, 10)}</TableCell>
                        <TableCell>{d.rescheduleCount}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
