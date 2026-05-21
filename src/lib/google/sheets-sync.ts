import crypto from "crypto";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { getGoogleSheetsConfig, getGoogleSheetsRange, isGoogleSheetsSyncConfigured } from "@/lib/slack/config";
import { upsertSlackChannels } from "@/lib/slack/channels";

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

async function getGoogleAccessToken(clientEmail: string, privateKey: string) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const body = (await response.json()) as { access_token?: string; error?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error ?? "Unable to obtain Google access token.");
  }
  return body.access_token;
}

export type SheetSyncResult = { synced: number; configured: boolean };

/** Reads your Google Sheet and upserts case_number → Slack channel rows. No manual entry in the app. */
export async function syncSlackChannelsFromGoogleSheetIfConfigured(): Promise<SheetSyncResult> {
  if (!isGoogleSheetsSyncConfigured()) {
    return { synced: 0, configured: false };
  }
  const { synced } = await syncSlackChannelsFromGoogleSheet();
  return { synced, configured: true };
}

export async function syncSlackChannelsFromGoogleSheet() {
  const config = getGoogleSheetsConfig();
  if (!config) {
    throw new Error("Google Sheets sync is not configured. Set GOOGLE_SHEETS_SPREADSHEET_ID and service account env vars.");
  }

  const token = await getGoogleAccessToken(config.clientEmail, config.privateKey);
  const range = encodeURIComponent(getGoogleSheetsRange());
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${range}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as { values?: string[][]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to read Google Sheet.");

  const rows = body.values ?? [];
  if (rows.length < 2) return { synced: 0 };

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  // Client Contact Status layout: A Slack Channel, B Case No, C Case, D Lead Attorney, E Paralegal, F Status
  const caseIdx = findSheetColumnIndex(header, [
    (cell) => /case\s*(#|no|number)/.test(cell),
    (cell) => cell === "case no" || cell === "case #",
  ]);
  const channelIdx = findSheetColumnIndex(header, [
    (cell) => cell.includes("slack") && cell.includes("channel"),
    (cell) => cell.includes("slack"),
    (cell) => cell === "channel",
  ]);
  const statusIdx = findSheetColumnIndex(header, [
    (cell) => cell === "status",
    (cell) => cell.includes("status") && !cell.includes("email"),
    (cell) => cell.includes("stage"),
  ]);

  if (caseIdx === -1 || channelIdx === -1) {
    throw new Error('Sheet must include "Case No" and "Slack Channel" columns (see Client Contact Status / Sheet1).');
  }

  // Sheet → database only. Channel names come from column A; Slack IDs are resolved later when posting.
  const mapped = [];
  for (const row of rows.slice(1)) {
    const caseNumber = cleanCaseNumber(row[caseIdx] ?? "");
    const channelName = (row[channelIdx] ?? "").trim();
    if (!caseNumber || !channelName) continue;

    mapped.push({
      caseNumber,
      slackChannelId: null,
      slackChannelName: channelName.replace(/^#/, ""),
      topicStage: statusIdx >= 0 ? row[statusIdx]?.trim() || null : null,
    });
  }

  const synced = await upsertSlackChannels(mapped);
  return { synced };
}

function findSheetColumnIndex(header: string[], matchers: Array<(cell: string) => boolean>) {
  for (const match of matchers) {
    const index = header.findIndex(match);
    if (index >= 0) return index;
  }
  return -1;
}
