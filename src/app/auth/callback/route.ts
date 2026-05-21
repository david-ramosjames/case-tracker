import { NextResponse } from "next/server";
import { isAllowedEmail } from "@/lib/auth/constants";
import { provisionUserRole } from "@/lib/auth/provision-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = requestUrl.searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=auth", requestUrl.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Auth callback failed", error);
    return NextResponse.redirect(new URL("/login?error=auth", requestUrl.origin));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=domain", requestUrl.origin));
  }

  try {
    await provisionUserRole(user.id, user.email);
  } catch (provisionError) {
    console.error("Unable to provision user role", provisionError);
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=config", requestUrl.origin));
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}
