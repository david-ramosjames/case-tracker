import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { processManualAttorneyDepartureSms } from "@/lib/sms/workflow";

function requireAdmin(sessionUser: Awaited<ReturnType<typeof requireApiSession>>) {
  if (!sessionUser) return unauthorizedResponse();
  if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  return null;
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
    };
    const attorneyContactId = typeof body.attorneyContactId === "string" ? body.attorneyContactId.trim() : "";
    if (!attorneyContactId) {
      return NextResponse.json({ error: "Select the departing attorney." }, { status: 400 });
    }

    const result = await processManualAttorneyDepartureSms({
      automationId: id,
      attorneyContactId,
      dryRun: Boolean(body.dryRun),
    });

    if ("reason" in result && result.reason) {
      const messages: Record<string, string> = {
        slack_disabled: "Slack is not configured — cannot queue SMS approvals.",
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
    const message = error instanceof Error ? error.message : "Unable to queue manual SMS.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
