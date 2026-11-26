"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type AutoProgressCandidate } from "@/lib/performance/auto-progress";

type Props = {
  role: "attorney" | "paralegal";
  personId: string | null;
  weekStart: string;
};

function dismissStorageKey(personId: string, weekStart: string) {
  return `perf-progress-dismissed:${personId}:${weekStart}`;
}

function readDismissedIds(personId: string, weekStart: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(dismissStorageKey(personId, weekStart));
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeDismissedIds(personId: string, weekStart: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(dismissStorageKey(personId, weekStart), JSON.stringify([...ids]));
}

function evidenceLinkLabel(candidate: AutoProgressCandidate) {
  if (candidate.evidenceSource === "slack") return "Slack post ↗";
  if (candidate.evidenceSource === "docketflow") return "DocketFlow ↗";
  if (candidate.evidenceSource === "case_tracker") return "Open case ↗";
  return "View ↗";
}

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
      const dismissed = readDismissedIds(personId, weekStart);
      setNeedsConfirm((body.needsConfirm ?? []).filter((c) => !dismissed.has(c.id)));
      setApplied(body.applied ?? []);
      if ((body.applied?.length ?? 0) > 0) {
        const litScheduled = body.applied!.filter((a) => a.kind === "lit_scheduled").length;
        const other = body.applied!.length - litScheduled;
        const parts: string[] = [];
        if (litScheduled > 0) {
          parts.push(
            `${litScheduled} Schedule Lit Event${litScheduled === 1 ? "" : "s"} from DocketFlow creates`,
          );
        }
        if (other > 0) {
          parts.push(
            `${other} item${other === 1 ? "" : "s"} from Case Tracker dates`,
          );
        }
        setMessage(`Auto-completed ${parts.join(" and ")}.`);
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
          stageSuggestionId: candidate.stageSuggestionId,
          eventTitle: candidate.label,
          attorneyUserId: candidate.attorneyUserId,
          assigneeUserId: candidate.assigneeUserId,
          completedAt: `${candidate.signalDate}T18:00:00.000Z`,
          notes: candidate.reason,
        }),
      });
      const body = (await res.json()) as { error?: string; caseStageUpdated?: string | null };
      if (!res.ok) throw new Error(body.error ?? "Confirm failed");
      setNeedsConfirm((prev) => prev.filter((c) => c.id !== candidate.id));
      setMessage(
        body.caseStageUpdated
          ? `Confirmed ${candidate.label} on ${candidate.caseNumber} — case stage set to ${body.caseStageUpdated}.`
          : `Confirmed ${candidate.label} on ${candidate.caseNumber}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(candidate: AutoProgressCandidate) {
    if (!personId) return;
    if (
      !window.confirm(
        "Dismiss this item? It won’t count toward this week. Use this when it isn’t done and won’t be completed.",
      )
    ) {
      return;
    }
    setBusyId(candidate.id);
    setError(null);
    try {
      const res = await fetch("/api/performance/dismiss-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate.id,
          caseId: candidate.caseId,
          caseNumber: candidate.caseNumber,
          clientName: candidate.clientName,
          deliverableType: candidate.deliverableType,
          deliverableId: candidate.deliverableId,
          docketEventId: candidate.docketEventId,
          stageSuggestionId: candidate.stageSuggestionId,
          eventTitle: candidate.label,
          attorneyUserId: candidate.attorneyUserId,
          assigneeUserId: candidate.assigneeUserId,
          reason: "Dismissed from weekly goal progress — not completed",
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Dismiss failed");

      const dismissed = readDismissedIds(personId, weekStart);
      dismissed.add(candidate.id);
      writeDismissedIds(personId, weekStart, dismissed);

      setNeedsConfirm((prev) => prev.filter((c) => c.id !== candidate.id));
      setMessage(`Dismissed ${candidate.label} on ${candidate.caseNumber}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dismiss failed");
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
            disbursements. Items that need verification stay here until you confirm or dismiss.
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

        {needsConfirm.map((candidate) => {
          const busy = busyId === candidate.id;
          const evidenceText = candidate.evidenceExcerpt?.trim() || candidate.reason;
          return (
            <div
              key={candidate.id}
              className="flex flex-col gap-3 border-b py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="font-medium">
                  {candidate.caseNumber} — {candidate.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  {candidate.clientName} · {candidate.signalDate}
                </div>
                {evidenceText || candidate.evidenceUrl ? (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {evidenceText}
                    {candidate.evidenceUrl ? (
                      <>
                        {evidenceText ? " " : null}
                        {candidate.evidenceUrl.startsWith("/") ? (
                          <Link
                            href={candidate.evidenceUrl}
                            className="inline-flex items-center gap-0.5 whitespace-nowrap font-medium text-pink-600 hover:underline"
                          >
                            {evidenceLinkLabel(candidate)}
                            <ExternalLink className="h-3 w-3" aria-hidden />
                          </Link>
                        ) : (
                          <a
                            href={candidate.evidenceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 whitespace-nowrap font-medium text-pink-600 hover:underline"
                          >
                            {evidenceLinkLabel(candidate)}
                            <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        )}
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => void confirm(candidate)}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Confirm complete
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void dismiss(candidate)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          );
        })}

        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
