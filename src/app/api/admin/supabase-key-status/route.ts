import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { getSupabaseKeyStatus } from "@/lib/supabase/env";

export async function GET() {
  const sessionUser = await requireApiSession();
  if (!sessionUser) return unauthorizedResponse();
  if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  return NextResponse.json(getSupabaseKeyStatus());
}
