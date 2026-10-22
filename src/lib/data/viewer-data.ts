import { redirect } from "next/navigation";
import { buildViewerContext, filterRecordsForViewer } from "@/lib/auth/access";
import { getSessionUser } from "@/lib/auth/session";
import {
  getAttorneyGoals,
  getCases,
  getSettings,
  getUsers,
} from "@/lib/supabase/services";

/** Session, staff, and goals — no full case list. Use this on a single-case page. */
export async function loadViewerDirectory() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  const [users, goals] = await Promise.all([getUsers(), getAttorneyGoals()]);
  return { sessionUser, users, goals };
}

export async function loadViewerCaseBundle() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  const [allRecords, users, settings, goals] = await Promise.all([
    getCases(),
    getUsers(),
    getSettings(),
    getAttorneyGoals(),
  ]);

  const viewer = buildViewerContext(sessionUser, users);
  const records = filterRecordsForViewer(allRecords, sessionUser, users, goals);

  return { sessionUser, records, allRecords, users, settings, goals, viewer };
}
