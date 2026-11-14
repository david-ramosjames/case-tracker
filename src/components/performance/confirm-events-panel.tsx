"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type DocketFlowScheduledEvent } from "@/lib/types";

export type ConfirmEventRow = {
  caseId: string;
  caseNumber: string;
  clientName: string;
  attorneyUserId: string | null;
  assigneeUserId: string | null;
  event: DocketFlowScheduledEvent;
};

export function ConfirmEventsPanel({ rows }: { rows: ConfirmEventRow[] }) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(() => new Set());

  async function confirm(row: ConfirmEventRow, outcome: "completed" | "canceled" | "rescheduled") {
    const key = `${row.event.id}:${outcome}`;
    setBusyKey(key);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/performance/confirm-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: row.caseId,
          caseNumber: row.caseNumber,
          clientName: row.clientName,
          docketEventId: row.event.id,
          eventTitle: row.event.title,
          outcome,
          attorneyUserId: row.attorneyUserId,
          assigneeUserId: row.assigneeUserId,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Confirm failed");
      setDone((prev) => new Set(prev).add(row.event.id));
      setMessage(`Marked ${row.event.title ?? "event"} as ${outcome}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Docket event confirmation</CardTitle>
        <CardDescription>
          Calendar events do not count as completed until you confirm. Confirmation does not change case stage or lit
          milestones.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming/past-week calendar events loaded for confirmation.</p>
        ) : (
          rows.map((row) => {
            if (done.has(row.event.id)) return null;
            return (
              <div key={row.event.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-3">
                <div>
                  <div className="font-medium">
                    {row.caseNumber} — {row.event.title ?? "Event"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.clientName} · {row.event.date ?? row.event.startDateTime ?? "—"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busyKey?.startsWith(row.event.id)}
                    onClick={() => void confirm(row, "completed")}
                  >
                    {busyKey === `${row.event.id}:completed` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Completed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyKey?.startsWith(row.event.id)}
                    onClick={() => void confirm(row, "rescheduled")}
                  >
                    Rescheduled
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyKey?.startsWith(row.event.id)}
                    onClick={() => void confirm(row, "canceled")}
                  >
                    Canceled
                  </Button>
                </div>
              </div>
            );
          })
        )}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
