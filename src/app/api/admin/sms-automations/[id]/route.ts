import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { deleteSmsAutomation, updateSmsAutomation } from "@/lib/supabase/sms-automations";
import { type CaseStage } from "@/lib/types";

function requireAdmin(sessionUser: Awaited<ReturnType<typeof requireApiSession>>) {
  if (!sessionUser) return unauthorizedResponse();
  if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  return null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await requireApiSession();
  const denied = requireAdmin(sessionUser);
  if (denied) return denied;

  const { id } = await params;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) patch.name = body.name;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.triggerType !== undefined) patch.triggerType = body.triggerType;
    if (body.fromStage !== undefined) patch.fromStage = body.fromStage;
    if (body.fromStages !== undefined) patch.fromStages = body.fromStages;
    if (body.inStages !== undefined) patch.inStages = body.inStages;
    if (body.toStage !== undefined) patch.toStage = body.toStage;
    if (body.excludedToStages !== undefined) patch.excludedToStages = body.excludedToStages;
    if (body.caseTypes !== undefined) patch.caseTypes = body.caseTypes;
    if (body.delayDaysAfterSigning !== undefined) {
      const delayRaw = body.delayDaysAfterSigning;
      patch.delayDaysAfterSigning =
        delayRaw === null || delayRaw === "" ? null : Number(delayRaw);
    }
    if (body.delayHoursAfterSigning !== undefined) {
      const delayRaw = body.delayHoursAfterSigning;
      patch.delayHoursAfterSigning =
        delayRaw === null || delayRaw === "" ? null : Number(delayRaw);
    }
    if (body.attorneyContactIds !== undefined) patch.attorneyContactIds = body.attorneyContactIds;
    if (body.messageEn !== undefined) patch.messageEn = body.messageEn;
    if (body.messageEs !== undefined) patch.messageEs = body.messageEs;
    if (body.youtubeUrlEn !== undefined) patch.youtubeUrlEn = body.youtubeUrlEn;
    if (body.youtubeUrlEs !== undefined) patch.youtubeUrlEs = body.youtubeUrlEs;

    const automation = await updateSmsAutomation(id, patch as Parameters<typeof updateSmsAutomation>[1]);
    return NextResponse.json({ automation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update SMS automation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await requireApiSession();
  const denied = requireAdmin(sessionUser);
  if (denied) return denied;

  const { id } = await params;

  try {
    await deleteSmsAutomation(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete SMS automation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
