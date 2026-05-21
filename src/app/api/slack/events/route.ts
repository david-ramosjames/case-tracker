import crypto from "crypto";
import { NextResponse } from "next/server";
import { findCaseNumberByReminderThread } from "@/lib/slack/channels";
import { getSlackSigningSecret, isSlackEnabled } from "@/lib/slack/config";
import { postSlackMessage } from "@/lib/slack/client";
import { applySlackThreadUpdate } from "@/lib/supabase/services";

type SlackEventPayload = {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    subtype?: string;
    text?: string;
    channel?: string;
    user?: string;
    thread_ts?: string;
    ts?: string;
    bot_id?: string;
  };
};

function verifySlackSignature(rawBody: string, timestamp: string | null, signature: string | null) {
  const secret = getSlackSigningSecret();
  if (!secret || !timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${crypto.createHmac("sha256", secret).update(base).digest("hex")}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as SlackEventPayload;

  if (payload.type === "url_verification" && payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (!isSlackEnabled()) {
    return NextResponse.json({ ok: true });
  }

  const event = payload.event;
  if (event?.type === "message" && event.thread_ts && event.text && !event.bot_id && !event.subtype) {
    const mapping = await findCaseNumberByReminderThread(event.thread_ts);
    if (mapping?.caseId) {
      const result = await applySlackThreadUpdate(mapping.caseId, event.text, { userName: "Slack thread" });
      if (result.applied) {
        await postSlackMessage({
          channel: event.channel ?? "",
          threadTs: event.thread_ts,
          text: `Thanks — applied tracker update from thread: ${result.fields.join(", ")}.`,
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
