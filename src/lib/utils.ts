import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message) return record.message;
    if (typeof record.error === "string" && record.error) return record.error;
    if (typeof record.details === "string" && record.details) return record.details;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

export function formatCurrency(value: number | null | undefined) {
  if (value == null) return "Not set";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function parseNumberInput(value: string) {
  const cleaned = String(value).replace(/[$,\s]/g, "");
  if (!cleaned) return 0;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

export function formatNumberInput(value: string | number) {
  if (typeof value === "string" && value.replace(/[$,\s]/g, "") === "") return "";
  const numeric = typeof value === "number" ? Math.round(value) : parseNumberInput(value);
  if (!Number.isFinite(numeric)) return "";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(numeric);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Not reviewed";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatOptionalDate(value: string | null | undefined) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function getCurrentQuarter(date = new Date()) {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()} Q${quarter}`;
}

export function getQuarterElapsedPercentage(date = new Date()) {
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  const start = new Date(date.getFullYear(), quarterStartMonth, 1);
  const end = new Date(date.getFullYear(), quarterStartMonth + 3, 0, 23, 59, 59);
  return clamp(((date.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100, 0, 100);
}

export function getYearElapsedPercentage(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 1);
  const end = new Date(date.getFullYear(), 11, 31, 23, 59, 59);
  return clamp(((date.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100, 0, 100);
}

export function daysSince(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const diff = Date.now() - new Date(value).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function percent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value)}%`;
}

export function getCalculatedAttorneyFees(settlementAmount: number | null | undefined, feePercent: number | null | undefined) {
  if (settlementAmount == null || feePercent == null) return null;
  return Math.round(settlementAmount * feePercent);
}
