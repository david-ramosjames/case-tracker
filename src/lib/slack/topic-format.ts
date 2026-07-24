import { STAGE_TOPIC_LABELS } from "@/lib/slack/enum-replies";
import { type CaseStage } from "@/lib/types";

export const EVE_TOPIC_EMOJI = ":eve-logo:";
export const LANGUAGE_TOPIC_EMOJI = {
  en: ":us:",
  es: ":flag-mx:",
} as const;

export type TopicLanguageCode = keyof typeof LANGUAGE_TOPIC_EMOJI;

export type CaseTopicParts = {
  usesEve: boolean;
  attorneyHandle: string;
  paralegalHandle: string;
  /** When set, topic uses a real Slack mention tag `<@U…>` instead of plain `@Name`. */
  attorneySlackUserId?: string | null;
  paralegalSlackUserId?: string | null;
  stageLabel: string;
  primaryLanguage: TopicLanguageCode;
  secondaryLanguage: TopicLanguageCode | null;
};

export type ParsedCaseTopic = {
  usesEve: boolean;
  attorneyHandle: string | null;
  paralegalHandle: string | null;
  attorneySlackUserId: string | null;
  paralegalSlackUserId: string | null;
  stageLabel: string | null;
  primaryLanguage: TopicLanguageCode | null;
  secondaryLanguage: TopicLanguageCode | null;
  format: "structured" | "legacy" | "unknown";
};

/** `@Laura` or `<@U123>` / `<@U123|Laura>` */
const TOPIC_PERSON_TOKEN = String.raw`(?:<@(U[A-Z0-9]+)(?:\|([^>]+))?>|@([A-Za-z][\w.-]*))`;

const STRUCTURED_TOPIC_PATTERN = new RegExp(
  String.raw`^(?::eve-logo:\s*)?Attorney\s+${TOPIC_PERSON_TOKEN}\s*\|\s*Paralegal\s+${TOPIC_PERSON_TOKEN}\s*\|\s*([^|]+?)\s*\|\s*(:us:|:flag-mx:)\s*\(Primary\)(?:\s*(:us:|:flag-mx:))?\s*$`,
  "i",
);

const LEGACY_TOPIC_PATTERN = new RegExp(
  String.raw`^Attorney\s+${TOPIC_PERSON_TOKEN}\s*(?:\|\s*Paralegal\s+${TOPIC_PERSON_TOKEN})?\s*(?:\(([^)]+)\))?\s*$`,
  "i",
);

function normalizeHandle(value: string) {
  return value.trim().replace(/^@/, "");
}

function normalizeSlackUserId(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return /^U[A-Z0-9]+$/i.test(trimmed) ? trimmed.toUpperCase() : null;
}

/** Slack mrkdwn mention when ID is known; otherwise plain @handle. */
export function formatTopicPersonMention(input: {
  slackUserId?: string | null;
  handle: string;
}) {
  const userId = normalizeSlackUserId(input.slackUserId);
  if (userId) return `<@${userId}>`;
  return `@${normalizeHandle(input.handle)}`;
}

function personFromMatch(userIdGroup: string | undefined, labelGroup: string | undefined, handleGroup: string | undefined) {
  const slackUserId = normalizeSlackUserId(userIdGroup);
  const handle = labelGroup?.trim() || (handleGroup ? normalizeHandle(handleGroup) : null);
  return { slackUserId, handle };
}

export function languageCodeFromTopicEmoji(emoji: string | null | undefined): TopicLanguageCode | null {
  const trimmed = emoji?.trim().toLowerCase();
  if (trimmed === ":us:") return "en";
  if (trimmed === ":flag-mx:") return "es";
  return null;
}

export function topicEmojiForLanguage(code: TopicLanguageCode) {
  return LANGUAGE_TOPIC_EMOJI[code];
}

export function stageLabelFromCaseStage(stage: CaseStage) {
  return STAGE_TOPIC_LABELS[stage] ?? stage;
}

