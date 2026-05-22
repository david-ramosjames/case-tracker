export function isSlackEnabled() {
  return Boolean(process.env.SLACK_BOT_TOKEN?.trim());
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

export function getGoogleSheetsConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!spreadsheetId || !clientEmail || !privateKey) return null;
  return { spreadsheetId, clientEmail, privateKey };
}

export function isGoogleSheetsSyncConfigured() {
  return getGoogleSheetsConfig() !== null;
}

/** Client Contact Status tab: A Slack Channel, B Case No, … F Status, G Slack Channel ID (Sheet1!A:H) */
export function getGoogleSheetsRange() {
  return process.env.GOOGLE_SHEETS_CHANNEL_RANGE?.trim() || "Sheet1!A:H";
}

export const SLACK_REMINDER_COOLDOWN_DAYS = Number(process.env.SLACK_REMINDER_COOLDOWN_DAYS ?? 3);
export const SOURCES_LIT_REVIEW_DAYS = 90;
export const QUARTERLY_REVIEW_DAYS = 90;
