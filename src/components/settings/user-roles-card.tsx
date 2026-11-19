"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUserRoleLabel } from "@/lib/auth/constants";
import {
  CONTACT_CAPABILITY_ROLES,
  contactRoleList,
  type ContactCapabilityRole,
  withToggledContactRole,
} from "@/lib/contacts/roles";
import { type AppUser } from "@/lib/types";

type DraftRow = {
  slackUserId: string;
  slackDisplayName: string;
  role: string;
  roles: string[];
};

function draftsFromUsers(users: AppUser[]) {
  return Object.fromEntries(
    users.map((user) => [
      user.id,
      {
        slackUserId: user.slackUserId ?? "",
        slackDisplayName: user.slackDisplayName ?? "",
        role: user.role,
        roles: contactRoleList(user),
      },
    ]),
  ) as Record<string, DraftRow>;
}

const ROLE_CHECKBOX_LABEL: Record<ContactCapabilityRole, string> = {
  attorney: "Attorney",
  paralegal: "Paralegal",
  legal_assistant: "Legal assistant",
  manager: "Manager",
};

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

  function toggleRole(user: AppUser, role: ContactCapabilityRole, enabled: boolean) {
    const draft = drafts[user.id];
    if (!draft) return;
    const next = withToggledContactRole(draft, role, enabled);
    updateDraft(user.id, next);
  }

  function isDirty(user: AppUser) {
    const draft = drafts[user.id];
    if (!draft) return false;
    const currentRoles = contactRoleList(user).slice().sort().join(",");
    const draftRoles = [...draft.roles].sort().join(",");
    return (
      (draft.slackUserId.trim() || "") !== (user.slackUserId ?? "") ||
      (draft.slackDisplayName.trim() || "") !== (user.slackDisplayName ?? "") ||
      draft.role !== user.role ||
      draftRoles !== currentRoles
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
          role: draft.role,
          roles: draft.roles,
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
          role: nextUser.role,
          roles: contactRoleList(nextUser),
        },
      }));
      setMessage(`Saved roles / Slack profile for ${nextUser.name}.`);
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
          DocketFlow contacts used for case assignment. Check every role a person can fill (e.g. Valeria as paralegal
          and legal assistant). Primary role is used for display; case seats match any checked role. Slack fields power
          channel topics (`Attorney @Ryan`).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Primary</TableHead>
              <TableHead>Slack display name</TableHead>
              <TableHead>Slack user ID</TableHead>
              <TableHead className="w-[6rem]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const draft = drafts[user.id] ?? {
                slackUserId: "",
                slackDisplayName: "",
                role: user.role,
                roles: contactRoleList(user),
              };
              const dirty = isDirty(user);
              return (
                <TableRow key={user.id}>
                  <TableCell className="font-semibold whitespace-nowrap">{user.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{user.email}</TableCell>
                  <TableCell>
                    <div className="flex min-w-[12rem] flex-col gap-1 py-1">
                      {CONTACT_CAPABILITY_ROLES.map((role) => (
                        <label key={role} className="flex items-center gap-2 text-xs font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={draft.roles.includes(role)}
                            disabled={savingId === user.id}
                            onChange={(event) => toggleRole(user, role, event.target.checked)}
                          />
                          {ROLE_CHECKBOX_LABEL[role]}
                        </label>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <select
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={draft.role}
                      disabled={savingId === user.id || draft.roles.length === 0}
                      onChange={(event) => updateDraft(user.id, { role: event.target.value })}
                    >
                      {draft.roles.map((role) => (
                        <option key={role} value={role}>
                          {formatUserRoleLabel(role)}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {draft.roles.map((role) => (
                        <Badge
                          key={role}
                          variant={
                            role === "manager" || role === "paralegal_manager" || role === "admin"
                              ? "pink"
                              : "outline"
                          }
                        >
                          {formatUserRoleLabel(role)}
                        </Badge>
                      ))}
                    </div>
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
