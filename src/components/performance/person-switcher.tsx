"use client";

import { useRouter } from "next/navigation";
import { type AppUser } from "@/lib/types";

export function PersonSwitcher({
  people,
  selectedId,
  basePath,
  label = "Viewing",
}: {
  people: AppUser[];
  selectedId: string | null;
  basePath: string;
  label?: string;
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
          const href = id ? `${basePath}?person=${id}` : basePath;
          router.push(href);
        }}
      >
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
            {person.role ? ` (${person.role.replaceAll("_", " ")})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
