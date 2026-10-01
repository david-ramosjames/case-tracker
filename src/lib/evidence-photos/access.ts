import { canViewerAccessCase } from "@/lib/auth/access";
import { getEventAttorneyCaseIds } from "@/lib/auth/event-attorney";
import { type SessionUser } from "@/lib/auth/types";
import { getAttorneyGoals, getCaseById, getUsers } from "@/lib/supabase/services";

export type CasePhotoAccess = { caseNumber: string; canEdit: boolean };

const ACCESS_TTL_MS = 60_000;
const accessCache = new Map<string, { value: CasePhotoAccess | null; expiresAt: number }>();

/**
 * Photo access follows case access: assigned staff (and admins/managers) can view and edit;
 * event attorneys can view only. Cached briefly because the gallery fires one request per thumbnail.
 */
export async function getCasePhotoAccess(session: SessionUser, caseId: string): Promise<CasePhotoAccess | null> {
  const key = `${session.id}:${caseId}`;
  const cached = accessCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [record, users, goals] = await Promise.all([getCaseById(caseId), getUsers(), getAttorneyGoals()]);
  let value: CasePhotoAccess | null = null;
  if (record) {
    if (canViewerAccessCase(record, session, users, goals)) {
      value = { caseNumber: record.shared.caseNumber, canEdit: true };
    } else if ((await getEventAttorneyCaseIds(session, users)).has(record.shared.id)) {
      value = { caseNumber: record.shared.caseNumber, canEdit: false };
    }
  }

  accessCache.set(key, { value, expiresAt: Date.now() + ACCESS_TTL_MS });
  if (accessCache.size > 500) {
    const now = Date.now();
    for (const [entryKey, entry] of accessCache) {
      if (entry.expiresAt <= now) accessCache.delete(entryKey);
    }
  }
  return value;
}
