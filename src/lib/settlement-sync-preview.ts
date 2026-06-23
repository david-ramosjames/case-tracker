/** Client-safe helper — keep separate from settlements-sync/services (server imports). */
export function filterSettlementSyncPreviewDetails<T extends { status: string; changes?: string[] }>(
  details: T[],
): T[] {
  return details.filter((detail) => detail.status === "synced" && (detail.changes?.length ?? 0) > 0);
}
