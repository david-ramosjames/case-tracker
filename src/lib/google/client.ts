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
  const encodedRange = encodeURIComponent(range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as { values?: string[][]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to read Google Sheet.");
  return body.values ?? [];
}

export function findSheetColumnIndex(header: string[], matchers: Array<(cell: string) => boolean>) {
  for (const match of matchers) {
    const index = header.findIndex(match);
    if (index >= 0) return index;
  }
  return -1;
}
