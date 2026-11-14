"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type PerformanceWeekPair } from "@/lib/performance/week-pair-types";
import { type AppUser } from "@/lib/types";

type SeatDraft = {
  seatIndex: number;
  paralegalContactId: string;
  attorneyContactId: string;
  paralegalLabel: string;
  attorneyLabel: string;
};

function toDrafts(pairs: PerformanceWeekPair[]): SeatDraft[] {
  if (pairs.length === 0) {
    return Array.from({ length: 4 }, (_, i) => ({
      seatIndex: i,
      paralegalContactId: "",
      attorneyContactId: "",
      paralegalLabel: "TBD",
      attorneyLabel: "TBD",
    }));
  }
  return pairs.map((pair) => ({
    seatIndex: pair.seatIndex,
    paralegalContactId: pair.paralegalContactId ?? "",
    attorneyContactId: pair.attorneyContactId ?? "",
    paralegalLabel: pair.paralegalLabel ?? "TBD",
    attorneyLabel: pair.attorneyLabel ?? "TBD",
  }));
}

export function WeekPairsEditor({
  weekStart,
  initialPairs,
  paralegals,
  attorneys,
}: {
  weekStart: string;
  initialPairs: PerformanceWeekPair[];
  paralegals: AppUser[];
  attorneys: AppUser[];
}) {
  const [drafts, setDrafts] = useState(() => toDrafts(initialPairs));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/performance/week-pairs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart,
          seats: drafts.map((d) => ({
            seatIndex: d.seatIndex,
            paralegalContactId: d.paralegalContactId || null,
            attorneyContactId: d.attorneyContactId || null,
            paralegalLabel: d.paralegalContactId ? null : d.paralegalLabel || "TBD",
            attorneyLabel: d.attorneyContactId ? null : d.attorneyLabel || "TBD",
          })),
        }),
      });
      const body = (await res.json()) as { pairs?: PerformanceWeekPair[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      if (body.pairs) setDrafts(toDrafts(body.pairs));
      setMessage("Weekly pairs saved. One TBD keeps the seat; both TBD marks it vacant (no work expected).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyPrevious() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/performance/week-pairs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart, copyFromPrevious: true }),
      });
      const body = (await res.json()) as { pairs?: PerformanceWeekPair[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Copy failed");
      if (body.pairs) setDrafts(toDrafts(body.pairs));
      setMessage("Copied last week’s pairs into this week — edit seats as needed, then save.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
    } finally {
      setBusy(false);
    }
  }

  function addSeat() {
    setDrafts((prev) => [
      ...prev,
      {
        seatIndex: prev.length,
        paralegalContactId: "",
        attorneyContactId: "",
        paralegalLabel: "TBD",
        attorneyLabel: "TBD",
      },
    ]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>This week’s pairs</CardTitle>
        <CardDescription>
          Week of {weekStart}. Seats automatically continue from last week — you only need to edit when a team
          changes. One TBD is still a team; TBD + TBD is vacant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {drafts.map((draft, index) => {
          const vacant =
            !draft.paralegalContactId &&
            !draft.attorneyContactId &&
            (draft.paralegalLabel || "TBD").toUpperCase() === "TBD" &&
            (draft.attorneyLabel || "TBD").toUpperCase() === "TBD";
          return (
            <div
              key={draft.seatIndex}
              className={`grid gap-2 rounded-md border p-3 md:grid-cols-3 ${vacant ? "border-dashed bg-slate-50" : ""}`}
            >
              <div className="text-xs font-medium text-muted-foreground md:col-span-3">
                Seat {index + 1}
                {vacant ? " · vacant (both TBD)" : ""}
              </div>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Paralegal</span>
                <select
                  className="w-full rounded-md border px-3 py-2"
                  value={draft.paralegalContactId}
                  onChange={(e) =>
                    setDrafts((cur) =>
                      cur.map((row) =>
                        row.seatIndex === draft.seatIndex
                          ? { ...row, paralegalContactId: e.target.value, paralegalLabel: e.target.value ? "" : "TBD" }
                          : row,
                      ),
                    )
                  }
                >
                  <option value="">TBD</option>
                  {paralegals.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Attorney</span>
                <select
                  className="w-full rounded-md border px-3 py-2"
                  value={draft.attorneyContactId}
                  onChange={(e) =>
                    setDrafts((cur) =>
                      cur.map((row) =>
                        row.seatIndex === draft.seatIndex
                          ? { ...row, attorneyContactId: e.target.value, attorneyLabel: e.target.value ? "" : "TBD" }
                          : row,
                      ),
                    )
                  }
                >
                  <option value="">TBD</option>
                  {attorneys.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || drafts.length <= 1}
                  onClick={() =>
                    setDrafts((cur) =>
                      cur
                        .filter((row) => row.seatIndex !== draft.seatIndex)
                        .map((row, i) => ({ ...row, seatIndex: i })),
                    )
                  }
                >
                  Remove seat
                </Button>
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void copyPrevious()}>
            Copy last week
          </Button>
          <Button variant="outline" disabled={busy} onClick={addSeat}>
            Add seat
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save this week’s pairs
          </Button>
        </div>
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
