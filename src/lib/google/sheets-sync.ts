import { cleanCaseNumber, parseSheetDate } from "@/lib/csv/parse";
import { fetchGoogleSheetValues, findSheetColumnIndex } from "@/lib/google/client";
import { normalizeSlackChannelId } from "@/lib/slack/client";
import { loadSlackChannelMapByCaseNumber, upsertSlackChannels } from "@/lib/slack/channels";
import { getGoogleSheetsConfig, getGoogleSheetsRange, isGoogleSheetsSyncConfigured } from "@/lib/slack/config";
import {
  loadDateSignedOverridesByCaseNumber,
  sheetDateSignedMatchesOverride,
  syncDateSignedFromSheet,
} from "@/lib/supabase/services";

export type SheetSyncResult = {
  synced: number;
  configured: boolean;
  duplicatesRemoved?: number;
  dateSignedUpdated?: number;
  dryRun?: boolean;
};

export type SlackSheetSyncPreviewItem = {
  caseNumber: string;
  channelName: string;
  slackChannelId: string | null;
  topicStage: string | null;
  dateSigned: string | null;
  status: "new" | "update" | "unchanged";
  changes: string[];
};

export type SlackSheetSyncPreviewResult = SheetSyncResult & {
  previewItems: SlackSheetSyncPreviewItem[];
  wouldSync: number;
  dateSignedWouldUpdate: number;
};

type ParsedSlackChannelRow = {
  caseNumber: string;
  slackChannelId: string | null;
  slackChannelName: string;
  topicStage: string | null;
  dateSigned: string | null;
};

