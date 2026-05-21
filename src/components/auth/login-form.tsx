"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const ERROR_MESSAGES: Record<string, string> = {
  domain: "Only @ramosjames.com Google accounts can sign in.",
  auth: "Sign-in failed. Please try again.",
  config: "Google sign-in is not configured yet. Check Supabase Auth settings.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const queryError = useMemo(() => {
    const code = searchParams.get("error");
    if (!code) return null;
    return ERROR_MESSAGES[code] ?? "Unable to sign in.";
  }, [searchParams]);

  async function signInWithGoogle() {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const nextPath = searchParams.get("next") || "/";
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { error } = await supabase.auth.signInWithOAuth({
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

      if (error) throw error;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to start Google sign-in.");
      setIsLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Ramos James Law Case Tracker</CardTitle>
        <CardDescription>Sign in with your firm Google account to access cases, forecasts, and notes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Only @ramosjames.com email addresses are allowed.</p>
        {queryError ? <p className="text-sm text-destructive">{queryError}</p> : null}
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        <Button className="w-full" variant="pink" onClick={signInWithGoogle} disabled={isLoading}>
          {isLoading ? "Redirecting..." : "Continue with Google"}
        </Button>
      </CardContent>
    </Card>
  );
}
