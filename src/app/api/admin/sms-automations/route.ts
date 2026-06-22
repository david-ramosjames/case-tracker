import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { createSmsAutomation, listSmsAutomations } from "@/lib/supabase/sms-automations";
import { type CaseStage } from "@/lib/types";

function requireAdmin(sessionUser: Awaited<ReturnType<typeof requireApiSession>>) {
  if (!sessionUser) return unauthorizedResponse();
  if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  return null;
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

    if (!body.name?.trim() || !body.toStage || !body.messageEn?.trim() || !body.messageEs?.trim()) {
      return NextResponse.json({ error: "Name, to stage, and both messages are required." }, { status: 400 });
    }

    const automation = await createSmsAutomation({
      name: body.name,
      enabled: body.enabled,
      fromStage: body.fromStage ?? "any",
      toStage: body.toStage,
      caseTypes: body.caseTypes ?? [],
      messageEn: body.messageEn,
      messageEs: body.messageEs,
      youtubeUrlEn: body.youtubeUrlEn,
      youtubeUrlEs: body.youtubeUrlEs,
    });

    return NextResponse.json({ automation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create SMS automation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
