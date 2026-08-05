"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type AppUser } from "@/lib/types";

type DraftRow = {
  slackUserId: string;
  slackDisplayName: string;
};

function draftsFromUsers(users: AppUser[]) {
  return Object.fromEntries(
    users.map((user) => [
      user.id,
      {
        slackUserId: user.slackUserId ?? "",
        slackDisplayName: user.slackDisplayName ?? "",
      },
    ]),
  ) as Record<string, DraftRow>;
}

export function UserRolesCard({ users: initialUsers }: { users: AppUser[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [drafts, setDrafts] = useState(() => draftsFromUsers(initialUsers));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateDraft(userId: string, patch: Partial<DraftRow>) {
    setDrafts((current) => ({
      ...current,
      [userId]: { ...current[userId], ...patch },
    }));
  }

  function isDirty(user: AppUser) {
    const draft = drafts[user.id];
    if (!draft) return false;
    return (
      (draft.slackUserId.trim() || "") !== (user.slackUserId ?? "") ||
      (draft.slackDisplayName.trim() || "") !== (user.slackDisplayName ?? "")
    );
  }

  async function saveUser(user: AppUser) {
    const draft = drafts[user.id];
    if (!draft) return;

    setSavingId(user.id);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/contacts/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slackUserId: draft.slackUserId,
          slackDisplayName: draft.slackDisplayName,
        }),
      });
      const body = (await response.json()) as { user?: AppUser; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Save failed.");

      const nextUser = body.user!;
      setUsers((current) => current.map((row) => (row.id === nextUser.id ? nextUser : row)));
      setDrafts((current) => ({
        ...current,
        [nextUser.id]: {
          slackUserId: nextUser.slackUserId ?? "",
          slackDisplayName: nextUser.slackDisplayName ?? "",
        },
      }));
      setMessage(`Saved Slack profile for ${nextUser.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Roles</CardTitle>
        <CardDescription>
          DocketFlow contacts used for case assignment. Set each person’s Slack user ID and display name for channel
          topics (`Attorney @Ryan`). Find IDs in Slack → profile → ⋯ → Copy member ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Slack display name</TableHead>
              <TableHead>Slack user ID</TableHead>
              <TableHead className="w-[6rem]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const draft = drafts[user.id] ?? { slackUserId: "", slackDisplayName: "" };
              const dirty = isDirty(user);
              return (
                <TableRow key={user.id}>
                  <TableCell className="font-semibold whitespace-nowrap">{user.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === "manager" || user.role === "admin" ? "pink" : "outline"}>
                      {user.role === "legal_assistant" ? "legal assistant" : user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Input
                      className="min-w-[7rem]"
                      placeholder="Ryan"
                      value={draft.slackDisplayName}
                      onChange={(event) => updateDraft(user.id, { slackDisplayName: event.target.value })}
                      disabled={savingId === user.id}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="min-w-[9rem] font-mono text-xs"
                      placeholder="U0123ABCD"
                      value={draft.slackUserId}
                      onChange={(event) => updateDraft(user.id, { slackUserId: event.target.value })}
                      disabled={savingId === user.id}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!dirty || savingId === user.id}
                      onClick={() => void saveUser(user)}
                    >
                      {savingId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Save
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
