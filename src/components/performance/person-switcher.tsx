"use client";

import { useRouter } from "next/navigation";
import { type AppUser } from "@/lib/types";

export function PersonSwitcher({
  people,
  selectedId,
  basePath,
  label = "Viewing",
  query,
}: {
  people: AppUser[];
  selectedId: string | null;
  basePath: string;
  label?: string;
  /** Extra query params to keep when switching people (e.g. week). */
  query?: Record<string, string | undefined | null>;
}) {
  const router = useRouter();

  return (
    <label className="inline-flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <select
        className="min-w-[12rem] rounded-md border px-3 py-2"
        value={selectedId ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(query ?? {})) {
            if (value) params.set(key, value);
          }
          if (id) params.set("person", id);
          else params.delete("person");
          const qs = params.toString();
          router.push(qs ? `${basePath}?${qs}` : basePath);
        }}
      >
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
    </label>
  );
}
