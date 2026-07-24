import { cleanCaseNumber } from "@/lib/csv/parse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCaseById, updateSharedCaseFields, updateTrackerEntry } from "@/lib/supabase/services";
import { reassignCaseTeam } from "@/lib/slack/case-reassign";
import { postSlackMessage, getSlackBotUserId } from "@/lib/slack/client";
import { wasTopicWrittenByUs } from "@/lib/slack/channel-topic";
import { STAGE_TOPIC_LABELS } from "@/lib/slack/enum-replies";
import { caseStageFromTopicLabel, parseCaseTopic } from "@/lib/slack/topic-format";

type ContactMatchRow = {
  id: string;
  name: string | null;
  role: string | null;
  slack_user_id: string | null;
  slack_display_name: string | null;
};

const TOPIC_FORMAT_HELP = [
  "Expected Slack topic format:",
  "`[:eve-logo:] Attorney <@U…> | Paralegal <@U…> | <Status> | :us: or :flag-mx: (Primary) [optional second flag]`",
  "",
  `Valid statuses: ${Object.values(STAGE_TOPIC_LABELS).join(" · ")}`,
  "Primary language must be marked `(Primary)` after the flag.",
].join("\n");

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

async function replyInChannel(channelId: string, text: string) {
  await postSlackMessage({ channel: channelId, text }).catch(() => undefined);
}

/**
 * Apply a manually edited Slack channel topic back to Case Tracker / DocketFlow.
 * Posts a correction message when the topic is malformed or the stage is invalid.
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

  const caseId = await findCaseIdBySlackChannel(input.channelId);
  if (!caseId) {
    return { applied: false as const, reason: "no_case" as const };
  }

  const parsed = parseCaseTopic(topic);
  if (parsed.format !== "structured") {
    console.warn("Slack topic change rejected: not structured format", {
      channelId: input.channelId,
      topic: topic.slice(0, 200),
      format: parsed.format,
    });
    await replyInChannel(
      input.channelId,
      [
        "Slack topic is not formatted correctly for Case Tracker.",
        "*Nothing was updated* — fix the topic and try again.",
        "",
        TOPIC_FORMAT_HELP,
      ].join("\n"),
    );
    return { applied: false as const, reason: "unstructured" as const, caseId };
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

  const nextStage = caseStageFromTopicLabel(parsed.stageLabel);
  const stageLabel = parsed.stageLabel?.trim() || "";
  const invalidStage = Boolean(stageLabel) && !nextStage;
  if (invalidStage) {
    warnings.push(
      `Unrecognized stage \`${stageLabel}\`. Use one of: ${Object.values(STAGE_TOPIC_LABELS).join(" · ")}`,
    );
  }
  if (!parsed.primaryLanguage) {
    warnings.push("Primary language flag is missing or invalid. Use `:us:` or `:flag-mx:` before `(Primary)`.");
  }

  const assignmentChanged =
    Boolean(attorney && attorney.id !== record.shared.attorneyId) ||
    Boolean(paralegal && paralegal.id !== record.shared.paralegalId);
  const usesEveChanged = parsed.usesEve !== record.shared.usesEve;
  const languageChanged =
    (parsed.primaryLanguage != null && parsed.primaryLanguage !== record.shared.preferredLanguage) ||
    parsed.secondaryLanguage !== record.shared.secondaryLanguage;
  const stageChanged = Boolean(nextStage && nextStage !== record.tracker.caseStage);

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

  if (stageChanged && nextStage) {
    await updateTrackerEntry(
      caseId,
      { caseStage: nextStage },
      { actor: { userName: "Slack topic" }, changeInput: { caseStage: nextStage } },
    );
  }

  const appliedParts = [
    assignmentChanged
      ? `Reassigned to Attorney ${attorney?.name ?? "?"} / Paralegal ${paralegal?.name ?? "?"}`
      : null,
    stageChanged ? `Stage → ${nextStage}` : null,
    usesEveChanged ? `Eve → ${parsed.usesEve ? "Yes" : "No"}` : null,
    languageChanged
      ? `Language → ${parsed.primaryLanguage ?? "?"}${parsed.secondaryLanguage ? ` / ${parsed.secondaryLanguage}` : ""}`
      : null,
    reassignResult?.calendarReconcile && !reassignResult.calendarReconcile.ok
      ? "_Calendar invite reconcile was requested but DocketFlow did not confirm — check DocketFlow env / endpoint._"
      : null,
  ].filter(Boolean) as string[];

  if (warnings.length > 0 || appliedParts.length > 0) {
    const lines: string[] = [];
    if (appliedParts.length > 0) {
      lines.push("Case Tracker updated from channel topic:");
      lines.push(...appliedParts.map((line) => `• ${line}`));
    }
    if (warnings.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("Could not fully apply this topic change:");
      lines.push(...warnings.map((line) => `• ${line}`));
      if (invalidStage || !parsed.primaryLanguage) {
        lines.push("");
        lines.push(TOPIC_FORMAT_HELP);
      }
    }
    await replyInChannel(input.channelId, lines.join("\n"));
  }

  return {
    applied: appliedParts.length > 0 || warnings.length === 0,
    caseId,
    assignmentChanged,
    usesEveChanged,
    languageChanged,
    primaryLanguage: parsed.primaryLanguage,
    secondaryLanguage: parsed.secondaryLanguage,
    stage: nextStage,
    invalidStage,
    warnings,
    reassignResult,
  };
}
