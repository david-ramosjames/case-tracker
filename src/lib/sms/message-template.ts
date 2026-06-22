import { type CaseStage } from "@/lib/types";

const STAGE_LABELS: Record<CaseStage, { en: string; es: string }> = {
  Onboarding: { en: "onboarding", es: "incorporación" },
  Txt: { en: "treatment", es: "tratamiento" },
  Dmd: { en: "demand", es: "demanda" },
  Lit: { en: "litigation", es: "litigio" },
  Settled: { en: "settlement", es: "acuerdo" },
  Disengaged: { en: "disengaged", es: "desvinculado" },
  Terminated: { en: "terminated", es: "terminado" },
  Referred: { en: "referred", es: "referido" },
};

export function stageLabel(stage: CaseStage, language: "en" | "es") {
  return STAGE_LABELS[stage]?.[language] ?? stage;
}

export function renderSmsMessage(
  template: string,
  context: {
    clientName: string;
    caseNumber: string;
    fromStage: CaseStage;
    toStage: CaseStage;
    language: "en" | "es";
    youtubeUrl?: string | null;
  },
) {
  let message = template
    .replaceAll("{{clientName}}", context.clientName)
    .replaceAll("{{caseNumber}}", context.caseNumber)
    .replaceAll("{{fromStage}}", stageLabel(context.fromStage, context.language))
    .replaceAll("{{toStage}}", stageLabel(context.toStage, context.language));

  if (context.youtubeUrl?.trim()) {
    message = `${message.trim()}\n\n${context.youtubeUrl.trim()}`;
  }

  return message.trim();
}
