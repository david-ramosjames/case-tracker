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

function matchContactBySlackUserId(contacts: ContactMatchRow[], slackUserId: string | null, role: "attorney" | "paralegal") {
  if (!slackUserId) return null;
  const target = slackUserId.trim().toUpperCase();
  return (
    contacts.find(
      (contact) => contact.role === role && contact.slack_user_id?.trim().toUpperCase() === target,
    ) ?? null
  );
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

function resolveTopicContact(
  contacts: ContactMatchRow[],
  role: "attorney" | "paralegal",
  slackUserId: string | null,
  handle: string | null,
) {
  return (
    matchContactBySlackUserId(contacts, slackUserId, role) ??
    (handle ? matchContactByHandle(contacts, handle, role) : null)
  );
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
  const attorney = resolveTopicContact(
    contactRows,
    "attorney",
    parsed.attorneySlackUserId,
    parsed.attorneyHandle,
  );
  const paralegal = resolveTopicContact(
    contactRows,
    "paralegal",
    parsed.paralegalSlackUserId,
    parsed.paralegalHandle,
  );

  const warnings: string[] = [];
  if ((parsed.attorneySlackUserId || parsed.attorneyHandle) && !attorney) {
    warnings.push(
      `Could not match attorney ${parsed.attorneySlackUserId ? `<@${parsed.attorneySlackUserId}>` : `@${parsed.attorneyHandle}`}`,
    );
  }
  if ((parsed.paralegalSlackUserId || parsed.paralegalHandle) && !paralegal) {
    warnings.push(
      `Could not match paralegal ${parsed.paralegalSlackUserId ? `<@${parsed.paralegalSlackUserId}>` : `@${parsed.paralegalHandle}`}`,
    );
  }

  const assignmentChanged =
    Boolean(attorney && attorney.id !== record.shared.attorneyId) ||
    Boolean(paralegal && paralegal.id !== record.shared.paralegalId);
  const usesEveChanged = parsed.usesEve !== record.shared.usesEve;
  const languageChanged =
    (parsed.primaryLanguage != null && parsed.primaryLanguage !== record.shared.preferredLanguage) ||
    parsed.secondaryLanguage !== record.shared.secondaryLanguage;

  let reassignResult: Awaited<ReturnType<typeof reassignCaseTeam>> | null = null;
  if (attorney && paralegal && assignmentChanged) {
    reassignResult = await reassignCaseTeam(caseId, {
      attorneyContactId: attorney.id,
      paralegalContactId: paralegal.id,
      usesEve: parsed.usesEve,
      actorName: "Slack topic",
    });
  }

  if (usesEveChanged || languageChanged || reassignResult) {
    await updateSharedCaseFields(caseId, {
      usesEve: parsed.usesEve,
      preferredLanguage: parsed.primaryLanguage ?? undefined,
      secondaryLanguage: parsed.secondaryLanguage,
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

  if (warnings.length > 0) {
    await postSlackMessage({
      channel: input.channelId,
      text: [
        "Case Tracker could not fully apply this topic change:",
        ...warnings.map((line) => `• ${line}`),
        "Use the structured format: `Attorney <@U…> | Paralegal <@U…> | Status | :us: (Primary)`",
      ].join("\n"),
    });
  } else if (assignmentChanged || nextStage || usesEveChanged || languageChanged) {
    const parts = [
      assignmentChanged
        ? `Reassigned to Attorney ${attorney?.name ?? "?"} / Paralegal ${paralegal?.name ?? "?"}`
        : null,
      nextStage && nextStage !== record.tracker.caseStage ? `Stage → ${nextStage}` : null,
      usesEveChanged ? `Eve → ${parsed.usesEve ? "Yes" : "No"}` : null,
      languageChanged
        ? `Language → ${parsed.primaryLanguage ?? "?"}${parsed.secondaryLanguage ? ` / ${parsed.secondaryLanguage}` : ""}`
        : null,
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
    usesEveChanged,
    stage: nextStage,
    warnings,
    reassignResult,
  };
}