async function readSlackChannelRowsFromSheet(): Promise<{
  mapped: ParsedSlackChannelRow[];
  dateSignedEntries: Array<{ caseNumber: string; dateSigned: string }>;
  duplicatesRemoved: number;
}> {
  const config = getGoogleSheetsConfig();
  if (!config) {
    throw new Error("Google Sheets sync is not configured. Set GOOGLE_SHEETS_SPREADSHEET_ID and service account env vars.");
  }

  const rows = await fetchGoogleSheetValues(config.spreadsheetId, getGoogleSheetsRange(), config);
  if (rows.length < 2) return { mapped: [], dateSignedEntries: [], duplicatesRemoved: 0 };

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const caseIdx = findSheetColumnIndex(header, [
    (cell) => /case\s*(#|no|number)/.test(cell),
    (cell) => cell === "case no" || cell === "case #",
  ]);
  const channelIdx = findSheetColumnIndex(header, [
    (cell) => cell.includes("slack") && cell.includes("channel") && !cell.includes("id"),
    (cell) => cell === "slack channel",
    (cell) => cell.includes("slack") && !cell.includes("id"),
    (cell) => cell === "channel",
  ]);
  const channelIdIdx = findSheetColumnIndex(header, [
    (cell) => cell.includes("slack") && cell.includes("channel") && cell.includes("id"),
    (cell) => cell.includes("slack") && cell.includes("id"),
    (cell) => cell === "channel id" || cell === "slack channel id",
  ]);
  const statusIdx = findSheetColumnIndex(header, [
    (cell) => cell === "status",
    (cell) => cell.includes("status") && !cell.includes("email"),
    (cell) => cell.includes("stage"),
  ]);
  const dateSignedIdx = findSheetColumnIndex(header, [
    (cell) => cell.includes("date") && (cell.includes("created") || cell.includes("signed")),
    (cell) => cell === "date created" || cell === "date signed",
  ]);

  if (caseIdx === -1 || channelIdx === -1) {
    throw new Error('Sheet must include "Case No" and "Slack Channel" columns (see Client Contact Status / Sheet1).');
  }

  const rawMapped: Array<Omit<ParsedSlackChannelRow, "dateSigned">> = [];
  const dateSignedEntries: Array<{ caseNumber: string; dateSigned: string }> = [];
  for (const row of rows.slice(1)) {
    const caseNumber = cleanCaseNumber(row[caseIdx] ?? "");
    const channelName = (row[channelIdx] ?? "").trim();
    if (!caseNumber || !channelName) continue;

    const channelIdRaw = channelIdIdx >= 0 ? (row[channelIdIdx] ?? "").trim() : "";
    const slackChannelId = normalizeSlackChannelId(channelIdRaw);
    const dateSigned = dateSignedIdx >= 0 ? parseSheetDate(row[dateSignedIdx] ?? "") : null;

    rawMapped.push({
      caseNumber,
      slackChannelId,
      slackChannelName: channelName.replace(/^#/, ""),
      topicStage: statusIdx >= 0 ? row[statusIdx]?.trim() || null : null,
    });

    if (dateSigned) dateSignedEntries.push({ caseNumber, dateSigned });
  }

  const byCaseNumber = new Map<string, Omit<ParsedSlackChannelRow, "dateSigned">>();
  for (const row of rawMapped) {
    byCaseNumber.set(cleanCaseNumber(row.caseNumber), row);
  }
  const deduped = [...byCaseNumber.values()];
  const dateSignedByCase = new Map(dateSignedEntries.map((entry) => [cleanCaseNumber(entry.caseNumber), entry.dateSigned]));

  const mapped = deduped.map((row) => ({
    ...row,
    dateSigned: dateSignedByCase.get(cleanCaseNumber(row.caseNumber)) ?? null,
  }));

  return {
    mapped,
    dateSignedEntries,
    duplicatesRemoved: rawMapped.length - deduped.length,
  };
}

/** Preview channel sheet import without writing to Supabase. */
function dateSignedWouldChange(
  row: { caseNumber: string; dateSigned: string | null },
  overrides: Map<string, string | null>,
) {
  if (!row.dateSigned) return false;
  const key = cleanCaseNumber(row.caseNumber);
  return !sheetDateSignedMatchesOverride(row.dateSigned, overrides.get(key));
}

export async function previewSlackChannelsFromGoogleSheet(): Promise<SlackSheetSyncPreviewResult> {
  const { mapped, dateSignedEntries, duplicatesRemoved } = await readSlackChannelRowsFromSheet();
  const existing = await loadSlackChannelMapByCaseNumber();
  const dateSignedOverrides = await loadDateSignedOverridesByCaseNumber(mapped.map((row) => row.caseNumber));

  const previewItems: SlackSheetSyncPreviewItem[] = mapped.map((row) => {
    const prev = existing.get(cleanCaseNumber(row.caseNumber));
    const changes: string[] = [];
    const dateSignedChange = dateSignedWouldChange(row, dateSignedOverrides);

    if (!prev) {
      changes.push("new channel mapping");
      if (dateSignedChange) changes.push("date signed");
      return {
        caseNumber: row.caseNumber,
        channelName: row.slackChannelName,
        slackChannelId: row.slackChannelId,
        topicStage: row.topicStage,
        dateSigned: row.dateSigned,
        status: "new",
        changes,
      };
    }

    if (prev.slackChannelName !== row.slackChannelName) changes.push("channel name");
    if ((prev.slackChannelId ?? null) !== (row.slackChannelId ?? null)) changes.push("channel ID");
    if ((prev.topicStage ?? null) !== (row.topicStage ?? null)) changes.push("status");
    if (dateSignedChange) changes.push("date signed");

    return {
      caseNumber: row.caseNumber,
      channelName: row.slackChannelName,
      slackChannelId: row.slackChannelId,
      topicStage: row.topicStage,
      dateSigned: row.dateSigned,
      status: changes.length > 0 ? "update" : "unchanged",
      changes,
    };
  });

  const wouldSync = previewItems.filter((item) => item.status !== "unchanged").length;
  const dateSignedWouldUpdate = mapped.filter((row) => dateSignedWouldChange(row, dateSignedOverrides)).length;

  return {
    configured: true,
    dryRun: true,
    synced: wouldSync,
    duplicatesRemoved,
    dateSignedUpdated: 0,
    wouldSync,
    dateSignedWouldUpdate,
    previewItems,
  };
}

/** Reads your Google Sheet and upserts case_number → Slack channel rows. No manual entry in the app. */
export async function syncSlackChannelsFromGoogleSheetIfConfigured(options?: {
  dryRun?: boolean;
}): Promise<SheetSyncResult | SlackSheetSyncPreviewResult> {
  if (!isGoogleSheetsSyncConfigured()) {
    return { synced: 0, configured: false };
  }
  if (options?.dryRun) {
    return previewSlackChannelsFromGoogleSheet();
  }
  const { synced, duplicatesRemoved, dateSignedUpdated } = await syncSlackChannelsFromGoogleSheet();
  return { synced, configured: true, duplicatesRemoved, dateSignedUpdated };
}

export async function syncSlackChannelsFromGoogleSheet() {
  const { mapped, dateSignedEntries, duplicatesRemoved } = await readSlackChannelRowsFromSheet();
  const { synced } = await upsertSlackChannels(mapped);
  const dateSignedUpdated =
    dateSignedEntries.length > 0 ? (await syncDateSignedFromSheet(dateSignedEntries)).updated : 0;
  return { synced, duplicatesRemoved, dateSignedUpdated };
}
