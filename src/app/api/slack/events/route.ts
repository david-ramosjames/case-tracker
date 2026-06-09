import crypto from "crypto";
import { NextResponse } from "next/server";
import { findCaseForSlackThread } from "@/lib/slack/channels";
import { postSlackMessage } from "@/lib/slack/client";
import { getSlackSigningSecret, isSlackEnabled } from "@/lib/slack/config";
import {
  handleStageConfirmationReaction,
  handleStageConfirmationReply,
} from "@/lib/slack/stage-confirmation";
import { formatSlackThreadAppliedMessage, parseSlackThreadUpdate } from "@/lib/slack/thread-update";
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
    reaction?: string;
    item?: {
      type?: string;
      channel?: string;
      ts?: string;
    };
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

type SlackReactionEvent = NonNullable<SlackEventPayload["event"]> & {
  reaction: string;
  item: { channel: string; ts: string };
};

function isReactionAdded(event: SlackEventPayload["event"]): event is SlackReactionEvent {
  return Boolean(
    event?.type === "reaction_added" &&
      event.reaction &&
      event.item?.channel &&
      event.item?.ts &&
      !event.bot_id,
  );
}

function stageDisplay(stage: string) {
  const labels: Record<string, string> = {
    Onboarding: "Onboarding",
    Txt: "Treatment",
    Dmd: "Demand",
    Lit: "Litigation",
    Settled: "Settled",
    Disengaged: "Disengaged",
    Terminated: "Terminated",
    Referred: "Referred",
  };
  return labels[stage] ?? stage;
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

  if (isReactionAdded(event)) {
    try {
      const result = await handleStageConfirmationReaction(event.item.ts, event.reaction, "Slack reaction");
      if (result.handled && result.action === "confirmed" && result.stage) {
        await postSlackMessage({
          channel: event.item.channel,
          threadTs: event.item.ts,
          text: `Updated case tracker: *${stageDisplay(result.stage)}*.`,
        }).catch(() => undefined);
      }
    } catch (error) {
      console.error("Slack stage confirmation reaction failed", error);
    }
    return NextResponse.json({ ok: true });
  }

  if (!isUserThreadReply(event)) {
    return NextResponse.json({ ok: true });
  }

  try {
    const stageResult = await handleStageConfirmationReply(event.thread_ts, event.text, "Slack thread");
    if (stageResult.handled) {
      if (stageResult.action === "confirmed" && stageResult.stage) {
        await postSlackMessage({
          channel: event.channel,
          threadTs: event.thread_ts,
          text: `Updated case tracker: *${stageDisplay(stageResult.stage)}*.`,
        });
      } else if (stageResult.action === "dismissed") {
        await postSlackMessage({
          channel: event.channel,
          threadTs: event.thread_ts,
          text: "Dismissed — no change to case tracker.",
        });
      }
      return NextResponse.json({ ok: true });
    }
  } catch (error) {
    console.error("Slack stage confirmation reply failed", error);
  }

  const mapping = await findCaseForSlackThread(event.channel, event.thread_ts);
  if (!mapping?.caseId) {
    return NextResponse.json({ ok: true });
  }

  const parsedUpdate = parseSlackThreadUpdate(event.text);
  if (!parsedUpdate) {
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await applySlackThreadUpdate(mapping.caseId, event.text, { userName: "Slack thread" });
    if (result.applied) {
      await postSlackMessage({
        channel: event.channel,
        threadTs: event.thread_ts,
        text: formatSlackThreadAppliedMessage(result.labels),
      });
    } else {
      await postSlackMessage({
        channel: event.channel,
        threadTs: event.thread_ts,
        text: `Could not apply update — ${result.reason ?? "use lines like Quarter: 2026 Q3, Minimum: 75000, Sources: …"}`,
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Slack thread apply failed", detail, error);
    await postSlackMessage({
      channel: event.channel,
      threadTs: event.thread_ts,
      text: "Something went wrong saving to the case tracker. Try again or update the case in the app.",
    }).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}
