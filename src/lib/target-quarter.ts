/** Normalize quarter text to a standard value; maps legacy 1H/2H to Q2/Q4. */
export function normalizeTargetQuarter(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}$/.test(trimmed)) return `${trimmed} Q4`;

  const qDash = trimmed.match(/^Q([1-4])-(\d{2,4})$/i);
  if (qDash) {
    const year = qDash[2].length === 2 ? `20${qDash[2]}` : qDash[2];
    return `${year} Q${qDash[1]}`;
  }

  const longQ = trimmed.match(/^(\d{4})\s*Q([1-4])$/i);
  if (longQ) return `${longQ[1]} Q${longQ[2]}`;

  const halfDash = trimmed.match(/^([12])H-(\d{2})$/i);
  if (halfDash) {
    const quarter = halfDash[1] === "1" ? "2" : "4";
    return `20${halfDash[2]} Q${quarter}`;
  }

  const halfSpace = trimmed.match(/^(\d{4})\s*([12])H$/i);
  if (halfSpace) {
    const quarter = halfSpace[2] === "1" ? "2" : "4";
    return `${halfSpace[1]} Q${quarter}`;
  }

  return trimmed;
}
