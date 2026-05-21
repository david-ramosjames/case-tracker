import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isAllowedEmail } from "@/lib/auth/constants";
import { getAppOrigin } from "@/lib/auth/redirect-url.server";
import { provisionUserRole } from "@/lib/auth/provision-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = await getAppOrigin();
  const code = requestUrl.searchParams.get("code");
  const cookieStore = await cookies();
  const nextPath = requestUrl.searchParams.get("next") ?? cookieStore.get("auth_next")?.value ?? "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=auth", origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Auth callback failed", error);
    return NextResponse.redirect(new URL("/login?error=auth", origin));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=domain", origin));
  }

  try {
    await provisionUserRole(user.id, user.email);
  } catch (provisionError) {
    console.error("Unable to provision user role", provisionError);
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=config", origin));
  }

  cookieStore.delete("auth_next");

  const destination = nextPath.startsWith("/") ? nextPath : "/";
  return NextResponse.redirect(new URL(destination, origin));
}
