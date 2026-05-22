import crypto from "crypto";
import { NextResponse } from "next/server";
import { findCaseForSlackThread } from "@/lib/slack/channels";
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

const IGNORED_MESSAGE_SUBTYPES = new Set([
  "message_changed",
  "message_deleted",
  "channel_join",
  "channel_leave",
  "channel_archive",
  "channel_unarchive",
  "group_join",
  "group_leave",
]);

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

type SlackThreadReplyEvent = NonNullable<SlackEventPayload["event"]> & {
  thread_ts: string;
  channel: string;
  text: string;
};

function isUserThreadReply(event: SlackEventPayload["event"]): event is SlackThreadReplyEvent {
  if (!event || event.type !== "message" || !event.thread_ts || !event.text?.trim() || event.bot_id) {
    return false;
  }
  if (event.subtype && IGNORED_MESSAGE_SUBTYPES.has(event.subtype)) return false;
  return true;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");

  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.type === "url_verification" && payload.challenge) {
    if (!verifySlackSignature(rawBody, timestamp, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!isSlackEnabled()) {
    return NextResponse.json({ ok: true });
  }

  const event = payload.event;
  if (!isUserThreadReply(event)) {
    return NextResponse.json({ ok: true });
  }

  const mapping = await findCaseForSlackThread(event.channel, event.thread_ts);
  if (!mapping?.caseId) {
    console.warn("Slack thread reply: no case linked to thread", {
      channel: event.channel,
      threadTs: event.thread_ts,
    });
    await postSlackMessage({
      channel: event.channel,
      threadTs: event.thread_ts,
      text: "Could not link this thread to a case reminder. Ask an admin to re-send the reminder from the case tracker.",
    }).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await applySlackThreadUpdate(mapping.caseId, event.text, { userName: "Slack thread" });
    if (result.applied) {
      await postSlackMessage({
        channel: event.channel,
        threadTs: event.thread_ts,
        text: `Thanks — applied tracker update: ${result.fields.join(", ")}.`,
      });
    } else {
      await postSlackMessage({
        channel: event.channel,
        threadTs: event.thread_ts,
        text: `Could not apply update — ${result.reason ?? "use lines like Quarter: 2026 Q3, Minimum: 75000, Sources: …"}`,
      });
    }
  } catch (error) {
    console.error("Slack thread apply failed", error);
    await postSlackMessage({
      channel: event.channel,
      threadTs: event.thread_ts,
      text: "Something went wrong saving to the case tracker. Try again or update the case in the app.",
    }).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}
