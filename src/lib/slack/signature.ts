import crypto from "crypto";
import { getSlackSigningSecret } from "@/lib/slack/config";

const MAX_REQUEST_AGE_SECONDS = 60 * 5;

/** Verify Slack's v0 request signature (Events API, interactivity, Slackbot MCP calls). */
export function verifySlackSignature(rawBody: string, timestamp: string | null, signature: string | null) {
  const secret = getSlackSigningSecret();
  if (!secret || !timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_REQUEST_AGE_SECONDS) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${crypto.createHmac("sha256", secret).update(base).digest("hex")}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}
