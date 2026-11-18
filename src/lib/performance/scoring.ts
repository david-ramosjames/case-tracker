/** Safe ratio: null target or 0 → excluded (null), never divide by zero. */
export function attainmentRatio(actual: number, target: number | null | undefined): number | null {
  if (target == null || target === 0) return null;
  return actual / target;
}

export function averageNonNull(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Weighted mean; missing sections drop out and remaining weights re-normalize. */
export function weightedAverage(parts: Array<{ value: number | null | undefined; weight: number }>): number | null {
  let sum = 0;
  let weight = 0;
  for (const part of parts) {
    if (part.value == null || !Number.isFinite(part.value) || part.weight <= 0) continue;
    sum += part.value * part.weight;
    weight += part.weight;
  }
  if (weight === 0) return null;
  return sum / weight;
}

export type ParalegalScoreInputs = {
  actualDemands: number;
  targetDemands: number;
  actualLawsuit: number;
  targetLawsuit: number;
  actualDiscovery: number;
  targetDiscovery: number;
  actualLitEventsScheduled: number;
  targetLitEventsScheduled: number;
};

export type ParalegalScoreResult = {
  preLit: number | null;
  litigation: number | null;
  scheduling: number | null;
  overall: number | null;
};

/** Three equal buckets (1/3 each); no 100% cap. */
export function scoreParalegalWeek(input: ParalegalScoreInputs): ParalegalScoreResult {
  const preLit = attainmentRatio(input.actualDemands, input.targetDemands);
  const litActual = input.actualLawsuit + input.actualDiscovery;
  const litTarget = input.targetLawsuit + input.targetDiscovery;
  const litigation = attainmentRatio(litActual, litTarget);
  const scheduling = attainmentRatio(input.actualLitEventsScheduled, input.targetLitEventsScheduled);
  return {
    preLit,
    litigation,
    scheduling,
    overall: averageNonNull([preLit, litigation, scheduling]),
  };
}

export type AttorneyScoreInputs = {
  actualDemands: number;
  targetDemands: number;
  actualLawsuit: number;
  targetLawsuit: number;
  actualLitEventsScheduled: number;
  targetLitEventsScheduled: number;
  actualLitCompleted: number;
  targetLitCompleted: number;
  actualSettlements: number;
  targetSettlements: number;
  actualDisbursements: number;
  targetDisbursements: number;
};

export type AttorneyScoreResult = {
  preLit: number | null;
  litigation: number | null;
  closing: number | null;
  demands: number | null;
  lawsuit: number | null;
  litScheduled: number | null;
  litCompleted: number | null;
  settlements: number | null;
  disbursements: number | null;
  overall: number | null;
};

export const ATTORNEY_SECTION_WEIGHTS = {
  preLit: 0.2,
  litigation: 0.4,
  closing: 0.4,
} as const;

/**
 * Attorney scorecard: Pre-Lit 20% · Litigation 40% · Closing 40%.
 * Within Litigation / Closing, metrics average equally. Disengaged is display-only.
 */
export function scoreAttorneyWeek(input: AttorneyScoreInputs): AttorneyScoreResult {
  const demands = attainmentRatio(input.actualDemands, input.targetDemands);
  const lawsuit = attainmentRatio(input.actualLawsuit, input.targetLawsuit);
  const litScheduled = attainmentRatio(input.actualLitEventsScheduled, input.targetLitEventsScheduled);
  const litCompleted = attainmentRatio(input.actualLitCompleted, input.targetLitCompleted);
  const settlements = attainmentRatio(input.actualSettlements, input.targetSettlements);
  const disbursements = attainmentRatio(input.actualDisbursements, input.targetDisbursements);

  const preLit = demands;
  const litigation = averageNonNull([lawsuit, litScheduled, litCompleted]);
  const closing = averageNonNull([settlements, disbursements]);
  const overall = weightedAverage([
    { value: preLit, weight: ATTORNEY_SECTION_WEIGHTS.preLit },
    { value: litigation, weight: ATTORNEY_SECTION_WEIGHTS.litigation },
    { value: closing, weight: ATTORNEY_SECTION_WEIGHTS.closing },
  ]);

  return {
    preLit,
    litigation,
    closing,
    demands,
    lawsuit,
    litScheduled,
    litCompleted,
    settlements,
    disbursements,
    overall,
  };
}

export const DEFAULT_PARALEGAL_TARGETS = {
  demand_sent: 1,
  lawsuit_filed: 1,
  discovery_responses: 2,
  lit_event_scheduled: 3,
} as const;

export const DEFAULT_ATTORNEY_TARGETS = {
  demand_sent: 2,
  lawsuit_filed: 2,
  lit_event_scheduled: 4,
  lit_completed_combined: 3,
  settlement: 1,
  disbursement: 1,
} as const;
