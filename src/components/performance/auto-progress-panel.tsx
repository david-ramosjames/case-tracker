"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type AutoProgressCandidate } from "@/lib/performance/auto-progress";

type Props = {
  role: "attorney" | "paralegal";
  personId: string | null;
  weekStart: string;
};

export function AutoProgressPanel({ role, personId, weekStart }: Props) {
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState<AutoProgressCandidate[]>([]);
  const [applied, setApplied] = useState<Array<{ kind: string; caseNumber: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const sync = useCallback(async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/performance/sync-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, role, weekStart, applyAutoCompletes: true }),
      });
      const body = (await res.json()) as {
        error?: string;
        needsConfirm?: AutoProgressCandidate[];
        applied?: Array<{ kind: string; caseNumber: string }>;
      };
      if (!res.ok) throw new Error(body.error ?? "Sync failed");
      setNeedsConfirm(body.needsConfirm ?? []);
      setApplied(body.applied ?? []);
      if ((body.applied?.length ?? 0) > 0) {
        setMessage(
          `Auto-completed ${body.applied!.length} item${body.applied!.length === 1 ? "" : "s"} from Case Tracker dates.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }, [personId, role, weekStart]);

  useEffect(() => {
    void sync();
  }, [sync]);

  async function confirm(candidate: AutoProgressCandidate) {
    setBusyId(candidate.id);
    setError(null);
    try {
      const res = await fetch("/api/performance/confirm-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: candidate.caseId,
          caseNumber: candidate.caseNumber,
          clientName: candidate.clientName,
          deliverableType: candidate.deliverableType,
          deliverableId: candidate.deliverableId,
          docketEventId: candidate.docketEventId,
          eventTitle: candidate.label,
          attorneyUserId: candidate.attorneyUserId,
          assigneeUserId: candidate.assigneeUserId,
          completedAt: `${candidate.signalDate}T18:00:00.000Z`,
          notes: candidate.reason,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Confirm failed");
      setNeedsConfirm((prev) => prev.filter((c) => c.id !== candidate.id));
      setMessage(`Confirmed ${candidate.label} on ${candidate.caseNumber}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!personId) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Weekly goal progress</CardTitle>
          <CardDescription>
            Matches planned / in-progress items to DocketFlow, Slack stage signals, settlements, and
            disbursements. Items that need verification stay here until you confirm.
          </CardDescription>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void sync()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {applied.length > 0 ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            Auto-completed (no verification):{" "}
            {applied.map((a) => `${a.kind} ${a.caseNumber}`).join(", ")}
          </div>
        ) : null}

        {needsConfirm.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">No items need confirmation for this week.</p>
        ) : null}

        {needsConfirm.map((candidate) => (
          <div
            key={candidate.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b py-3 last:border-b-0"
          >
            <div>
              <div className="font-medium">
                {candidate.caseNumber} — {candidate.label}
              </div>
              <div className="text-xs text-muted-foreground">
                {candidate.clientName} · {candidate.signalDate} · {candidate.reason}
              </div>
            </div>
            <Button
              size="sm"
              disabled={busyId === candidate.id}
              onClick={() => void confirm(candidate)}
            >
              {busyId === candidate.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm complete
            </Button>
          </div>
        ))}

        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