export function caseStageFromTopicLabel(label: string | null | undefined): CaseStage | null {
  if (!label?.trim()) return null;
  const normalized = label.trim().toLowerCase();
  for (const [stage, topicLabel] of Object.entries(STAGE_TOPIC_LABELS) as Array<[CaseStage, string]>) {
    if (topicLabel.toLowerCase() === normalized) return stage;
  }
  if (normalized === "treatment" || normalized === "treating" || normalized === "txt") return "Txt";
  if (normalized === "demand" || normalized === "dmd") return "Dmd";
  if (normalized === "litigation" || normalized === "lit") return "Lit";
  if (normalized === "onboarding") return "Onboarding";
  if (normalized === "settled") return "Settled";
  if (normalized === "disengaged") return "Disengaged";
  if (normalized === "referred") return "Referred";
  if (normalized === "terminated") return "Terminated";
  return null;
}

/** Build the canonical Slack channel topic summary. */
export function buildCaseTopic(parts: CaseTopicParts) {
  const attorney = formatTopicPersonMention({
    slackUserId: parts.attorneySlackUserId,
    handle: parts.attorneyHandle,
  });
  const paralegal = formatTopicPersonMention({
    slackUserId: parts.paralegalSlackUserId,
    handle: parts.paralegalHandle,
  });
  const stage = parts.stageLabel.trim();
  const primary = topicEmojiForLanguage(parts.primaryLanguage);
  const secondary = parts.secondaryLanguage ? `  ${topicEmojiForLanguage(parts.secondaryLanguage)}` : "";
  const body = `Attorney ${attorney} | Paralegal ${paralegal} | ${stage} | ${primary} (Primary)${secondary}`;
  return parts.usesEve ? `${EVE_TOPIC_EMOJI} ${body}` : body;
}

export function parseCaseTopic(topic: string | null | undefined): ParsedCaseTopic {
  const empty: ParsedCaseTopic = {
    usesEve: false,
    attorneyHandle: null,
    paralegalHandle: null,
    attorneySlackUserId: null,
    paralegalSlackUserId: null,
    stageLabel: null,
    primaryLanguage: null,
    secondaryLanguage: null,
    format: "unknown",
  };

  const trimmed = topic?.trim() ?? "";
  if (!trimmed) return empty;

  const structured = trimmed.match(STRUCTURED_TOPIC_PATTERN);
  if (structured) {
    const attorney = personFromMatch(structured[1], structured[2], structured[3]);
    const paralegal = personFromMatch(structured[4], structured[5], structured[6]);
    return {
      usesEve: trimmed.toLowerCase().startsWith(EVE_TOPIC_EMOJI),
      attorneyHandle: attorney.handle,
      paralegalHandle: paralegal.handle,
      attorneySlackUserId: attorney.slackUserId,
      paralegalSlackUserId: paralegal.slackUserId,
      stageLabel: structured[7].trim(),
      primaryLanguage: languageCodeFromTopicEmoji(structured[8]),
      secondaryLanguage: languageCodeFromTopicEmoji(structured[9]),
      format: "structured",
    };
  }

  const legacy = trimmed.match(LEGACY_TOPIC_PATTERN);
  if (legacy) {
    const attorney = personFromMatch(legacy[1], legacy[2], legacy[3]);
    const paralegal = personFromMatch(legacy[4], legacy[5], legacy[6]);
    return {
      usesEve: false,
      attorneyHandle: attorney.handle,
      paralegalHandle: paralegal.handle,
      attorneySlackUserId: attorney.slackUserId,
      paralegalSlackUserId: paralegal.slackUserId,
      stageLabel: legacy[7]?.trim() || null,
      primaryLanguage: null,
      secondaryLanguage: null,
      format: "legacy",
    };
  }

  return {
    ...empty,
    usesEve: trimmed.toLowerCase().includes(EVE_TOPIC_EMOJI),
  };
}

export function slackHandleFromContactName(name: string | null | undefined) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return "Unassigned";
  return trimmed.split(/\s+/)[0] || "Unassigned";
}
