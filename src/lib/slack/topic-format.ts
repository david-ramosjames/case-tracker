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
  stageLabel: string;
  primaryLanguage: TopicLanguageCode;
  secondaryLanguage: TopicLanguageCode | null;
};

export type ParsedCaseTopic = {
  usesEve: boolean;
  attorneyHandle: string | null;
  paralegalHandle: string | null;
  stageLabel: string | null;
  primaryLanguage: TopicLanguageCode | null;
  secondaryLanguage: TopicLanguageCode | null;
  format: "structured" | "legacy" | "unknown";
};

const STRUCTURED_TOPIC_PATTERN =
  /^(?::eve-logo:\s*)?Attorney\s+@([A-Za-z][\w.-]*)\s*\|\s*Paralegal\s+@([A-Za-z][\w.-]*)\s*\|\s*([^|]+?)\s*\|\s*(:us:|:flag-mx:)\s*\(Primary\)(?:\s*(:us:|:flag-mx:))?\s*$/i;

const LEGACY_TOPIC_PATTERN =
  /^Attorney\s+@([A-Za-z][\w.-]*)\s*(?:\|\s*Paralegal\s+@([A-Za-z][\w.-]*))?\s*(?:\(([^)]+)\))?\s*$/i;

function normalizeHandle(value: string) {
  return value.trim().replace(/^@/, "");
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
  // Common Slack aliases
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
  const attorney = normalizeHandle(parts.attorneyHandle);
  const paralegal = normalizeHandle(parts.paralegalHandle);
  const stage = parts.stageLabel.trim();
  const primary = topicEmojiForLanguage(parts.primaryLanguage);
  const secondary = parts.secondaryLanguage ? `  ${topicEmojiForLanguage(parts.secondaryLanguage)}` : "";
  const body = `Attorney @${attorney} | Paralegal @${paralegal} | ${stage} | ${primary} (Primary)${secondary}`;
  return parts.usesEve ? `${EVE_TOPIC_EMOJI} ${body}` : body;
}

export function parseCaseTopic(topic: string | null | undefined): ParsedCaseTopic {
  const trimmed = topic?.trim() ?? "";
  if (!trimmed) {
    return {
      usesEve: false,
      attorneyHandle: null,
      paralegalHandle: null,
      stageLabel: null,
      primaryLanguage: null,
      secondaryLanguage: null,
      format: "unknown",
    };
  }

  const structured = trimmed.match(STRUCTURED_TOPIC_PATTERN);
  if (structured) {
    return {
      usesEve: trimmed.toLowerCase().startsWith(EVE_TOPIC_EMOJI),
      attorneyHandle: normalizeHandle(structured[1]),
      paralegalHandle: normalizeHandle(structured[2]),
      stageLabel: structured[3].trim(),
      primaryLanguage: languageCodeFromTopicEmoji(structured[4]),
      secondaryLanguage: languageCodeFromTopicEmoji(structured[5]),
      format: "structured",
    };
  }

  const legacy = trimmed.match(LEGACY_TOPIC_PATTERN);
  if (legacy) {
    return {
      usesEve: false,
      attorneyHandle: normalizeHandle(legacy[1]),
      paralegalHandle: legacy[2] ? normalizeHandle(legacy[2]) : null,
      stageLabel: legacy[3]?.trim() || null,
      primaryLanguage: null,
      secondaryLanguage: null,
      format: "legacy",
    };
  }

  return {
    usesEve: trimmed.toLowerCase().includes(EVE_TOPIC_EMOJI),
    attorneyHandle: null,
    paralegalHandle: null,
    stageLabel: null,
    primaryLanguage: null,
    secondaryLanguage: null,
    format: "unknown",
  };
}

export function slackHandleFromContactName(name: string | null | undefined) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return "Unassigned";
  return trimmed.split(/\s+/)[0] || "Unassigned";
}
