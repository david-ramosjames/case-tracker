"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cleanCaseNumber } from "@/lib/csv/parse";

export function GlobalCaseSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setIsSearching(true);
    try {
      const digits = trimmed.replace(/^#/, "").replace(/\D/g, "");
      const caseNumber = digits ? cleanCaseNumber(digits) : "";
      if (caseNumber) {
        const response = await fetch(`/api/cases/lookup?caseNumber=${encodeURIComponent(caseNumber)}`);
        if (response.ok) {
          const body = (await response.json()) as { caseId?: string };
          if (body.caseId) {
            router.push(`/cases/${body.caseId}`);
            return;
          }
        }
      }

      router.push(`/cases?q=${encodeURIComponent(trimmed)}`);
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <form className="relative" onSubmit={handleSubmit}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="w-72 pl-9"
        placeholder="Search cases, clients, attorneys..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={isSearching}
        aria-label="Search cases"
      />
    </form>
  );
}
