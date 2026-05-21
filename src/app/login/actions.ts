"use server";

import { cookies } from "next/headers";
import { buildAuthCallbackUrl } from "@/lib/auth/redirect-url";
import { getAppOrigin } from "@/lib/auth/redirect-url.server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signInWithGoogleAction(nextPath?: string): Promise<{ url: string }> {
  const safeNext = nextPath?.startsWith("/") ? nextPath : "/";
  const origin = await getAppOrigin();
  const redirectTo = buildAuthCallbackUrl(origin, safeNext);

  const cookieStore = await cookies();
  cookieStore.set("auth_next", safeNext, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    maxAge: 60 * 10,
  });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        hd: "ramosjames.com",
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data.url) {
    throw new Error("Supabase did not return a Google sign-in URL.");
  }

  return { url: data.url };
}
