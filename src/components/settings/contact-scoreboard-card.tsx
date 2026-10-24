"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type AppUser, type CaseTrackerSettings } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

export function ContactScoreboardCard({
  settings,
  users,
}: {
  settings: CaseTrackerSettings;
  users: AppUser[];
}) {
  const attorneys = useMemo(
    () => users.filter((user) => user.role === "attorney").sort((left, right) => left.name.localeCompare(right.name)),
    [users],
  );
  const [selectedIds, setSelectedIds] = useState(() => {
    if (!settings.contactScoreboardAttorneyIds) return new Set(attorneys.map((attorney) => attorney.id));
    return new Set(settings.contactScoreboardAttorneyIds);
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleAttorney(attorneyId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(attorneyId)) next.delete(attorneyId);
      else next.add(attorneyId);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/contact-scoreboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attorneyIds: [...selectedIds] }),
      });
      const body = (await response.json()) as { error?: string; attorneyIds?: string[] };
      if (!response.ok) throw new Error(body.error ?? "Unable to save the scoreboard.");
      if (Array.isArray(body.attorneyIds)) setSelectedIds(new Set(body.attorneyIds));
      setMessage("Contact scoreboard saved.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact scoreboard</CardTitle>
        <CardDescription>Choose which attorneys appear on the Contact page scoreboard.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {attorneys.map((attorney) => (
            <label key={attorney.id} className="flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{attorney.name}</span>
              <input
                type="checkbox"
                checked={selectedIds.has(attorney.id)}
                onChange={() => toggleAttorney(attorney.id)}
                className="h-4 w-4 rounded border-gray-300"
              />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save scoreboard"
            )}
          </Button>
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
