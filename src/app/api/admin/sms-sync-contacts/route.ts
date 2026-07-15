import { NextResponse, type NextRequest } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { syncQuoPhonesToTracker } from "@/lib/sms/workflow";

export async function POST(request: NextRequest) {
  const sessionUser = await requireApiSession();
  if (!sessionUser) return unauthorizedResponse();
  if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { caseNumbers?: string[] };
    const caseNumbers = Array.isArray(body.caseNumbers) ? body.caseNumbers : undefined;
    const result = await syncQuoPhonesToTracker(caseNumbers);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quo contact sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
