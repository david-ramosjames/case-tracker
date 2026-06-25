import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { createSmsAutomation, listSmsAutomations, type SmsAutomationInput } from "@/lib/supabase/sms-automations";
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
  const toStage = body.toStage as CaseStage | "any" | undefined;

  if (!name || !toStage || !messageEn || !messageEs) {
    return { error: "Name, destination stage, and both messages are required." };
  }

  const fromStages = Array.isArray(body.fromStages) ? (body.fromStages as CaseStage[]) : [];
  const fromStage = (body.fromStage as CaseStage | "any" | undefined) ?? (fromStages.length > 0 ? fromStages[0] : "any");
  const excludedToStages = Array.isArray(body.excludedToStages) ? (body.excludedToStages as CaseStage[]) : [];
  const attorneyContactIds = Array.isArray(body.attorneyContactIds) ? (body.attorneyContactIds as string[]) : [];
  const delayRaw = body.delayDaysAfterSigning;
  const delayDaysAfterSigning =
    delayRaw === null || delayRaw === "" || delayRaw === undefined
      ? null
      : Number(delayRaw);

  if (delayDaysAfterSigning != null && (!Number.isFinite(delayDaysAfterSigning) || delayDaysAfterSigning < 0)) {
    return { error: "Delay after signing must be a non-negative number of days." };
  }

  return {
    name,
    enabled: body.enabled !== false,
    fromStage,
    fromStages,
    toStage,
    excludedToStages,
    caseTypes: Array.isArray(body.caseTypes) ? (body.caseTypes as string[]) : [],
    delayDaysAfterSigning,
    attorneyContactIds,
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
