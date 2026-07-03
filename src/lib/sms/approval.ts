import { postSlackMessage } from "@/lib/slack/client";
import {
  approveAndSendSmsPendingApproval,
  isSmsApprovalText,
  isSmsRejectionText,
} from "@/lib/sms/workflow";
import {
  claimSmsPendingApproval,
  findSmsPendingApprovalByThread,
  type SmsPendingApproval,
} from "@/lib/supabase/sms-automations";

export function isSmsApprovalReaction(reaction: string | undefined) {
  const normalized = reaction?.trim().toLowerCase();
  return normalized === "white_check_mark" || normalized === "heavy_check_mark" || normalized === "+1";
}

export async function rejectSmsPendingApproval(
  approval: SmsPendingApproval,
  options?: { slackMessage?: string },
) {
  const claimed = await claimSmsPendingApproval(approval.id, "rejected");
  if (!claimed) return { rejected: false as const };

  if (claimed.slackChannelId && claimed.slackThreadTs) {
    await postSlackMessage({
      channel: claimed.slackChannelId,
      text: options?.slackMessage ?? "Client SMS cancelled — no message was sent.",
      threadTs: claimed.slackThreadTs,
    });
  }

  return { rejected: true as const };
}

export async function handleSmsApprovalReply(channelId: string, threadTs: string, text: string) {
  const approval = await findSmsPendingApprovalByThread(channelId, threadTs);
  if (!approval) return { handled: false as const };

  const isApproval = isSmsApprovalText(text);
  const isRejection = isSmsRejectionText(text);
  if (!isApproval && !isRejection) return { handled: false as const };

  // Duplicate Slack delivery / concurrent reaction after claim — do not send or notify again.
  if (approval.status !== "pending") {
    return { handled: true as const, action: "already_handled" as const };
  }

  if (isRejection) {
    const result = await rejectSmsPendingApproval(approval);
    return {
      handled: true as const,
      action: result.rejected ? ("rejected" as const) : ("already_handled" as const),
    };
  }

  const result = await approveAndSendSmsPendingApproval(approval.id);
  if (result.sent) {
    await postSlackMessage({ channel: channelId, text: "✅ Client SMS sent via Quo.", threadTs });
    return { handled: true as const, action: "sent" as const };
  }

  if (result.reason === "not_pending") {
    return { handled: true as const, action: "already_handled" as const };
  }

  const reason = "message" in result ? result.message : result.reason;
  await postSlackMessage({ channel: channelId, text: `Could not send client SMS: ${reason}`, threadTs });
  return { handled: true as const, action: "failed" as const };
}

export async function handleSmsApprovalReaction(channelId: string, threadTs: string, reaction: string | undefined) {
  if (!isSmsApprovalReaction(reaction)) return { handled: false as const };
  return handleSmsApprovalReply(channelId, threadTs, "approve");
}
