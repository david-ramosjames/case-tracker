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
    const body = (await request.json()) as {
      name?: string;
      enabled?: boolean;
      fromStage?: CaseStage | "any";
      toStage?: CaseStage;
      caseTypes?: string[];
      messageEn?: string;
      messageEs?: string;
      youtubeUrlEn?: string | null;
      youtubeUrlEs?: string | null;
    };

    const automation = await updateSmsAutomation(id, body);
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
