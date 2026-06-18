export function parseCsv(csvText: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

export function getCsvColumnIndex(headers: string[], headerName: string, occurrence = 0) {
  const normalizedTarget = normalizeCsvHeader(headerName);
  let seen = 0;

  for (let index = 0; index < headers.length; index += 1) {
    if (normalizeCsvHeader(headers[index]) === normalizedTarget) {
      if (seen === occurrence) return index;
      seen += 1;
    }
  }

  return -1;
}

export function getCsvCell(row: string[], headers: string[], headerName: string, occurrence = 0) {
  const columnIndex = getCsvColumnIndex(headers, headerName, occurrence);
  if (columnIndex < 0) return "";
  return row[columnIndex]?.trim() ?? "";
}

export function hasCsvHeader(row: string[], headerName: string) {
  return row.some((cell) => normalizeCsvHeader(cell) === normalizeCsvHeader(headerName));
}

export function hasCsvHeaderAny(row: string[], headerNames: string[]) {
  return headerNames.some((headerName) => hasCsvHeader(row, headerName));
}

/** Return the first non-empty cell matching any of the given header names. */
export function getCsvCellAny(row: string[], headers: string[], headerNames: string[]) {
  for (const headerName of headerNames) {
    const value = getCsvCell(row, headers, headerName);
    if (value) return value;
  }
  return "";
}

function looksLikeSplitThousandsSegment(current: string, next: string) {
  if (!next || !/^\d{3}(\.\d+)?$/.test(next)) return false;

  const normalized = current.trim();
  if (!normalized) return false;
  if (normalized.includes(",")) return true;
  if (/^\$\d{1,3}$/.test(normalized)) return true;
  return /^\d{1,3}$/.test(normalized);
}

function readCsvMoneyRaw(row: string[], startIndex: number) {
  let raw = row[startIndex]?.trim() ?? "";
  if (!raw) return "";

  let index = startIndex + 1;
  while (index < row.length) {
    const next = row[index]?.trim() ?? "";
    if (!looksLikeSplitThousandsSegment(raw, next)) break;
    raw = `${raw},${next}`;
    index += 1;
  }

  return raw;
}

/** Parse currency from a CSV row, rejoining unquoted thousands split across columns (e.g. $100,000). */
export function parseMoney(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let normalized = trimmed.replace(/[$\s]/g, "").replace(/,/g, "");
  const kMatch = /^([\d.]+)k$/i.exec(normalized);
  if (kMatch) {
    const base = Number(kMatch[1]);
    return Number.isFinite(base) ? base * 1000 : null;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getCsvMoneyCell(row: string[], headers: string[], headerName: string, occurrence = 0) {
  const columnIndex = getCsvColumnIndex(headers, headerName, occurrence);
  if (columnIndex < 0) return null;
  return parseMoney(readCsvMoneyRaw(row, columnIndex));
}

/** Return the first parsed money value matching any of the given header names. */
export function getCsvMoneyCellAny(row: string[], headers: string[], headerNames: string[]) {
  for (const headerName of headerNames) {
    const value = getCsvMoneyCell(row, headers, headerName);
    if (value != null) return value;
  }
  return null;
}

export function normalizeCsvHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Parse dates from Google Sheets or CSV (serial numbers, MM/DD/YYYY, ISO, timestamps). */
export function parseSheetDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 25000) {
    return new Date(Date.UTC(1899, 11, 30) + numeric * 24 * 60 * 60 * 1000).toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Parse Y/N (or yes/no) flags from Google Sheets. */
export function parseSheetYesNo(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes" || normalized === "true";
}

export function cleanCaseNumber(value: string) {
  const trimmed = value.trim().replace(/^#+/, "");
  if (!trimmed) return "";

  const withoutSeparators = trimmed.replace(/[$,\s]/g, "");
  if (/^\d+(\.0+)?$/.test(withoutSeparators)) {
    return String(Math.trunc(Number(withoutSeparators)));
  }

  const numeric = Number(withoutSeparators);
  if (Number.isFinite(numeric) && /^[\d#.,\s$+-]+$/.test(trimmed)) {
    return String(Math.trunc(numeric));
  }

  const digitsOnly = trimmed.replace(/[^\d]/g, "");
  if (digitsOnly) {
    const parsed = Number.parseInt(digitsOnly, 10);
    if (Number.isFinite(parsed)) return String(parsed);
  }

  return trimmed;
}

export function caseNumbersMatch(left: string, right: string) {
  const a = cleanCaseNumber(left);
  const b = cleanCaseNumber(right);
  return Boolean(a && b && a === b);
}

/** Numeric sort key for firm case numbers (strips non-digits). */
export function caseNumberSortKey(value: string): number | null {
  const digitsOnly = value.trim().replace(/\D+/g, "");
  if (!digitsOnly) return null;
  const parsed = Number.parseInt(digitsOnly, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Compare case numbers numerically; falls back to string compare when not parseable. */
export function compareCaseNumbers(a: string, b: string): number {
  const aNum = caseNumberSortKey(a);
  const bNum = caseNumberSortKey(b);
  if (aNum !== null && bNum !== null) return aNum - bNum;
  if (aNum !== null) return -1;
  if (bNum !== null) return 1;
  return a.localeCompare(b);
}
