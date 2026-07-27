import crypto from "crypto";
import { NextResponse } from "next/server";
import { findCaseForSlackThread } from "@/lib/slack/channels";
import { postSlackMessage } from "@/lib/slack/client";
import { getSlackSigningSecret, isSlackEnabled } from "@/lib/slack/config";
import {
  formatFieldReminderAppliedMessage,
  handleFieldReminderReaction,
  handleFieldReminderReply,
} from "@/lib/slack/field-confirmation";
import { handleSmsApprovalReaction, handleSmsApprovalReply } from "@/lib/sms/approval";
import {
  handleStageConfirmationReaction,
  handleStageConfirmationReply,
  handleStageUpdateNotificationReply,
} from "@/lib/slack/stage-confirmation";
import { claimSlackEventId, claimTopicApplyLock } from "@/lib/slack/event-dedupe";
import { applySlackChannelTopicChange } from "@/lib/slack/topic-inbound";
import { formatSlackThreadAppliedMessage, formatSlackThreadValidationErrors, parseSlackThreadUpdate } from "@/lib/slack/thread-update";
import { applySlackThreadUpdate } from "@/lib/supabase/services";

type SlackEventPayload = {
  type?: string;
  challenge?: string;
  event_id?: string;
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
    topic?: string;
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

type SlackTopicEvent = NonNullable<SlackEventPayload["event"]> & {
  channel: string;
  topic: string;
};

/**
 * Topic edits arrive either as:
 * - type `channel_topic` / `group_topic`, or more commonly
 * - type `message` with subtype `channel_topic` / `group_topic` (when subscribed to message.channels)
 */
function isChannelTopicChange(event: SlackEventPayload["event"]): event is SlackTopicEvent {
  if (!event?.channel || typeof event.topic !== "string") return false;

  if (event.type === "channel_topic" || event.type === "group_topic") {
    return true;
  }

  return (
    event.type === "message" &&
    (event.subtype === "channel_topic" || event.subtype === "group_topic")
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

  if (!claimSlackEventId(payload.event_id)) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const event = payload.event;

  if (isChannelTopicChange(event)) {
    if (!claimTopicApplyLock(event.channel, event.topic)) {
      console.info("Slack channel topic change skipped (in-flight duplicate)", {
        type: event.type,
        subtype: event.subtype,
        channel: event.channel,
        event_id: payload.event_id,
      });
      return NextResponse.json({ ok: true, deduped: true });
    }
    try {
      console.info("Slack channel topic change received", {
        type: event.type,
        subtype: event.subtype,
        channel: event.channel,
        topic: event.topic.slice(0, 200),
        user: event.user,
        event_id: payload.event_id,
      });
      const result = await applySlackChannelTopicChange({
        channelId: event.channel,
        topic: event.topic,
        userId: event.user,
      });
      console.info("Slack channel topic change result", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Slack channel topic sync failed", error);
      await postSlackMessage({
        channel: event.channel,
        text: [
          "Case Tracker failed while applying this topic change.",
          `*Nothing was updated* — ${message}`,
          "Try again, or update the case in Case Tracker directly.",
        ].join("\n"),
      }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true });
  }

  if (isReactionAdded(event)) {
    try {
      const smsResult = await handleSmsApprovalReaction(event.item.channel, event.item.ts, event.reaction);
      if (smsResult.handled) {
        return NextResponse.json({ ok: true });
      }

      const fieldResult = await handleFieldReminderReaction(event.item.ts, event.reaction, "Slack reaction");
      if (fieldResult.handled) {
        await postSlackMessage({
          channel: event.item.channel,
          threadTs: event.item.ts,
          text: formatFieldReminderAppliedMessage(fieldResult.fieldKey),
        }).catch(() => undefined);
        return NextResponse.json({ ok: true });
      }

      const result = await handleStageConfirmationReaction(event.item.ts, event.reaction, "Slack reaction");
      if (result.handled && result.action === "confirmed" && result.stage) {
        await postSlackMessage({
          channel: event.item.channel,
          threadTs: event.item.ts,
          text: `Updated case tracker: *${stageDisplay(result.stage)}*.`,
        }).catch(() => undefined);
      }
    } catch (error) {
      console.error("Slack confirmation reaction failed", error);
    }
    return NextResponse.json({ ok: true });
  }

  if (!isUserThreadReply(event)) {
    return NextResponse.json({ ok: true });
  }

  try {
    const smsResult = await handleSmsApprovalReply(event.channel, event.thread_ts, event.text);
    if (smsResult.handled) {
      return NextResponse.json({ ok: true });
    }

    const fieldResult = await handleFieldReminderReply(event.thread_ts, event.text, "Slack thread");
    if (fieldResult.handled) {
      if (fieldResult.action === "invalid") {
        await postSlackMessage({
          channel: event.channel,
          threadTs: event.thread_ts,
          text: fieldResult.message,
        });
      } else if (fieldResult.action === "dismissed") {
        await postSlackMessage({
          channel: event.channel,
          threadTs: event.thread_ts,
          text: "Dismissed — no change to case tracker.",
        });
      } else {
        await postSlackMessage({
          channel: event.channel,
          threadTs: event.thread_ts,
          text: formatFieldReminderAppliedMessage(
            fieldResult.fieldKey,
            fieldResult.action === "updated" ? fieldResult.labels : undefined,
          ),
        });
      }
      return NextResponse.json({ ok: true });
    }

    const stageResult = await handleStageConfirmationReply(event.thread_ts, event.text, "Slack thread");
    if (stageResult.handled) {
      if (stageResult.action === "invalid") {
        await postSlackMessage({
          channel: event.channel,
          threadTs: event.thread_ts,
          text: stageResult.message,
        });
      } else if (stageResult.action === "confirmed" && stageResult.stage) {
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

    const stageUpdateResult = await handleStageUpdateNotificationReply(event.thread_ts, event.text, "Slack thread");
    if (stageUpdateResult.handled) {
      if (stageUpdateResult.action === "invalid") {
        await postSlackMessage({
          channel: event.channel,
          threadTs: event.thread_ts,
          text: stageUpdateResult.message,
        });
      } else if (stageUpdateResult.action === "confirmed" && stageUpdateResult.stage) {
        await postSlackMessage({
          channel: event.channel,
          threadTs: event.thread_ts,
          text: `Updated case tracker: *${stageDisplay(stageUpdateResult.stage)}*.`,
        });
      } else if (stageUpdateResult.action === "unchanged" && stageUpdateResult.stage) {
        await postSlackMessage({
          channel: event.channel,
          threadTs: event.thread_ts,
          text: `Case tracker already shows *${stageDisplay(stageUpdateResult.stage)}*.`,
        });
      } else if (stageUpdateResult.action === "dismissed") {
        await postSlackMessage({
          channel: event.channel,
          threadTs: event.thread_ts,
          text: "No change to case tracker.",
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
    } else if (result.reason === "validation_failed" && result.validationErrors?.length) {
      await postSlackMessage({
        channel: event.channel,
        threadTs: event.thread_ts,
        text: formatSlackThreadValidationErrors(result.validationErrors),
      });
    } else {
      await postSlackMessage({
        channel: event.channel,
        threadTs: event.thread_ts,
        text: `Could not apply update — ${result.reason ?? "use lines like Expected disbursement quarter: 2026 Q3, Minimum: 75000, …"}`,
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
