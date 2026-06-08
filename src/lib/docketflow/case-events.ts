import type { DocketFlowScheduledEvent } from "@/lib/types";

type CaseEventRow = {
  id: string;
  case_id: string;
  title: string;
  date: string;
  deadline_end_date?: string | null;
  start_date_time?: string | null;
  end_date_time?: string | null;
  category?: string | null;
  event_kind?: string | null;
  schedule_kind?: string | null;
  included?: boolean | null;
  completed?: boolean | null;
  calendar_origin?: string | null;
};

function todayYmd(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function deadlineInclusiveEndDate(ev: Pick<DocketFlowScheduledEvent, "date" | "deadlineEndDate" | "startDateTime">): string {
  if (ev.startDateTime) return ev.date;
  const last = ev.deadlineEndDate?.trim();
  if (last && last >= ev.date) return last;
  return ev.date;
}

function rowToScheduledEvent(row: CaseEventRow): DocketFlowScheduledEvent {
  const rawEnd = row.deadline_end_date?.trim()?.slice(0, 10);
  const deadlineEnd =
    rawEnd && /^\d{4}-\d{2}-\d{2}$/.test(rawEnd) && rawEnd > row.date ? rawEnd : null;

  return {
    id: row.id,
    caseId: row.case_id,
    title: row.title,
    date: row.date,
    deadlineEndDate: deadlineEnd,
    startDateTime: row.start_date_time ?? null,
    endDateTime: row.end_date_time ?? null,
    category: row.category ?? null,
    eventKind: row.event_kind ?? null,
    scheduleKind: row.schedule_kind === "meeting" ? "meeting" : "deadline",
    included: row.included !== false,
    completed: Boolean(row.completed),
    calendarOrigin: row.calendar_origin === "google_ics_mirror" ? "google_ics_mirror" : "docketflow",
  };
}

function compareScheduledEvents(a: DocketFlowScheduledEvent, b: DocketFlowScheduledEvent): number {
  const d = a.date.localeCompare(b.date);
  if (d !== 0) return d;
  const ta = a.startDateTime ?? "";
  const tb = b.startDateTime ?? "";
  if (ta !== tb) return ta.localeCompare(tb);
  return a.title.localeCompare(b.title);
}

function isUpcomingEvent(ev: DocketFlowScheduledEvent, now = new Date()): boolean {
  if (!ev.included || ev.completed) return false;
  if (ev.calendarOrigin === "google_ics_mirror") return false;
  if (ev.startDateTime) {
    const start = new Date(ev.startDateTime);
    return !Number.isNaN(start.getTime()) && start >= now;
  }
  return deadlineInclusiveEndDate(ev) >= todayYmd(now);
}

export function pickNextScheduledEvents(
  rows: CaseEventRow[],
  limit = 3,
  now = new Date(),
): DocketFlowScheduledEvent[] {
  return rows
    .map(rowToScheduledEvent)
    .filter((ev) => isUpcomingEvent(ev, now))
    .sort(compareScheduledEvents)
    .slice(0, limit);
}

function formatYmd(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return ymd;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export function formatScheduledEventWhen(ev: DocketFlowScheduledEvent): string {
  if (ev.startDateTime) {
    if (ev.endDateTime) return `${formatDateTime(ev.startDateTime)} → ${formatDateTime(ev.endDateTime)}`;
    return formatDateTime(ev.startDateTime);
  }
  if (ev.deadlineEndDate && ev.deadlineEndDate > ev.date) {
    return `${formatYmd(ev.date)} → ${formatYmd(ev.deadlineEndDate)}`;
  }
  return formatYmd(ev.date);
}
