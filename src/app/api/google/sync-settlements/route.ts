import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { syncSettlementsFromGoogleSheet } from "@/lib/google/settlements-sync";

export async function POST() {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const result = await syncSettlementsFromGoogleSheet();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Settlement sheet sync failed", error);
    const message = error instanceof Error ? error.message : "Settlement sheet sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
