export function isSlackEnabled() {
  return Boolean(process.env.SLACK_BOT_TOKEN?.trim());
}

/**
 * When true, Case Tracker rewrites the full structured Slack topic on stage /
 * language / Eve / assignment changes. Default off — use Settings admin button
 * to push topics manually until ready.
 */
export function isSlackTopicAutoSyncEnabled() {
  const raw = process.env.SLACK_TOPIC_AUTO_SYNC?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function getSlackBotToken() {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) throw new Error("SLACK_BOT_TOKEN is not configured.");
  return token;
}

export function getSlackSigningSecret() {
  return process.env.SLACK_SIGNING_SECRET?.trim() ?? "";
}

export function getCronSecret() {
  return process.env.CRON_SECRET?.trim() ?? "";
}

export function getGoogleSheetsCredentials() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) return null;
  return { clientEmail, privateKey };
}

export function getGoogleSheetsConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  const credentials = getGoogleSheetsCredentials();
  if (!spreadsheetId || !credentials) return null;
  return { spreadsheetId, ...credentials };
}

export function isGoogleSheetsSyncConfigured() {
  return getGoogleSheetsConfig() !== null;
}

export function getGoogleSheetsSettlementConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SETTLEMENT_SPREADSHEET_ID?.trim();
  const range = process.env.GOOGLE_SHEETS_SETTLEMENT_RANGE?.trim();
  const credentials = getGoogleSheetsCredentials();
  if (!spreadsheetId || !range || !credentials) return null;
  return { spreadsheetId, range, ...credentials };
}

export function isGoogleSheetsSettlementSyncConfigured() {
  return getGoogleSheetsSettlementConfig() !== null;
}

/** Client Contact Status tab: A Slack Channel, B Case No, … F Status, G Slack Channel ID, H Date Created (Sheet1!A:H) */
export function getGoogleSheetsRange() {
  return process.env.GOOGLE_SHEETS_CHANNEL_RANGE?.trim() || "Sheet1!A:H";
}

export const SLACK_REMINDER_COOLDOWN_DAYS = Number(process.env.SLACK_REMINDER_COOLDOWN_DAYS ?? 3);
export const SOURCES_LIT_REVIEW_DAYS = 90;
export const QUARTERLY_REVIEW_DAYS = 90;

export function getSmsApprovalSlackChannelId() {
  return process.env.SMS_APPROVAL_SLACK_CHANNEL_ID?.trim() ?? "";
}

export async function getDailyPulseChannelId() {
  const fromEnv = process.env.SLACK_DAILY_PULSE_CHANNEL_ID?.trim();
  if (fromEnv) return fromEnv;

  const name = process.env.SLACK_DAILY_PULSE_CHANNEL_NAME?.trim() || "daily-pulse";
  const { resolveSlackChannelId } = await import("@/lib/slack/client");
  return resolveSlackChannelId(name);
}
