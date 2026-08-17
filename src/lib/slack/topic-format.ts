import { STAGE_TOPIC_LABELS } from "@/lib/slack/enum-replies";
import { type CaseStage } from "@/lib/types";

/** Canonical shortcode we write into topics. */
export const EVE_TOPIC_EMOJI = ":eve-logo:";

/** Aliases Slack may store/display for the Eve mark at the start of a topic. */
export const EVE_TOPIC_EMOJI_ALIASES = [
  ":eve-logo:",
  ":eve:",
  ":eve_logo:",
  ":eve-ai:",
  ":eve_ai:",
] as const;

export const LANGUAGE_TOPIC_EMOJI = {
  en: ":us:",
  es: ":flag-mx:",
} as const;

export type TopicLanguageCode = keyof typeof LANGUAGE_TOPIC_EMOJI;

export type CaseTopicParts = {
  usesEve: boolean;
  attorneyHandle: string;
  paralegalHandle: string;
  legalAssistantHandle?: string | null;
  /** When set, topic uses a real Slack mention tag `<@U…>` instead of plain `@Name`. */
  attorneySlackUserId?: string | null;
  paralegalSlackUserId?: string | null;
  legalAssistantSlackUserId?: string | null;
  stageLabel: string;
  primaryLanguage: TopicLanguageCode;
  secondaryLanguage: TopicLanguageCode | null;
};

export type ParsedCaseTopic = {
  usesEve: boolean;
  attorneyHandle: string | null;
  paralegalHandle: string | null;
  legalAssistantHandle: string | null;
  attorneySlackUserId: string | null;
  paralegalSlackUserId: string | null;
  legalAssistantSlackUserId: string | null;
  stageLabel: string | null;
  primaryLanguage: TopicLanguageCode | null;
  secondaryLanguage: TopicLanguageCode | null;
  format: "structured" | "legacy" | "unknown";
};

/** `@Laura` or `<@U123>` / `<@U123|Laura>` */
const TOPIC_PERSON_TOKEN = String.raw`(?:<@(U[A-Z0-9]+)(?:\|([^>]+))?>|@([A-Za-z][\w.-]*))`;

/** `:us:` / `:flag-mx:` or rendered regional-indicator flags — must be capturing for parse groups. */
const LANGUAGE_TOKEN = String.raw`(:us:|:flag-us:|:flag-mx:|\u{1F1FA}\u{1F1F8}|\u{1F1F2}\u{1F1FD})`;

const STRUCTURED_TOPIC_BODY_PATTERN = new RegExp(
  String.raw`^Attorney\s+${TOPIC_PERSON_TOKEN}\s*\|\s*Paralegal\s+${TOPIC_PERSON_TOKEN}(?:\s*\|\s*LA\s+${TOPIC_PERSON_TOKEN})?\s*\|\s*([^|]+?)\s*\|\s*${LANGUAGE_TOKEN}\s*\(Primary\)(?:\s*${LANGUAGE_TOKEN})?\s*$`,
  "iu",
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
  const trimmed = emoji?.trim() ?? "";
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === ":us:" || lower === ":flag-us:" || trimmed === "🇺🇸") return "en";
  if (lower === ":flag-mx:" || trimmed === "🇲🇽") return "es";
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

/**
 * Strip leading Eve / decorative emoji markers Slack may store as shortcodes or unicode.
 * Leading custom emoji / pictographs before `Attorney` count as Eve for this topic format.
 */
