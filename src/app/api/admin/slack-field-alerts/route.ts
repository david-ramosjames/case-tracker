import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { getSettings, updateSlackFieldAlertSettings } from "@/lib/supabase/services";

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
    const settings = await getSettings();
    return NextResponse.json({
      graceDays: settings.slackFieldAlertGraceDays,
      disabledAttorneyIds: settings.attorneySlackFieldAlertsDisabled,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Slack field alert settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const sessionUser = await requireApiSession();
  const denied = requireAdmin(sessionUser);
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const graceDays = Number(body.graceDays);
    const disabledAttorneyIds = Array.isArray(body.disabledAttorneyIds)
      ? body.disabledAttorneyIds.filter((id): id is string => typeof id === "string")
      : [];

    const updated = await updateSlackFieldAlertSettings({ graceDays, disabledAttorneyIds });
    return NextResponse.json({
      graceDays: updated.slackFieldAlertGraceDays,
      disabledAttorneyIds: updated.attorneySlackFieldAlertsDisabled,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save Slack field alert settings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
