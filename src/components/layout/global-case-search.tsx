"use client";

import { FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CaseSearchResult = {
  caseId: string;
  caseNumber: string;
  clientName: string;
  attorneyName: string;
  caseStage: string;
};

export function GlobalCaseSearch() {
  const router = useRouter();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CaseSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const navigateToCase = useCallback(
    (caseId: string) => {
      setIsOpen(false);
      setQuery("");
      setResults([]);
      router.push(`/cases/${caseId}`);
    },
    [router],
  );

  const navigateToAllResults = useCallback(
    (value: string) => {
      setIsOpen(false);
      router.push(`/cases?q=${encodeURIComponent(value)}`);
    },
    [router],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setTotal(0);
      setIsLoading(false);
      setActiveIndex(-1);
      return;
    }

    setResults([]);
    setTotal(0);
    setActiveIndex(-1);
    setIsLoading(true);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/cases/search?q=${encodeURIComponent(trimmed)}&limit=8`, {
            signal: controller.signal,
          });
          if (!response.ok) {
            setResults([]);
            setTotal(0);
            return;
          }
          const body = (await response.json()) as { results?: CaseSearchResult[]; total?: number };
          setResults(body.results ?? []);
          setTotal(body.total ?? 0);
          setActiveIndex(body.results?.length ? 0 : -1);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setResults([]);
          setTotal(0);
        } finally {
          if (!controller.signal.aborted) setIsLoading(false);
        }
      })();
    }, 200);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    if (activeIndex >= 0 && results[activeIndex]) {
      navigateToCase(results[activeIndex].caseId);
      return;
    }

    if (results[0]) {
      navigateToCase(results[0].caseId);
      return;
    }

    navigateToAllResults(trimmed);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1));
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  const showDropdown = isOpen && query.trim().length > 0;
  const hasMore = total > results.length;

  return (
    <div ref={containerRef} className="relative">
      <form onSubmit={handleSubmit}>
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        {isLoading ? (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
        <Input
          className="w-72 pr-9 pl-9"
          placeholder="Search case #, client, attorney..."
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          disabled={false}
          aria-label="Search cases"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-autocomplete="list"
          role="combobox"
        />
      </form>

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute top-[calc(100%+0.35rem)] right-0 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border bg-white shadow-lg"
        >
          {isLoading && results.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">Searching...</p>
          ) : null}

          {!isLoading && results.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">No matching cases.</p>
          ) : null}

          {results.length > 0 ? (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((result, index) => (
                <li key={result.caseId} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors",
                      activeIndex === index ? "bg-muted" : "hover:bg-muted/70",
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => navigateToCase(result.caseId)}
                  >
                    <span className="font-semibold text-navy-950">
                      Case #{result.caseNumber}
                      <span className="font-normal text-muted-foreground"> · {result.clientName}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {result.attorneyName} · {result.caseStage}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {results.length > 0 ? (
            <div className="border-t bg-muted/30 px-3 py-2">
              <button
                type="button"
                className="text-xs font-medium text-navy-900 hover:underline"
                onClick={() => navigateToAllResults(query.trim())}
              >
                {hasMore ? `View all ${total} results in case list` : "View in case list"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
