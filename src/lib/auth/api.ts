import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";

export async function requireApiSession() {
  try {
    return await requireSessionUser();
  } catch {
    return null;
  }
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
