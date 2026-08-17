import crypto from "crypto";

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

export async function getGoogleAccessToken(clientEmail: string, privateKey: string) {
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

export async function fetchGoogleSheetValues(spreadsheetId: string, range: string, credentials: {
  clientEmail: string;
  privateKey: string;
}) {
  const token = await getGoogleAccessToken(credentials.clientEmail, credentials.privateKey);

  // Unbounded column ranges (Sheet1!A:H) — read in row chunks so large sheets aren't truncated.
  const chunked = await fetchGoogleSheetValuesChunked(spreadsheetId, range, token, credentials.clientEmail);
  if (chunked) return chunked;

  return fetchGoogleSheetValuesOnce(spreadsheetId, range, token, credentials.clientEmail);
}

const SHEET_READ_MAX_ATTEMPTS = 4;
const SHEET_READ_RETRY_DELAYS_MS = [500, 1500, 3500];

function isTransientSheetsFailure(status: number, message: string) {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  return /currently unavailable|backend error|rate limit|too many requests|internal error/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGoogleSheetValuesOnce(
  spreadsheetId: string,
  range: string,
  token: string,
  clientEmail: string,
) {
  const encodedRange = encodeURIComponent(range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= SHEET_READ_MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    let body: { values?: string[][]; error?: { message?: string; status?: string } } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      body = { error: { message: `HTTP ${response.status}` } };
    }

    if (response.ok) return body.values ?? [];

    const detail = body.error?.message ?? "Unable to read Google Sheet.";
    if (/permission/i.test(detail)) {
      throw new Error(
        `${detail} Share spreadsheet ${spreadsheetId} with ${clientEmail} as Viewer, and enable the Google Sheets API in Google Cloud.`,
      );
    }

    lastError = new Error(`${detail} (spreadsheet ${spreadsheetId}, range ${range})`);
    const delay = SHEET_READ_RETRY_DELAYS_MS[attempt - 1];
    if (!delay || !isTransientSheetsFailure(response.status, detail)) {
      throw lastError;
    }

    console.warn("Google Sheets read retry", {
      attempt,
      nextAttempt: attempt + 1,
      delayMs: delay,
      status: response.status,
      range,
      message: detail,
    });
    await sleep(delay);
  }

  throw lastError ?? new Error(`Unable to read Google Sheet (spreadsheet ${spreadsheetId}, range ${range})`);
}

/** Parse `Sheet1!A:H` / `Sheet1!A1:H` into sheet + columns for chunked reads. */
function parseOpenColumnRange(range: string): { sheet: string; startCol: string; endCol: string } | null {
  const trimmed = range.trim();
  // Sheet1!A:H or 'My Sheet'!A:H or Sheet1!A1:H (open-ended end row)
  const match = trimmed.match(/^((?:'[^']+'|[^!]+))!([A-Za-z]+)(\d*):([A-Za-z]+)(\d*)$/);
  if (!match) return null;
  const [, sheet, startCol, , endCol, endRow] = match;
  if (endRow) return null;
  return { sheet, startCol, endCol };
}

const SHEET_READ_CHUNK_ROWS = 500;

async function fetchGoogleSheetValuesChunked(
  spreadsheetId: string,
  range: string,
  token: string,
  clientEmail: string,
): Promise<string[][] | null> {
  const parsed = parseOpenColumnRange(range);
  if (!parsed) return null;

  const all: string[][] = [];
  let startRow = 1;
  // Safety cap: 20 chunks × 500 = 10k rows
  for (let chunk = 0; chunk < 20; chunk++) {
    const endRow = startRow + SHEET_READ_CHUNK_ROWS - 1;
    const chunkRange = `${parsed.sheet}!${parsed.startCol}${startRow}:${parsed.endCol}${endRow}`;
    const rows = await fetchGoogleSheetValuesOnce(spreadsheetId, chunkRange, token, clientEmail);
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < SHEET_READ_CHUNK_ROWS) break;
    startRow = endRow + 1;
  }
  return all;
}

export function findSheetColumnIndex(header: string[], matchers: Array<(cell: string) => boolean>) {
  for (const match of matchers) {
    const index = header.findIndex(match);
    if (index >= 0) return index;
  }
  return -1;
}
