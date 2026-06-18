import { getCurrentCommissionYear } from "@/lib/commission-year";
import { goalOverlapsCalendarYear } from "@/lib/attorney-goal-months";
import { type AttorneyGoal, type GoalScope } from "@/lib/types";

export const FIRM_OUTPERFORM_GOAL_ATTORNEY_ID = "__firm_outperform__";
export const FIRM_OUTPERFORM_GOAL_ATTORNEY_NAME = "Firm Outperform";

export function isFirmOutperformGoal(goal: Pick<AttorneyGoal, "goalScope">) {
  return goal.goalScope === "firm";
}

export function partitionGoals(goals: AttorneyGoal[]) {
  const attorneyGoals: AttorneyGoal[] = [];
  const firmGoals: AttorneyGoal[] = [];
  for (const goal of goals) {
    if (isFirmOutperformGoal(goal)) firmGoals.push(goal);
    else attorneyGoals.push(goal);
  }
  return { attorneyGoals, firmGoals };
}

export function getAttorneyOnlyGoals(goals: AttorneyGoal[]) {
  return partitionGoals(goals).attorneyGoals;
}

export function getFirmOutperformGoalForYear(goals: AttorneyGoal[], year: number) {
  return partitionGoals(goals).firmGoals.find((goal) => goal.year === year) ?? null;
}

export function getFirmOutperformGoalForCalendarYear(goals: AttorneyGoal[], calendarYear: number) {
  return partitionGoals(goals).firmGoals.find((goal) => goalOverlapsCalendarYear(goal, calendarYear)) ?? null;
}

export function resolveFirmOutperformCommissionYear(goals: AttorneyGoal[], refDate = new Date()) {
  const { attorneyGoals, firmGoals } = partitionGoals(goals);
  if (attorneyGoals.length > 0) {
    const startMonth = attorneyGoals[0]?.commissionYearStartMonth ?? 1;
    return getCurrentCommissionYear(startMonth, refDate);
  }
  const currentFirmGoal = [...firmGoals].sort((left, right) => right.year - left.year)[0];
  if (currentFirmGoal) return currentFirmGoal.year;
  return getCurrentCommissionYear(1, refDate);
}

export function getCurrentFirmOutperformGoal(goals: AttorneyGoal[], refDate = new Date()) {
  const year = resolveFirmOutperformCommissionYear(goals, refDate);
  return getFirmOutperformGoalForYear(goals, year);
}

export function normalizeGoalScope(value: unknown): GoalScope {
  return value === "firm" ? "firm" : "attorney";
}
