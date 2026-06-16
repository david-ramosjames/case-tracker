import {
  isFieldConfirmationReaction,
  parseFieldReminderReply,
} from "@/lib/slack/field-confirmation-parse";
import { FIELD_REMINDER_META } from "@/lib/slack/field-reminders";
import { getCaseById } from "@/lib/supabase/services";
import {
  confirmFieldReminder,
  dismissFieldReminder,
  findFieldReminderByThread,
} from "@/lib/supabase/field-reminders";

export async function handleFieldReminderReply(threadTs: string, text: string, actorName = "Slack") {
  const reminder = await findFieldReminderByThread(threadTs);
  if (!reminder) return { handled: false as const, reason: "no_pending_reminder" };

  const record = await getCaseById(reminder.caseId);
  const parsed = parseFieldReminderReply(text, reminder.fieldKey, {
    currentTargetQuarter: record?.tracker.targetResolutionQuarter,
  });
  if (!parsed) return { handled: false as const, reason: "unrecognized_reply" };

  if (parsed.kind === "dismiss") {
    await dismissFieldReminder(reminder.id, reminder.caseId, actorName);
    return { handled: true as const, action: "dismissed" as const, fieldKey: reminder.fieldKey };
  }

  if (parsed.kind === "invalid") {
    return { handled: true as const, action: "invalid" as const, fieldKey: reminder.fieldKey, message: parsed.message };
  }

  if (parsed.kind === "update") {
    await confirmFieldReminder(reminder.id, reminder.caseId, reminder.fieldKey, actorName, parsed.patch);
    return {
      handled: true as const,
      action: "updated" as const,
      fieldKey: reminder.fieldKey,
      labels: parsed.labels,
    };
  }

  await confirmFieldReminder(reminder.id, reminder.caseId, reminder.fieldKey, actorName);
  return { handled: true as const, action: "confirmed" as const, fieldKey: reminder.fieldKey };
}

export async function handleFieldReminderReaction(threadTs: string, reaction: string, actorName = "Slack") {
  if (!isFieldConfirmationReaction(reaction)) return { handled: false as const, reason: "not_confirm_reaction" };

  const reminder = await findFieldReminderByThread(threadTs);
  if (!reminder) return { handled: false as const, reason: "no_pending_reminder" };

  await confirmFieldReminder(reminder.id, reminder.caseId, reminder.fieldKey, actorName);
  return { handled: true as const, action: "confirmed" as const, fieldKey: reminder.fieldKey };
}

export function formatFieldReminderAppliedMessage(fieldKey: string, labels?: string[]) {
  const label = FIELD_REMINDER_META[fieldKey as keyof typeof FIELD_REMINDER_META]?.label ?? fieldKey;
  if (labels && labels.length > 0) {
    return `Updated case tracker: *${labels.join("*, *")}*.`;
  }
  return `Confirmed *${label}* — saved to the case tracker.`;
}
