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

export function getCsvCell(row: string[], headers: string[], headerName: string, occurrence = 0) {
  const normalizedTarget = normalizeCsvHeader(headerName);
  let seen = 0;

  for (let index = 0; index < headers.length; index += 1) {
    if (normalizeCsvHeader(headers[index]) === normalizedTarget) {
      if (seen === occurrence) return row[index]?.trim() ?? "";
      seen += 1;
    }
  }

  return "";
}

export function hasCsvHeader(row: string[], headerName: string) {
  return row.some((cell) => normalizeCsvHeader(cell) === normalizeCsvHeader(headerName));
}

export function normalizeCsvHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function cleanCaseNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return String(Math.trunc(numeric));
  return trimmed;
}
