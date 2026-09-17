import { NextResponse } from "next/server";
import { ensureProvisionedSessionUser } from "@/lib/auth/session";

export async function requireApiSession() {
  try {
    const sessionUser = await ensureProvisionedSessionUser();
    if (!sessionUser) return null;
    return sessionUser;
  } catch {
    return null;
  }
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
