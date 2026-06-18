import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { resetSettlementFinancialBackfill } from "@/lib/supabase/services";

export async function POST() {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const result = await resetSettlementFinancialBackfill();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Settlement financial backfill reset failed", error);
    const message = error instanceof Error ? error.message : "Settlement financial backfill reset failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
