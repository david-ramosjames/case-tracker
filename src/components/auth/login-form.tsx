"use client";

import { useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { signInWithGoogleAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getClientAppOrigin } from "@/lib/auth/redirect-url";

const ERROR_MESSAGES: Record<string, string> = {
  domain: "Only @ramosjames.com Google accounts can sign in.",
  auth: "Sign-in failed. Please try again.",
  config: "Google sign-in is not configured yet. Check Supabase Auth settings.",
  redirect: "Supabase redirected to the wrong URL. Add your app callback URL in Supabase → Authentication → URL Configuration (see docs/GOOGLE_AUTH_SETUP.md).",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const queryError = useMemo(() => {
    const code = searchParams.get("error");
    if (!code) return null;
    return ERROR_MESSAGES[code] ?? "Unable to sign in.";
  }, [searchParams]);

  const configuredOrigin = getClientAppOrigin();

  function handleSignIn() {
    setErrorMessage(null);
    const nextPath = searchParams.get("next") || "/";

    startTransition(async () => {
      try {
        const { url } = await signInWithGoogleAction(nextPath);
        window.location.assign(url);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to start Google sign-in.");
      }
    });
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Ramos James Law Case Tracker</CardTitle>
        <CardDescription>Sign in with your firm Google account to access cases, forecasts, and notes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Only @ramosjames.com email addresses are allowed.</p>
        {configuredOrigin ? (
          <p className="text-xs text-muted-foreground">
            Sign-in will return to <span className="font-medium text-navy-950">{configuredOrigin}</span>
            {typeof window !== "undefined" && configuredOrigin !== window.location.origin ? (
              <span> (not {window.location.origin} — set NEXT_PUBLIC_SITE_URL or update Supabase redirect URLs)</span>
            ) : null}
          </p>
        ) : null}
        {queryError ? <p className="text-sm text-destructive">{queryError}</p> : null}
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        <Button className="w-full" variant="pink" onClick={handleSignIn} disabled={isPending}>
          {isPending ? "Redirecting..." : "Continue with Google"}
        </Button>
      </CardContent>
    </Card>
  );
}
