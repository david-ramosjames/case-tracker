/**
 * Minimal Dropbox API client for read-only thumbnail proxying.
 * Uses the same Dropbox app as the file-sorter (DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN).
 * Optional: DROPBOX_TEAM_MEMBER_ID for team-scoped tokens, DROPBOX_ROOT_NAMESPACE_ID to skip root detection.
 */

export const DROPBOX_THUMBNAIL_SIZES = ["w256h256", "w480h320", "w1024h768", "w2048h1536"] as const;
export type DropboxThumbnailSize = (typeof DROPBOX_THUMBNAIL_SIZES)[number];

let cachedToken: { value: string; expiresAt: number } | null = null;
let cachedRootNamespaceId: string | null | undefined;

export function isDropboxConfigured() {
  return Boolean(
    process.env.DROPBOX_REFRESH_TOKEN?.trim() &&
      process.env.DROPBOX_APP_KEY?.trim() &&
      process.env.DROPBOX_APP_SECRET?.trim(),
  );
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN!.trim(),
      client_id: process.env.DROPBOX_APP_KEY!.trim(),
      client_secret: process.env.DROPBOX_APP_SECRET!.trim(),
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Dropbox token refresh failed (${response.status}): ${await response.text()}`);
  }
  const json = (await response.json()) as { access_token: string; expires_in?: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 14_400) * 1000 };
  return cachedToken.value;
}

function baseHeaders(token: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const teamMemberId = process.env.DROPBOX_TEAM_MEMBER_ID?.trim();
  if (teamMemberId) headers["Dropbox-API-Select-User"] = teamMemberId;
  return headers;
}

/** Team spaces: case folders live under the team root namespace, not the member's home namespace. */
async function getRootNamespaceId(token: string) {
  if (cachedRootNamespaceId !== undefined) return cachedRootNamespaceId;
  const configured = process.env.DROPBOX_ROOT_NAMESPACE_ID?.trim();
  if (configured) {
    cachedRootNamespaceId = configured;
    return configured;
  }

  const response = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers: baseHeaders(token),
    cache: "no-store",
  });
  if (!response.ok) {
    cachedRootNamespaceId = null;
    return null;
  }
  const account = (await response.json()) as {
    root_info?: { root_namespace_id?: string; home_namespace_id?: string };
  };
  const root = account.root_info?.root_namespace_id ?? null;
  cachedRootNamespaceId = root && root !== account.root_info?.home_namespace_id ? root : null;
  return cachedRootNamespaceId;
}

async function requestThumbnail(token: string, path: string, size: DropboxThumbnailSize) {
  const headers = baseHeaders(token);
  const rootNamespaceId = await getRootNamespaceId(token);
  if (rootNamespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "root", root: rootNamespaceId });
  }
  headers["Dropbox-API-Arg"] = JSON.stringify({
    resource: { ".tag": "path", path },
    format: "jpeg",
    size,
    mode: "fitone_bestfit",
  }).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

  return fetch("https://content.dropboxapi.com/2/files/get_thumbnail_v2", {
    method: "POST",
    headers,
    cache: "no-store",
  });
}

/** Streams a JPEG thumbnail (Dropbox converts HEIC/PNG/WEBP). Tries the stable file id, then the path. */
export async function fetchDropboxThumbnail(
  file: { dropboxFileId: string; dropboxPath: string },
  size: DropboxThumbnailSize,
) {
  const token = await getAccessToken();
  let response = await requestThumbnail(token, file.dropboxFileId, size);
  if (!response.ok && file.dropboxPath) {
    response = await requestThumbnail(token, file.dropboxPath, size);
  }
  if (!response.ok) {
    throw new Error(`Dropbox thumbnail failed (${response.status}): ${await response.text()}`);
  }
  return response;
}
