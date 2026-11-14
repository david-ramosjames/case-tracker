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

/** Workbook 3-bucket Overall; no 100% cap. */
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
  actualLitCompleted: number;
  targetLitCompleted: number;
  actualSettlements: number;
  targetSettlements: number;
  actualDisbursements: number;
  targetDisbursements: number;
};

/** Attorney attainment only — workbook has no weighted Overall. */
export function scoreAttorneyWeek(input: AttorneyScoreInputs) {
  return {
    litCompleted: attainmentRatio(input.actualLitCompleted, input.targetLitCompleted),
    settlements: attainmentRatio(input.actualSettlements, input.targetSettlements),
    disbursements: attainmentRatio(input.actualDisbursements, input.targetDisbursements),
  };
}

export const DEFAULT_PARALEGAL_TARGETS = {
  demand_sent: 1,
  lawsuit_filed: 1,
  discovery_responses: 2,
  lit_event_scheduled: 3,
} as const;

export const DEFAULT_ATTORNEY_TARGETS = {
  lit_completed_combined: 3,
  settlement: 1,
  disbursement: 1,
} as const;
