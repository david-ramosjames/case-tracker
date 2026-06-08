/** Canonical DocketFlow case page: `/cases/{caseId}`. */
export function getDocketFlowCaseUrl(caseId: string): string | null {
  const base = process.env.NEXT_PUBLIC_DOCKETFLOW_URL?.trim().replace(/\/$/, "");
  if (!base || !caseId) return null;
  return `${base}/cases/${caseId}`;
}
