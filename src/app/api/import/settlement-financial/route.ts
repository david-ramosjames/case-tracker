import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { importSettlementFinancialBackfillCsv } from "@/lib/supabase/services";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const body = (await request.json()) as { csv?: string; dryRun?: boolean; stream?: boolean };
    if (!body.csv?.trim()) {
      return NextResponse.json({ error: "CSV content is required." }, { status: 400 });
    }

    const actor = { userId: sessionUser.id, userName: sessionUser.name };
    const dryRun = Boolean(body.dryRun);

    if (dryRun || !body.stream) {
      const result = await importSettlementFinancialBackfillCsv(body.csv, { dryRun, actor });
      return NextResponse.json(result);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await importSettlementFinancialBackfillCsv(body.csv!, {
            dryRun: false,
            actor,
            onProgress: (progress) => {
              controller.enqueue(encoder.encode(`${JSON.stringify({ type: "progress", ...progress })}\n`));
            },
          });
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "complete", result })}\n`));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Settlement financial import failed.";
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: message })}\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("Settlement financial import failed", error);
    const message = error instanceof Error ? error.message : "Settlement financial import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
