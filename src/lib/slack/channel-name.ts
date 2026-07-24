import { cleanCaseNumber } from "@/lib/csv/parse";

/**
 * Slack case channels are typically `{clientslug}-{caseNumber}` (e.g. abelperez-835).
 * Attorney reassignment does not change that pattern; we only normalize when rebuilding
 * from client name + case number, or preserve the current name when already well-formed.
 */
export function buildCaseSlackChannelName(input: {
  clientName: string;
  caseNumber: string;
  currentName?: string | null;
}) {
  const caseNumber = cleanCaseNumber(input.caseNumber);
  if (!caseNumber) return null;

  const current = input.currentName?.trim().replace(/^#/, "") ?? "";
  if (current) {
    const suffixMatch = current.match(/-(\d+)$/);
    if (suffixMatch && cleanCaseNumber(suffixMatch[1]) === caseNumber) {
      // Keep existing slug when the channel already ends with this case number.
      return current.toLowerCase();
    }
  }

  const slug = slugifyClientName(input.clientName);
  if (!slug) return current || null;
  return `${slug}-${caseNumber}`;
}

function slugifyClientName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 60);
}
