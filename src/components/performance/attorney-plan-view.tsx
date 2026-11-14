"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PersonSwitcher } from "@/components/performance/person-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ATTORNEY_PLAN_KINDS,
  type AttorneyPlanKind,
  type AttorneyPlanLine,
} from "@/lib/performance/types";
import { type AppUser } from "@/lib/types";

const KIND_META: Record<AttorneyPlanKind, { title: string; description: string }> = {
  lit_event: {
    title: "Lit events to kick-off scheduling",
    description: "Litigation events to request scheduling this week.",
  },
  lawsuit: {
    title: "Lawsuits to be filed",
    description: "Cases intended to be drafted and filed this week.",
  },
  settlement: {
    title: "Cases to settle",
    description: "Cases intended to settle this week.",
  },
};

type Props = {
  initialLines: AttorneyPlanLine[];
  weekStart: string;
  selectedAttorney: AppUser | null;
  attorneys: AppUser[];
  canBrowsePeople: boolean;
  caseOptions: Array<{ id: string; caseNumber: string; clientName: string }>;
};

export function AttorneyPlanView({
  initialLines,
  weekStart,
  selectedAttorney,
  attorneys,
  canBrowsePeople,
  caseOptions,
}: Props) {
  const [lines, setLines] = useState(initialLines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<AttorneyPlanKind, { caseId: string; label: string }>>({
    lit_event: { caseId: "", label: "" },
    lawsuit: { caseId: "", label: "" },
    settlement: { caseId: "", label: "" },
  });

  const byKind = useMemo(() => {
    const map: Record<AttorneyPlanKind, AttorneyPlanLine[]> = {
      lit_event: [],
      lawsuit: [],
      settlement: [],
    };
    for (const line of lines) map[line.kind].push(line);
    return map;
  }, [lines]);

  async function addLine(kind: AttorneyPlanKind) {
    if (!selectedAttorney) return;
    const draft = drafts[kind];
    const selected = caseOptions.find((c) => c.id === draft.caseId);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/performance/attorney-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attorneyContactId: selectedAttorney.id,
          weekStart,
          kind,
          caseId: draft.caseId || null,
          caseNumber: selected?.caseNumber ?? null,
          label: draft.label || selected?.clientName || "",
          sortOrder: byKind[kind].length,
        }),
      });
      const body = (await res.json()) as { line?: AttorneyPlanLine; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Add failed");
      if (body.line) setLines((prev) => [...prev, body.line!]);
      setDrafts((cur) => ({ ...cur, [kind]: { caseId: "", label: "" } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeLine(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/performance/attorney-plans?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Remove failed");
      setLines((prev) => prev.filter((line) => line.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy-950">
            Upcoming week — {selectedAttorney?.name ?? "Attorney"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Week of {weekStart}. Plans are intent only — they never change case status.
          </p>
        </div>
        {canBrowsePeople ? (
          <PersonSwitcher
            people={attorneys}
            selectedId={selectedAttorney?.id ?? null}
            basePath="/performance/attorney"
            label="Attorney"
          />
        ) : null}
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {ATTORNEY_PLAN_KINDS.map((kind) => {
        const meta = KIND_META[kind];
        const draft = drafts[kind];
        return (
          <Card key={kind}>
            <CardHeader>
              <CardTitle>{meta.title}</CardTitle>
              <CardDescription>{meta.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Case</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byKind[kind].map((line, index) => (
                    <TableRow key={line.id}>
                      <TableCell className="w-12">{index + 1}</TableCell>
                      <TableCell>
                        {line.caseId ? (
                          <Link
                            className="font-medium text-pink-700 hover:underline"
                            href={`/cases/${line.caseId}`}
                          >
                            {line.caseNumber ?? "Case"}
                          </Link>
                        ) : (
                          line.caseNumber ?? "—"
                        )}
                      </TableCell>
                      <TableCell>{line.label || "—"}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void removeLine(line.id)}>
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {byKind[kind].length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        Nothing planned yet.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>

              <div className="flex flex-wrap items-end gap-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Case</span>
                  <select
                    className="min-w-[14rem] rounded-md border px-3 py-2"
                    value={draft.caseId}
                    onChange={(e) =>
                      setDrafts((cur) => ({
                        ...cur,
                        [kind]: { ...draft, caseId: e.target.value },
                      }))
                    }
                  >
                    <option value="">Optional</option>
                    {caseOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.caseNumber} — {c.clientName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Label</span>
                  <Input
                    className="min-w-[14rem]"
                    value={draft.label}
                    onChange={(e) =>
                      setDrafts((cur) => ({
                        ...cur,
                        [kind]: { ...draft, label: e.target.value },
                      }))
                    }
                    placeholder="Depo — Dr. Kalra"
                  />
                </label>
                <Button
                  disabled={busy || !selectedAttorney || (!draft.caseId && !draft.label.trim())}
                  onClick={() => void addLine(kind)}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
