import { buildViewerContext, filterRecordsForViewer } from "@/lib/auth/access";
import { requireSessionUser } from "@/lib/auth/session";
import {
  getAttorneyGoals,
  getCases,
  getSettings,
  getUsers,
} from "@/lib/supabase/services";

export async function loadViewerCaseBundle() {
  const sessionUser = await requireSessionUser();
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
