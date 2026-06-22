import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { syncQuoPhonesToTracker } from "@/lib/sms/workflow";

export async function POST() {
  const sessionUser = await requireApiSession();
  if (!sessionUser) return unauthorizedResponse();
  if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const result = await syncQuoPhonesToTracker();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quo contact sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
