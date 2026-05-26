import {
  type CaseStage,
  type CaseStatus,
  type CheckStatus,
  type ClosingStatus,
  type DisbursedStatus,
  type ExpectedLitigationStatus,
  type ReleaseStatus,
} from "@/lib/types";

export const CASE_STATUS_OPTIONS = ["Active", "Closed"] satisfies CaseStatus[];

export const CASE_TYPE_OPTIONS = [
  "Car",
  "Premises",
  "Trucking",
  "Work Injury",
  "Wrongful Death",
  "Dog Bite",
  "Motorcycle",
  "Bicycle",
  "Products",
  "Assault",
  "Sexual Assault",
  "Child Abuse",
  "Medmal",
  "Other",
  "Gun Shot",
] as const;

export const LIABILITY_OPTIONS = ["Accepted 100%", "50/50", "Pending", "Denied - Dispute", "Denied", "N/A"] as const;

export const CASE_SIZE_OPTIONS = ["$0-30k", "$30k-$100k", ">$100k", "N/A"] as const;

export const CASE_STAGE_OPTIONS = ["Lit", "Txt", "Dmd", "Settled", "Onboarding", "Disengaged", "Referred", "Terminated"] satisfies CaseStage[];

export const EXPECTED_LITIGATION_OPTIONS = ["Pre", "Lit", "Expect"] satisfies ExpectedLitigationStatus[];

export const RELEASE_STATUS_OPTIONS = ["No", "Signed"] satisfies ReleaseStatus[];
export const CLOSING_STATUS_OPTIONS = ["No", "Drafted", "Approved", "Signed"] satisfies ClosingStatus[];
export const CHECK_STATUS_OPTIONS = ["Deposited", "No", "Sent"] satisfies CheckStatus[];
export const DISBURSED_STATUS_OPTIONS = ["No", "Yes"] satisfies DisbursedStatus[];

export function getTargetPeriodOptions(date = new Date()) {
  const currentYear = date.getFullYear() % 100;
  const years = Array.from({ length: 6 }, (_, index) => currentYear - 1 + index);

  return years.flatMap((year) => [`Q1-${year}`, `Q2-${year}`, `Q3-${year}`, `Q4-${year}`]);
}

/** Normalize quarter text to a standard value; maps legacy 1H/2H to Q2/Q4. */
export function normalizeTargetQuarter(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}$/.test(trimmed)) return `${trimmed} Q4`;

  const qDash = trimmed.match(/^Q([1-4])-(\d{2,4})$/i);
  if (qDash) {
    const year = qDash[2].length === 2 ? `20${qDash[2]}` : qDash[2];
    return `${year} Q${qDash[1]}`;
  }

  const longQ = trimmed.match(/^(\d{4})\s*Q([1-4])$/i);
  if (longQ) return `${longQ[1]} Q${longQ[2]}`;

  const halfDash = trimmed.match(/^([12])H-(\d{2})$/i);
  if (halfDash) {
    const quarter = halfDash[1] === "1" ? "2" : "4";
    return `20${halfDash[2]} Q${quarter}`;
  }

  const halfSpace = trimmed.match(/^(\d{4})\s*([12])H$/i);
  if (halfSpace) {
    const quarter = halfSpace[2] === "1" ? "2" : "4";
    return `${halfSpace[1]} Q${quarter}`;
  }

  return trimmed;
}

/** Calendar years for attorney fee goals (supports year rollover). */
export function getGoalYearOptions(date = new Date()) {
  const currentYear = date.getFullYear();
  return Array.from({ length: 5 }, (_, index) => currentYear - 1 + index);
}
