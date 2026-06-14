import { recordsEligibleForTreatmentPromotion } from "@/lib/stage-triggers";
import { processDailyPulseRecap } from "@/lib/slack/stage-confirmation";
import { getCases, updateTrackerEntry } from "@/lib/supabase/services";
import { type CaseRecord } from "@/lib/types";

export async function promoteOnboardingToTreatment(records?: CaseRecord[]) {
  const list = records ?? (await getCases());
  const eligible = recordsEligibleForTreatmentPromotion(list);
  let promoted = 0;

  for (const record of eligible) {
    if (record.tracker.caseStage !== "Onboarding") continue;

    try {
      await updateTrackerEntry(
        record.shared.id,
        { caseStage: "Txt" },
        {
          actor: { userName: "Automatic stage trigger" },
          markReviewed: false,
          changeInput: { caseStage: "Txt" },
        },
      );
      promoted += 1;
    } catch (error) {
      console.error(
        `Treatment promotion failed for case ${record.shared.caseNumber} (${record.shared.id})`,
        error,
      );
    }
  }

  return { promoted, eligible: eligible.length };
}

export async function runDailyStageWorkflow(options?: { forcePulse?: boolean }) {
  const records = await getCases();
  const treatment = await promoteOnboardingToTreatment(records);
  const pulse = await processDailyPulseRecap({ force: options?.forcePulse });

  return { treatment, pulse };
}
