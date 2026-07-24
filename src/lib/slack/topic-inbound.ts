import { cleanCaseNumber } from "@/lib/csv/parse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCaseById, updateSharedCaseFields, updateTrackerEntry } from "@/lib/supabase/services";
import { reassignCaseTeam } from "@/lib/slack/case-reassign";
import { getSlackBotUserId, postSlackMessage } from "@/lib/slack/client";
import { wasTopicWrittenByUs } from "@/lib/slack/channel-topic";
import { caseStageFromTopicLabel, parseCaseTopic } from "@/lib/slack/topic-format";

type ContactMatchRow = {
  id: string;
  name: string | null;
  role: string | null;
  slack_user_id: string | null;
  slack_display_name: string | null;
};

function normalizeHandle(value: string) {
  return value.trim().toLowerCase().replace(/[._-]+/g, "");
}

function matchContactByHandle(contacts: ContactMatchRow[], handle: string, role: "attorney" | "paralegal") {
  const target = normalizeHandle(handle);
  if (!target) return null;

  const roleMatches = contacts.filter((contact) => contact.role === role);
  for (const contact of roleMatches) {
    const candidates = [
      contact.slack_display_name,
      contact.name?.split(/\s+/)[0],
      contact.name,
    ].filter(Boolean) as string[];
    for (const candidate of candidates) {
      const normalized = normalizeHandle(candidate);
      if (!normalized) continue;
      if (normalized === target || normalized.startsWith(target) || target.startsWith(normalized)) {
        return contact;
      }
    }
  }
  return null;
}

async function findCaseIdBySlackChannel(channelId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data: channelRow } = await admin
    .from("case_slack_channels")
    .select("case_number")
    .eq("slack_channel_id", channelId)
    .maybeSingle();
  if (!channelRow?.case_number) return null;

  const caseNumber = cleanCaseNumber(String(channelRow.case_number));
  const { data: tracker } = await admin
    .from("case_tracker_entries")
    .select("case_id,id")
    .eq("case_number", caseNumber)
    .maybeSingle();

  if (tracker?.case_id) return String(tracker.case_id);
  if (tracker?.id) return String(tracker.id);

  const { data: caseRow } = await admin.from("cases").select("id").eq("case_number", caseNumber).maybeSingle();
  return caseRow?.id ? String(caseRow.id) : null;
}

/**
 * Apply a manually edited Slack channel topic back to Case Tracker / DocketFlow.
 * Expects the structured topic format; unknown formats are ignored.
 */
export async function applySlackChannelTopicChange(input: {
  channelId: string;
  topic: string;
  userId?: string | null;
}) {
  const topic = input.topic.trim();
  if (!topic) return { applied: false as const, reason: "empty_topic" as const };

  if (wasTopicWrittenByUs(input.channelId, topic)) {
    return { applied: false as const, reason: "echo" as const };
  }

  const botUserId = await getSlackBotUserId();
  if (botUserId && input.userId && input.userId === botUserId) {
    return { applied: false as const, reason: "bot_echo" as const };
  }

  const parsed = parseCaseTopic(topic);
  if (parsed.format !== "structured") {
    console.warn("Slack topic change ignored: not structured format", {
      channelId: input.channelId,
      topic: topic.slice(0, 200),
    });
    return { applied: false as const, reason: "unstructured" as const };
  }

  const caseId = await findCaseIdBySlackChannel(input.channelId);
  if (!caseId) {
    return { applied: false as const, reason: "no_case" as const };
  }

  const record = await getCaseById(caseId);
  if (!record) return { applied: false as const, reason: "no_case" as const };

  const admin = createSupabaseAdminClient();
  if (!admin) return { applied: false as const, reason: "no_admin" as const };

  const { data: contacts } = await admin
    .from("contacts")
    .select("id,name,role,slack_user_id,slack_display_name")
    .in("role", ["attorney", "paralegal"]);

  const contactRows = (contacts ?? []) as ContactMatchRow[];
  const attorney = parsed.attorneyHandle
    ? matchContactByHandle(contactRows, parsed.attorneyHandle, "attorney")
    : null;
  const paralegal = parsed.paralegalHandle
    ? matchContactByHandle(contactRows, parsed.paralegalHandle, "paralegal")
    : null;

  const warnings: string[] = [];
  if (parsed.attorneyHandle && !attorney) {
    warnings.push(`Could not match attorney @${parsed.attorneyHandle}`);
  }
  if (parsed.paralegalHandle && !paralegal) {
    warnings.push(`Could not match paralegal @${parsed.paralegalHandle}`);
  }

  const assignmentChanged =
    Boolean(attorney && attorney.id !== record.shared.attorneyId) ||
    Boolean(paralegal && paralegal.id !== record.shared.paralegalId);

  let reassignResult: Awaited<ReturnType<typeof reassignCaseTeam>> | null = null;
  if (attorney && paralegal && assignmentChanged) {
    reassignResult = await reassignCaseTeam(caseId, {
      attorneyContactId: attorney.id,
      paralegalContactId: paralegal.id,
      usesEve: parsed.usesEve,
      actorName: "Slack topic",
    });
  } else if (parsed.usesEve !== record.shared.usesEve || parsed.primaryLanguage || parsed.secondaryLanguage !== undefined) {
    await updateSharedCaseFields(caseId, {
      usesEve: parsed.usesEve,
      preferredLanguage: parsed.primaryLanguage ?? undefined,
      secondaryLanguage:
        parsed.secondaryLanguage === undefined
          ? undefined
          : parsed.secondaryLanguage,
    });
  }

  const nextStage = caseStageFromTopicLabel(parsed.stageLabel);
  if (nextStage && nextStage !== record.tracker.caseStage) {
    await updateTrackerEntry(
      caseId,
      { caseStage: nextStage },
      { actor: { userName: "Slack topic" }, changeInput: { caseStage: nextStage } },
    );
  }

  // Language updates when assignment already ran (reassign keeps existing langs unless we patch).
  if (reassignResult && (parsed.primaryLanguage || parsed.secondaryLanguage !== null)) {
    await updateSharedCaseFields(caseId, {
      preferredLanguage: parsed.primaryLanguage ?? undefined,
      secondaryLanguage: parsed.secondaryLanguage,
      usesEve: parsed.usesEve,
    });
  }

  if (warnings.length > 0) {
    await postSlackMessage({
      channel: input.channelId,
      text: [
        "Case Tracker could not fully apply this topic change:",
        ...warnings.map((line) => `• ${line}`),
        "Use the structured format: `Attorney @Name | Paralegal @Name | Status | :us: (Primary)`",
      ].join("\n"),
    });
  } else if (assignmentChanged || nextStage) {
    const parts = [
      assignmentChanged
        ? `Reassigned to Attorney ${attorney?.name ?? "?"} / Paralegal ${paralegal?.name ?? "?"}`
        : null,
      nextStage && nextStage !== record.tracker.caseStage ? `Stage → ${nextStage}` : null,
      reassignResult?.calendarReconcile && !reassignResult.calendarReconcile.ok
        ? "_Calendar invite reconcile was requested but DocketFlow did not confirm — check DocketFlow env / endpoint._"
        : null,
    ].filter(Boolean);
    if (parts.length > 0) {
      await postSlackMessage({
        channel: input.channelId,
        text: `Case Tracker updated from channel topic:\n${parts.map((p) => `• ${p}`).join("\n")}`,
      });
    }
  }

  return {
    applied: true as const,
    caseId,
    assignmentChanged,
    stage: nextStage,
    warnings,
    reassignResult,
  };
}
