"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

function isModifiedClick(event: MouseEvent) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

/** Shows immediately on an in-app link click, before the next page finishes loading. */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
    document.querySelectorAll("a[data-pending]").forEach((link) => link.removeAttribute("data-pending"));
  }, [pathname, searchParams]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || isModifiedClick(event)) return;
      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      document.querySelectorAll("a[data-pending]").forEach((link) => link.removeAttribute("data-pending"));
      anchor.setAttribute("data-pending", "true");
      setPendingHref(url.pathname + url.search);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (!pendingHref) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50" role="status" aria-live="polite">
      <div className="h-1 overflow-hidden bg-pink-100">
        <div className="nav-progress-bar h-full w-1/3 bg-pink-500" />
      </div>
      <div className="mx-auto mt-3 w-fit rounded-full bg-navy-950 px-4 py-2 text-sm font-semibold text-white shadow-lg">
        Loading page…
      </div>
    </div>
  );
}
