"use client";

type CaseOption = { id: string; caseNumber: string; clientName: string };

export function CasePicker({
  cases,
  value,
  onChange,
  coverOthers,
  onCoverOthersChange,
  required = true,
  mineLabel = "My cases",
  coverLabel = "Include other cases (cover)",
}: {
  cases: CaseOption[];
  value: string;
  onChange: (caseId: string) => void;
  coverOthers: boolean;
  onCoverOthersChange: (next: boolean) => void;
  required?: boolean;
  mineLabel?: string;
  coverLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="space-y-1 text-sm block">
        <span className="font-medium">Case{required ? "" : " (optional)"}</span>
        <select
          className="w-full rounded-md border px-3 py-2"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        >
          <option value="">{required ? "Select case" : "Optional"}</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.caseNumber} — {c.clientName}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={coverOthers}
          onChange={(e) => onCoverOthersChange(e.target.checked)}
        />
        Include other people’s cases (cover)
      </label>
      <p className="text-[11px] text-slate-400">{coverOthers ? coverLabel : mineLabel}</p>
    </div>
  );
}
