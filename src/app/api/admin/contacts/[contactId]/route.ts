import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { updateContactSlackProfile } from "@/lib/supabase/services";

export async function PATCH(request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const { contactId } = await params;
    const body = (await request.json()) as {
      slackUserId?: string | null;
      slackDisplayName?: string | null;
    };

    const user = await updateContactSlackProfile(contactId, {
      slackUserId: body.slackUserId,
      slackDisplayName: body.slackDisplayName,
    });

    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update contact.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
