import { type AppUser } from "@/lib/types";

export function usersWithSlackIds(users: AppUser[]) {
  return users.filter((user) => Boolean(user.slackUserId?.trim()) && user.active !== false);
}

/** Visible @handle stored in the comment body (Slack ID is resolved separately). */
export function mentionHandleForUser(user: AppUser) {
  const handle = (user.slackDisplayName?.trim() || user.name.trim()).replace(/^@+/, "");
  return handle || user.name.trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve @handles in comment text to contact ids that have Slack user IDs. */
export function extractMentionContactIds(body: string, users: AppUser[]): string[] {
  const candidates = usersWithSlackIds(users)
    .map((user) => ({ user, handle: mentionHandleForUser(user) }))
    .filter((entry) => entry.handle.length > 0)
    .sort((left, right) => right.handle.length - left.handle.length);

  const found = new Set<string>();
  for (const { user, handle } of candidates) {
    const pattern = new RegExp(`(^|[^\\w@])@${escapeRegExp(handle)}(?=$|[^\\w])`, "i");
    if (pattern.test(body)) found.add(user.id);
  }
  return [...found];
}

export function filterMentionCandidates(users: AppUser[], query: string, priorityIds: string[] = []) {
  const needle = query.trim().toLowerCase();
  const priority = new Set(priorityIds);
  return usersWithSlackIds(users)
    .filter((user) => {
      if (!needle) return true;
      const handle = mentionHandleForUser(user).toLowerCase();
      return (
        handle.includes(needle) ||
        user.name.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle)
      );
    })
    .sort((left, right) => {
      const leftPriority = priority.has(left.id) ? 0 : 1;
      const rightPriority = priority.has(right.id) ? 0 : 1;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return mentionHandleForUser(left).localeCompare(mentionHandleForUser(right));
    });
}
