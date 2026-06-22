import { postSlackMessage } from "@/lib/slack/client";
import {
  approveAndSendSmsPendingApproval,
  isSmsApprovalText,
  isSmsRejectionText,
} from "@/lib/sms/workflow";
import { findSmsPendingApprovalByThread, updateSmsPendingApproval } from "@/lib/supabase/sms-automations";

export function isSmsApprovalReaction(reaction: string | undefined) {
  const normalized = reaction?.trim().toLowerCase();
  return normalized === "white_check_mark" || normalized === "heavy_check_mark" || normalized === "+1";
}

export async function handleSmsApprovalReply(channelId: string, threadTs: string, text: string) {
  const approval = await findSmsPendingApprovalByThread(channelId, threadTs);
  if (!approval) return { handled: false as const };

  if (isSmsRejectionText(text)) {
    await updateSmsPendingApproval(approval.id, { status: "rejected" });
    await postSlackMessage({ channel: channelId, text: "Client SMS cancelled — no message was sent.", threadTs });
    return { handled: true as const, action: "rejected" as const };
  }

  if (!isSmsApprovalText(text)) return { handled: false as const };

  const result = await approveAndSendSmsPendingApproval(approval.id);
  if (result.sent) {
    await postSlackMessage({ channel: channelId, text: "✅ Client SMS sent via Quo.", threadTs });
    return { handled: true as const, action: "sent" as const };
  }

  const reason = "message" in result ? result.message : result.reason;
  await postSlackMessage({ channel: channelId, text: `Could not send client SMS: ${reason}`, threadTs });
  return { handled: true as const, action: "failed" as const };
}

export async function handleSmsApprovalReaction(channelId: string, threadTs: string, reaction: string | undefined) {
  if (!isSmsApprovalReaction(reaction)) return { handled: false as const };
  return handleSmsApprovalReply(channelId, threadTs, "approve");
}
