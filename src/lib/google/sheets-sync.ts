import { cleanCaseNumber, parseSheetDate } from "@/lib/csv/parse";
import { fetchGoogleSheetValues, findSheetColumnIndex } from "@/lib/google/client";
import { normalizeSlackChannelId } from "@/lib/slack/client";
import { getGoogleSheetsConfig, getGoogleSheetsRange, isGoogleSheetsSyncConfigured } from "@/lib/slack/config";
import { upsertSlackChannels } from "@/lib/slack/channels";
import { syncDateSignedFromSheet } from "@/lib/supabase/services";

export type SheetSyncResult = {
  synced: number;
  configured: boolean;
  duplicatesRemoved?: number;
  dateSignedUpdated?: number;
};

/** Reads your Google Sheet and upserts case_number → Slack channel rows. No manual entry in the app. */
export async function syncSlackChannelsFromGoogleSheetIfConfigured(): Promise<SheetSyncResult> {
  if (!isGoogleSheetsSyncConfigured()) {
    return { synced: 0, configured: false };
  }
  const { synced, duplicatesRemoved, dateSignedUpdated } = await syncSlackChannelsFromGoogleSheet();
  return { synced, configured: true, duplicatesRemoved, dateSignedUpdated };
}

export async function syncSlackChannelsFromGoogleSheet() {
  const config = getGoogleSheetsConfig();
  if (!config) {
    throw new Error("Google Sheets sync is not configured. Set GOOGLE_SHEETS_SPREADSHEET_ID and service account env vars.");
  }

  const rows = await fetchGoogleSheetValues(config.spreadsheetId, getGoogleSheetsRange(), config);
  if (rows.length < 2) return { synced: 0, dateSignedUpdated: 0 };

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  // Client Contact Status: A Slack Channel, B Case No, … F Status, G Slack Channel ID, H Date Created (Date Signed)
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

  const mapped = [];
  const dateSignedEntries: Array<{ caseNumber: string; dateSigned: string }> = [];
  for (const row of rows.slice(1)) {
    const caseNumber = cleanCaseNumber(row[caseIdx] ?? "");
    const channelName = (row[channelIdx] ?? "").trim();
    if (!caseNumber || !channelName) continue;

    const channelIdRaw = channelIdIdx >= 0 ? (row[channelIdIdx] ?? "").trim() : "";
    const slackChannelId = normalizeSlackChannelId(channelIdRaw);

    mapped.push({
      caseNumber,
      slackChannelId,
      slackChannelName: channelName.replace(/^#/, ""),
      topicStage: statusIdx >= 0 ? row[statusIdx]?.trim() || null : null,
    });

    if (dateSignedIdx >= 0) {
      const dateSigned = parseSheetDate(row[dateSignedIdx] ?? "");
      if (dateSigned) dateSignedEntries.push({ caseNumber, dateSigned });
    }
  }

  const { synced, duplicatesRemoved } = await upsertSlackChannels(mapped);
  const dateSignedUpdated =
    dateSignedEntries.length > 0 ? (await syncDateSignedFromSheet(dateSignedEntries)).updated : 0;
  return { synced, duplicatesRemoved, dateSignedUpdated };
}
