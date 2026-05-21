import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { importCaseBackfillCsv } from "@/lib/supabase/services";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const body = (await request.json()) as { csv?: string; dryRun?: boolean };
    if (!body.csv?.trim()) {
      return NextResponse.json({ error: "CSV content is required." }, { status: 400 });
    }

    const result = await importCaseBackfillCsv(body.csv, {
      dryRun: Boolean(body.dryRun),
      actor: { userId: sessionUser.id, userName: sessionUser.name },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("CSV backfill import failed", error);
    const message = error instanceof Error ? error.message : "CSV backfill import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
