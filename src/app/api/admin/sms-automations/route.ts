import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import {
  createSmsAutomation,
  listSmsAutomations,
  type SmsAutomationInput,
  type SmsAutomationTriggerType,
} from "@/lib/supabase/sms-automations";
import { type CaseStage } from "@/lib/types";

function requireAdmin(sessionUser: Awaited<ReturnType<typeof requireApiSession>>) {
  if (!sessionUser) return unauthorizedResponse();
  if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  return null;
}

function parseAutomationBody(body: Record<string, unknown>): SmsAutomationInput | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const messageEn = typeof body.messageEn === "string" ? body.messageEn.trim() : "";
  const messageEs = typeof body.messageEs === "string" ? body.messageEs.trim() : "";
  const triggerType: SmsAutomationTriggerType =
    body.triggerType === "time_in_stage"
      ? "time_in_stage"
      : body.triggerType === "manual"
        ? "manual"
        : "stage_change";

  if (!name || !messageEn || !messageEs) {
    return { error: "Name and both messages are required." };
  }

  const fromStages = Array.isArray(body.fromStages) ? (body.fromStages as CaseStage[]) : [];
  const inStages = Array.isArray(body.inStages) ? (body.inStages as CaseStage[]) : [];
  const fromStage = (body.fromStage as CaseStage | "any" | undefined) ?? (fromStages.length > 0 ? fromStages[0] : "any");
  const excludedToStages = Array.isArray(body.excludedToStages) ? (body.excludedToStages as CaseStage[]) : [];
  const excludedAttorneyContactIds = Array.isArray(body.excludedAttorneyContactIds)
    ? (body.excludedAttorneyContactIds as string[])
    : [];

  const delayDaysRaw = body.delayDaysAfterSigning;
  const delayDaysAfterSigning =
    delayDaysRaw === null || delayDaysRaw === "" || delayDaysRaw === undefined ? null : Number(delayDaysRaw);
  const delayHoursRaw = body.delayHoursAfterSigning;
  const delayHoursAfterSigning =
    delayHoursRaw === null || delayHoursRaw === "" || delayHoursRaw === undefined ? null : Number(delayHoursRaw);
  const delayDaysInStageRaw = body.delayDaysInStage;
  const delayDaysInStage =
    delayDaysInStageRaw === null || delayDaysInStageRaw === "" || delayDaysInStageRaw === undefined
      ? null
      : Number(delayDaysInStageRaw);
  const delayHoursInStageRaw = body.delayHoursInStage;
  const delayHoursInStage =
    delayHoursInStageRaw === null || delayHoursInStageRaw === "" || delayHoursInStageRaw === undefined
      ? null
      : Number(delayHoursInStageRaw);

  if (delayDaysAfterSigning != null && (!Number.isFinite(delayDaysAfterSigning) || delayDaysAfterSigning < 0)) {
    return { error: "Delay after signing (days) must be a non-negative number." };
  }
  if (delayHoursAfterSigning != null && (!Number.isFinite(delayHoursAfterSigning) || delayHoursAfterSigning < 0)) {
    return { error: "Delay after signing (hours) must be a non-negative number." };
  }
  if (delayDaysInStage != null && (!Number.isFinite(delayDaysInStage) || delayDaysInStage < 0)) {
    return { error: "Time in stage (days) must be a non-negative number." };
  }
  if (delayHoursInStage != null && (!Number.isFinite(delayHoursInStage) || delayHoursInStage < 0)) {
    return { error: "Time in stage (hours) must be a non-negative number." };
  }

  if (triggerType === "manual") {
    return {
      name,
      enabled: body.enabled !== false,
      triggerType,
      fromStage: "any",
      fromStages: [],
      toStage: "Onboarding",
      excludedToStages: [],
      inStages: [],
      caseTypes: Array.isArray(body.caseTypes) ? (body.caseTypes as string[]) : [],
      delayDaysAfterSigning: null,
      delayHoursAfterSigning: null,
      delayDaysInStage: null,
      delayHoursInStage: null,
      excludedAttorneyContactIds: [],
      messageEn,
      messageEs,
      youtubeUrlEn: typeof body.youtubeUrlEn === "string" ? body.youtubeUrlEn.trim() || null : null,
      youtubeUrlEs: typeof body.youtubeUrlEs === "string" ? body.youtubeUrlEs.trim() || null : null,
    };
  }

  if (triggerType === "time_in_stage") {
    if (inStages.length === 0) {
      return { error: "Select at least one stage for a time-in-stage automation." };
    }
    if (
      delayDaysAfterSigning == null &&
      delayHoursAfterSigning == null &&
      delayDaysInStage == null &&
      delayHoursInStage == null
    ) {
      return { error: "Set a delay after signing, a time in stage, or both." };
    }

    return {
      name,
      enabled: body.enabled !== false,
      triggerType,
      fromStage: "any",
      fromStages: [],
      toStage: inStages[0]!,
      excludedToStages: [],
      inStages,
      caseTypes: Array.isArray(body.caseTypes) ? (body.caseTypes as string[]) : [],
      delayDaysAfterSigning,
      delayHoursAfterSigning,
      delayDaysInStage,
      delayHoursInStage,
      excludedAttorneyContactIds,
      messageEn,
      messageEs,
      youtubeUrlEn: typeof body.youtubeUrlEn === "string" ? body.youtubeUrlEn.trim() || null : null,
      youtubeUrlEs: typeof body.youtubeUrlEs === "string" ? body.youtubeUrlEs.trim() || null : null,
    };
  }

  const toStage = body.toStage as CaseStage | "any" | undefined;
  if (!toStage) {
    return { error: "Destination stage is required for stage-change automations." };
  }

  return {
    name,
    enabled: body.enabled !== false,
    triggerType,
    fromStage,
    fromStages,
    toStage,
    excludedToStages,
    inStages: [],
    caseTypes: Array.isArray(body.caseTypes) ? (body.caseTypes as string[]) : [],
    delayDaysAfterSigning,
    delayHoursAfterSigning,
    delayDaysInStage: null,
    delayHoursInStage: null,
    excludedAttorneyContactIds,
    messageEn,
    messageEs,
    youtubeUrlEn: typeof body.youtubeUrlEn === "string" ? body.youtubeUrlEn.trim() || null : null,
    youtubeUrlEs: typeof body.youtubeUrlEs === "string" ? body.youtubeUrlEs.trim() || null : null,
  };
}

export async function GET() {
  const sessionUser = await requireApiSession();
  const denied = requireAdmin(sessionUser);
  if (denied) return denied;

  try {
    const automations = await listSmsAutomations();
    return NextResponse.json({ automations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load SMS automations.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const sessionUser = await requireApiSession();
  const denied = requireAdmin(sessionUser);
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parseAutomationBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const automation = await createSmsAutomation(parsed);
    return NextResponse.json({ automation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create SMS automation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
