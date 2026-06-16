import {
  CASE_STAGE_OPTIONS,
  CASE_TYPE_OPTIONS,
  EXPECTED_DISBURSEMENT_QUARTER_LABEL,
  EXPECTED_LITIGATION_OPTIONS,
  LIABILITY_OPTIONS,
  getTargetPeriodSelectOptions,
  normalizeCaseType,
  toStandardTargetPeriodLabel,
} from "@/lib/case-options";
import { parsePulseStageLabel } from "@/lib/stage-triggers";
import { type CaseStage, type ExpectedLitigationStatus } from "@/lib/types";

export const STAGE_SLACK_LABELS: Record<CaseStage, string> = {
  Onboarding: "Onboarding",
  Txt: "Treatment",
  Dmd: "Demand",
  Lit: "Litigation",
  Settled: "Settled",
  Disengaged: "Disengaged",
  Referred: "Referred",
  Terminated: "Terminated",
};

export const EXPECTED_LIT_SLACK_LABELS: Record<ExpectedLitigationStatus, string> = {
  Pre: "Pre-lit",
  Lit: "Litigation",
  Expect: "Expected litigation",
};

export function getStageSlackOptions() {
  return CASE_STAGE_OPTIONS.map((stage) => STAGE_SLACK_LABELS[stage] ?? stage);
}

export function getLiabilitySlackOptions() {
  return [...LIABILITY_OPTIONS];
}

export function getExpectedLitigationSlackOptions() {
  return EXPECTED_LITIGATION_OPTIONS.map((option) => EXPECTED_LIT_SLACK_LABELS[option]);
}

export function getCaseTypeSlackOptions() {
  return [...CASE_TYPE_OPTIONS];
}

export function getTargetQuarterSlackOptions(currentValue?: string | null, date = new Date()) {
  return getTargetPeriodSelectOptions(currentValue, date);
}

/** Parse Slack quarter text to canonical Q#-YY; must match an allowed dropdown label. */
export function parseStrictTargetQuarter(
  raw: string,
  options?: { currentValue?: string | null; date?: Date },
): string | null {
  const standard = toStandardTargetPeriodLabel(raw.trim());
  if (!standard) return null;

  const allowed = getTargetQuarterSlackOptions(options?.currentValue ?? null, options?.date);
  if (!allowed.includes(standard)) return null;

  return standard;
}

export function formatInvalidTargetQuarterMessage(attempted: string, currentValue?: string | null) {
  return formatSlackInvalidEnumMessage(
    EXPECTED_DISBURSEMENT_QUARTER_LABEL,
    getTargetQuarterSlackOptions(currentValue),
    attempted,
  );
}

export function parseStrictSlackStage(raw: string): CaseStage | null {
  return parsePulseStageLabel(raw);
}

export function parseStrictLiability(raw: string): (typeof LIABILITY_OPTIONS)[number] | null {
  const trimmed = raw.trim();
  const exact = LIABILITY_OPTIONS.find((option) => option.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  if (/^pending$/i.test(trimmed)) return "Pending";
  if (/^denied$/i.test(trimmed)) return "Denied";
  if (/^n\/a$/i.test(trimmed)) return "N/A";
  if (/^accepted\s*100\s*%?$/i.test(trimmed)) return "Accepted 100%";
  if (/^50\s*\/\s*50$/i.test(trimmed)) return "50/50";
  if (/^denied\s*-\s*dispute$/i.test(trimmed)) return "Denied - Dispute";
  return null;
}

export function parseStrictExpectedLitigation(raw: string): ExpectedLitigationStatus | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("litigation") || normalized === "lit") return "Lit";
  if (normalized.includes("expected")) return "Expect";
  if (normalized.includes("pre")) return "Pre";
  return null;
}

export function parseStrictCaseType(raw: string): (typeof CASE_TYPE_OPTIONS)[number] | null {
  const normalized = normalizeCaseType(raw);
  return CASE_TYPE_OPTIONS.includes(normalized as (typeof CASE_TYPE_OPTIONS)[number])
    ? (normalized as (typeof CASE_TYPE_OPTIONS)[number])
    : null;
}

export function formatSlackInvalidEnumMessage(label: string, options: readonly string[], attempted?: string) {
  const prefix = attempted?.trim() ? `Couldn't use *${attempted.trim()}* for *${label}*. ` : `That isn't a valid *${label}* value. `;
  return `${prefix}Reply with one of: ${options.map((option) => `\`${option}\``).join(" · ")}`;
}

export const MINIMUM_VALUE_MIN = 0;
export const MINIMUM_VALUE_MAX = 1_000_000;
export const REFERRAL_FEE_MIN = 0;
export const REFERRAL_FEE_MAX = 100;

function parseNumericToken(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Minimum value must be a number between $0 and $1,000,000. */
export function parseStrictMinimumValue(raw: string): number | null {
  const numeric = parseNumericToken(raw);
  if (numeric == null) return null;
  if (numeric < MINIMUM_VALUE_MIN || numeric > MINIMUM_VALUE_MAX) return null;
  return numeric;
}

/** Referral fee must be a percent between 0% and 100%. */
export function parseStrictReferralFee(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutPercent = trimmed.replace(/%$/, "").trim();
  const normalized = withoutPercent.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < REFERRAL_FEE_MIN || numeric > REFERRAL_FEE_MAX) return null;
  return numeric;
}

/** Policy limits must be a non-negative number (no text). */
export function parseStrictPolicyLimits(raw: string): number | null {
  const numeric = parseNumericToken(raw);
  if (numeric == null) return null;
  if (numeric < 0) return null;
  return numeric;
}

export function formatInvalidMinimumValueMessage(attempted: string) {
  return `Couldn't use *${attempted.trim()}* for *Minimum value*. Reply with a number between $0 and $1,000,000, e.g. \`Minimum: 75000\`.`;
}

export function formatInvalidReferralFeeMessage(attempted: string) {
  return `Couldn't use *${attempted.trim()}* for *Referral fee*. Reply with a percent between 0% and 100%, e.g. \`Referral fee: 33%\`.`;
}

export function formatInvalidPolicyLimitsMessage(attempted: string) {
  return `Couldn't use *${attempted.trim()}* for *Policy limits*. Reply with a number only, e.g. \`Policy limits: 100000\`.`;
}