export function extractLeadingEveMarker(topic: string): { usesEve: boolean; remainder: string } {
  let remainder = topic.trim();
  let usesEve = false;

  while (remainder) {
    const shortcode = remainder.match(/^:([a-z0-9_+-]+):\s*/i);
    if (shortcode) {
      usesEve = true;
      remainder = remainder.slice(shortcode[0].length);
      continue;
    }

    const pictograph = remainder.match(/^(?:\p{Extended_Pictographic}|\uFE0F|\u200D)+\s*/u);
    if (pictograph) {
      usesEve = true;
      remainder = remainder.slice(pictograph[0].length);
      continue;
    }

    break;
  }

  return { usesEve, remainder: remainder.trim() };
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
  const legalAssistantHandle = parts.legalAssistantHandle?.trim();
  const hasLegalAssistant = Boolean(legalAssistantHandle || parts.legalAssistantSlackUserId);
  const legalAssistant = hasLegalAssistant
    ? ` | LA ${formatTopicPersonMention({
        slackUserId: parts.legalAssistantSlackUserId,
        handle: legalAssistantHandle || "LA",
      })}`
    : "";
  const stage = parts.stageLabel.trim();
  const primary = topicEmojiForLanguage(parts.primaryLanguage);
  const secondary = parts.secondaryLanguage ? `  ${topicEmojiForLanguage(parts.secondaryLanguage)}` : "";
  const body = `Attorney ${attorney} | Paralegal ${paralegal}${legalAssistant} | ${stage} | ${primary} (Primary)${secondary}`;
  return parts.usesEve ? `${EVE_TOPIC_EMOJI} ${body}` : body;
}

export function parseCaseTopic(topic: string | null | undefined): ParsedCaseTopic {
  const empty: ParsedCaseTopic = {
    usesEve: false,
    attorneyHandle: null,
    paralegalHandle: null,
    legalAssistantHandle: null,
    attorneySlackUserId: null,
    paralegalSlackUserId: null,
    legalAssistantSlackUserId: null,
    stageLabel: null,
    primaryLanguage: null,
    secondaryLanguage: null,
    format: "unknown",
  };

  const trimmed = topic?.trim() ?? "";
  if (!trimmed) return empty;

  const { usesEve, remainder } = extractLeadingEveMarker(trimmed);

  const structured = remainder.match(STRUCTURED_TOPIC_BODY_PATTERN);
  if (structured) {
    const attorney = personFromMatch(structured[1], structured[2], structured[3]);
    const paralegal = personFromMatch(structured[4], structured[5], structured[6]);
    const legalAssistant = personFromMatch(structured[7], structured[8], structured[9]);
    return {
      usesEve,
      attorneyHandle: attorney.handle,
      paralegalHandle: paralegal.handle,
      legalAssistantHandle: legalAssistant.handle,
      attorneySlackUserId: attorney.slackUserId,
      paralegalSlackUserId: paralegal.slackUserId,
      legalAssistantSlackUserId: legalAssistant.slackUserId,
      stageLabel: structured[10].trim(),
      primaryLanguage: languageCodeFromTopicEmoji(structured[11]),
      secondaryLanguage: languageCodeFromTopicEmoji(structured[12]),
      format: "structured",
    };
  }

  const legacy = remainder.match(LEGACY_TOPIC_PATTERN);
  if (legacy) {
    const attorney = personFromMatch(legacy[1], legacy[2], legacy[3]);
    const paralegal = personFromMatch(legacy[4], legacy[5], legacy[6]);
    return {
      usesEve,
      attorneyHandle: attorney.handle,
      paralegalHandle: paralegal.handle,
      legalAssistantHandle: null,
      attorneySlackUserId: attorney.slackUserId,
      paralegalSlackUserId: paralegal.slackUserId,
      legalAssistantSlackUserId: null,
      stageLabel: legacy[7]?.trim() || null,
      primaryLanguage: null,
      secondaryLanguage: null,
      format: "legacy",
    };
  }

  return {
    ...empty,
    usesEve: usesEve || EVE_TOPIC_EMOJI_ALIASES.some((alias) => trimmed.toLowerCase().includes(alias)),
  };
}

export function slackHandleFromContactName(name: string | null | undefined) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return "Unassigned";
  return trimmed.split(/\s+/)[0] || "Unassigned";
}
