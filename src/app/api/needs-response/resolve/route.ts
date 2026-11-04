import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { resolveNeedsResponse } from "@/lib/needs-response/repository";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();

    const body = (await request.json()) as { id?: string };
    const id = String(body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }

    await resolveNeedsResponse(id, sessionUser.name ?? sessionUser.email ?? null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve needs-response item.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
