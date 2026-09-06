import { redirect } from "next/navigation";
import { CaseExportView } from "@/components/export/case-export-view";
import { PageHeader } from "@/components/layout/page-header";
import { canViewCaseCsvExport } from "@/lib/auth/constants";
import { getSessionUser } from "@/lib/auth/session";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { dataRepository } from "@/lib/data/repository";
import { type TrackerComment } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CaseExportPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || !canViewCaseCsvExport(sessionUser.email)) {
    redirect("/");
  }

  const { records } = await loadViewerCaseBundle();
  const lookupIds = records.flatMap((record) => [record.shared.id, record.tracker.id].filter(Boolean));
  const commentsMap = await dataRepository.getCaseCommentsByCaseIds(lookupIds);

  const initialCommentsByCaseId: Record<string, TrackerComment[]> = {};
  for (const record of records) {
    const byShared = commentsMap.get(record.shared.id) ?? [];
    const byTracker = commentsMap.get(record.tracker.id) ?? [];
    const merged = new Map<string, TrackerComment>();
    for (const comment of [...byShared, ...byTracker]) {
      merged.set(comment.id, comment);
    }
    initialCommentsByCaseId[record.shared.id] = [...merged.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Case CSV export"
        description="Download case pipeline data as CSV. Defaults match the Cases table; add notes, results, and other case-page fields as needed."
      />
      <CaseExportView records={records} initialCommentsByCaseId={initialCommentsByCaseId} />
    </>
  );
}
