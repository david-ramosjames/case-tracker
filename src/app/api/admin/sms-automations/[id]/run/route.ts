import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import {
  getManualAttorneyDepartureSmsProgress,
  processManualAttorneyDepartureSms,
} from "@/lib/sms/workflow";

export const maxDuration = 300;

function requireAdmin(sessionUser: Awaited<ReturnType<typeof requireApiSession>>) {
  if (!sessionUser) return unauthorizedResponse();
  if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await requireApiSession();
  const denied = requireAdmin(sessionUser);
  if (denied) return denied;

  const { id } = await params;
  const attorneyContactId = new URL(request.url).searchParams.get("attorneyContactId")?.trim() ?? "";
  if (!attorneyContactId) {
    return NextResponse.json({ error: "Select the departing attorney." }, { status: 400 });
  }

  try {
    const result = await getManualAttorneyDepartureSmsProgress({
      automationId: id,
      attorneyContactId,
    });

    if ("reason" in result && result.reason) {
      const messages: Record<string, string> = {
        automation_not_found: "Automation not found.",
        not_manual_automation: "Only manual automations have send progress.",
        attorney_required: "Select the departing attorney.",
      };
      return NextResponse.json(
        { error: messages[result.reason] ?? result.reason, ...result },
        { status: 400 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load SMS progress.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await requireApiSession();
  const denied = requireAdmin(sessionUser);
  if (denied) return denied;

  const { id } = await params;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      attorneyContactId?: string;
      dryRun?: boolean;
      batchSize?: number;
    };
    const attorneyContactId = typeof body.attorneyContactId === "string" ? body.attorneyContactId.trim() : "";
    if (!attorneyContactId) {
      return NextResponse.json({ error: "Select the departing attorney." }, { status: 400 });
    }

    const result = await processManualAttorneyDepartureSms({
      automationId: id,
      attorneyContactId,
      dryRun: Boolean(body.dryRun),
      batchSize: typeof body.batchSize === "number" ? body.batchSize : undefined,
    });

    if ("reason" in result && result.reason) {
      const messages: Record<string, string> = {
        quo_disabled: "Quo is not configured (QUO_API_KEY / QUO_FROM_PHONE) — cannot send SMS.",
        automation_not_found: "Automation not found.",
        not_manual_automation: "Only manual automations can be run on demand.",
        automation_disabled: "Enable the automation before running it.",
        attorney_required: "Select the departing attorney.",
      };
      return NextResponse.json(
        { error: messages[result.reason] ?? result.reason, ...result },
        { status: 400 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send manual SMS.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
