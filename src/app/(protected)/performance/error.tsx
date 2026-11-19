"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function PerformanceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Performance route error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-3 rounded-lg border bg-white p-6 text-center shadow-sm">
      <h2 className="text-lg font-semibold text-navy-950">Performance couldn’t load</h2>
      <p className="text-sm text-muted-foreground">
        Something went wrong rendering this page. Try again, or switch attorneys from Overview.
      </p>
      {error.message ? (
        <p className="break-words rounded-md bg-slate-50 px-3 py-2 text-left text-xs text-slate-700">
          {error.message}
        </p>
      ) : null}
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
