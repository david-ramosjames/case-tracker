"use client";

import Link from "next/link";
import { Eye, Loader2 } from "lucide-react";
import { Fragment } from "react";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import {
  LitigationEventDateInput,
  LitigationEventStatusSelect,
  updateLitigationEvent,
} from "@/components/litigation/litigation-event-fields";
import { type ViewerContext } from "@/lib/auth/access";
import { compareCaseNumbers } from "@/lib/csv/parse";
import {
  LITIGATION_EVENT_DEFINITIONS,
  isLitigationTabCase,
} from "@/lib/litigation-events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HeaderFilter, HeaderMultiFilter } from "@/components/ui/header-filter";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  type AppUser,
  type CaseRecord,
  type CaseStatus,
  type LitigationEventKey,
  type LitigationEventStatus,
  type LitigationEvents,
  type TrackerEntry,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";

type RowSaveStatus = "saving" | "saved";

type LitigationPersistPatch = {
  litigationEvents: LitigationEvents;
};

const SAVED_INDICATOR_MS = 2500;

function isRowPinnedBySaveFeedback(caseId: string, rowSaveStatus: Record<string, RowSaveStatus>) {
  const status = rowSaveStatus[caseId];
  return status === "saving" || status === "saved";
}

export function LitigationTable({
  records,
  users,
  viewer,
}: {
  records: CaseRecord[];
  users: AppUser[];
  viewer: ViewerContext;
}) {
  const [workingRecords, setWorkingRecords] = useState(() => records.filter(isLitigationTabCase));
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [rowSaveErrors, setRowSaveErrors] = useState<Record<string, string>>({});
  const [rowSaveStatus, setRowSaveStatus] = useState<Record<string, RowSaveStatus>>({});
  const pendingPatchesRef = useRef(new Map<string, LitigationPersistPatch>());
  const preEditSnapshotsRef = useRef(new Map<string, CaseRecord>());
  const persistChainRef = useRef(new Map<string, Promise<void>>());
  const savedIndicatorTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const recordsRef = useRef(workingRecords);
  const recordsVersion = useMemo(
    () => records.map((record) => `${record.shared.id}:${record.tracker.updatedAt}`).join("|"),
    [records],
  );
  const [search, setSearch] = useState("");
  const [caseStatus, setCaseStatus] = useState<"all" | CaseStatus>("Active");
  const [attorneyIds, setAttorneyIds] = useState<string[]>([]);

  const attorneys = useMemo(() => users.filter((user) => user.role === "attorney" && user.active), [users]);

  const filteredRecords = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return workingRecords
      .filter((record) => {
        if (caseStatus !== "all" && record.shared.status !== caseStatus) return false;
        if (viewer.canViewAllCases && attorneyIds.length > 0 && !attorneyIds.includes(record.shared.attorneyId)) {
          return false;
        }
        if (!needle) return true;
        const haystack = [
          record.shared.caseNumber,
          record.shared.clientName,
          record.attorney.name,
          record.paralegal.name,
          record.legalAssistant?.name ?? "",
          ...LITIGATION_EVENT_DEFINITIONS.flatMap(({ key }) => {
            const event = record.tracker.litigationEvents[key];
            return [event.date ?? "", event.status ?? ""];
          }),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => compareCaseNumbers(a.shared.caseNumber, b.shared.caseNumber));
  }, [attorneyIds, caseStatus, search, viewer.canViewAllCases, workingRecords]);

  useEffect(() => {
    recordsRef.current = workingRecords;
  }, [workingRecords]);

  useEffect(() => {
    setWorkingRecords((current) => {
      const pendingCaseIds = new Set(pendingPatchesRef.current.keys());
      const currentById = new Map(current.map((record) => [record.shared.id, record]));
      return records
        .filter(isLitigationTabCase)
        .map((record) => {
          if (pendingCaseIds.has(record.shared.id)) {
            return currentById.get(record.shared.id) ?? record;
          }
          const currentRecord = currentById.get(record.shared.id);
          if (currentRecord && currentRecord.tracker.updatedAt > record.tracker.updatedAt) {
            return currentRecord;
          }
          return record;
        });
    });
  }, [recordsVersion]);

  function markRowSaving(caseId: string) {
    const existing = savedIndicatorTimersRef.current.get(caseId);
    if (existing) {
      clearTimeout(existing);
      savedIndicatorTimersRef.current.delete(caseId);
    }
    setRowSaveStatus((current) => ({ ...current, [caseId]: "saving" }));
  }

  function markRowSaved(caseId: string) {
    setRowSaveStatus((current) => ({ ...current, [caseId]: "saved" }));
    const existing = savedIndicatorTimersRef.current.get(caseId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      savedIndicatorTimersRef.current.delete(caseId);
      setRowSaveStatus((current) => {
        if (current[caseId] !== "saved") return current;
        const next = { ...current };
        delete next[caseId];
        return next;
      });
    }, SAVED_INDICATOR_MS);
    savedIndicatorTimersRef.current.set(caseId, timer);
  }

  function clearRowSaveStatus(caseId: string) {
    const existing = savedIndicatorTimersRef.current.get(caseId);
    if (existing) {
      clearTimeout(existing);
      savedIndicatorTimersRef.current.delete(caseId);
    }
    setRowSaveStatus((current) => {
      if (!current[caseId]) return current;
      const next = { ...current };
      delete next[caseId];
      return next;
    });
  }

  function ensurePreEditSnapshot(caseId: string) {
    if (preEditSnapshotsRef.current.has(caseId)) return;
    const record = recordsRef.current.find((entry) => entry.shared.id === caseId);
    if (record) preEditSnapshotsRef.current.set(caseId, structuredClone(record));
  }

  function queuePersist(caseId: string, patch: LitigationPersistPatch) {
    ensurePreEditSnapshot(caseId);
    pendingPatchesRef.current.set(caseId, patch);
    markRowSaving(caseId);
    setRowSaveErrors((current) => {
      if (!current[caseId]) return current;
      const next = { ...current };
      delete next[caseId];
      return next;
    });
    const prior = persistChainRef.current.get(caseId) ?? Promise.resolve();
    const next = prior.then(() => flushPersist(caseId));
    persistChainRef.current.set(caseId, next);
  }

  async function flushPersist(caseId: string) {
    while (true) {
      const patch = pendingPatchesRef.current.get(caseId);
      if (!patch) return;

      pendingPatchesRef.current.delete(caseId);
      const snapshotBefore =
        preEditSnapshotsRef.current.get(caseId) ?? recordsRef.current.find((record) => record.shared.id === caseId);
      if (!snapshotBefore) continue;

      setSaveMessage(null);

      try {
        const response = await fetch(`/api/tracker/${caseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tracker: { litigationEvents: patch.litigationEvents },
            changeInput: { litigationEvents: patch.litigationEvents },
            markReviewed: true,
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Unable to save litigation event update.");
        }

        const body = (await response.json()) as { tracker?: TrackerEntry };
        if (body.tracker) {
          setWorkingRecords((current) =>
            current.map((record) => (record.shared.id === caseId ? { ...record, tracker: body.tracker! } : record)),
          );
        }

        preEditSnapshotsRef.current.delete(caseId);
        markRowSaved(caseId);
      } catch (error) {
        clearRowSaveStatus(caseId);
        preEditSnapshotsRef.current.delete(caseId);
        const message = error instanceof Error ? error.message : "Unable to save litigation event update.";
        if (snapshotBefore) {
          setWorkingRecords((current) =>
            current.map((record) => (record.shared.id === caseId ? snapshotBefore : record)),
          );
        }
        setSaveMessage(message);
        setRowSaveErrors((current) => ({ ...current, [caseId]: message }));
      }
    }
  }

  function updateLitigationEvents(
    caseId: string,
    updater: (events: LitigationEvents) => LitigationEvents,
  ) {
    const record = recordsRef.current.find((entry) => entry.shared.id === caseId);
    if (!record) return;

    const litigationEvents = updater(record.tracker.litigationEvents);
    const nextRecord: CaseRecord = {
      ...record,
      tracker: {
        ...record.tracker,
        litigationEvents,
      },
    };

    setWorkingRecords((current) => current.map((entry) => (entry.shared.id === caseId ? nextRecord : entry)));
    queuePersist(caseId, { litigationEvents });
  }

  function updateEventField(
    caseId: string,
    key: LitigationEventKey,
    patch: Partial<LitigationEvents[LitigationEventKey]>,
  ) {
    updateLitigationEvents(caseId, (events) => updateLitigationEvent(events, key, patch));
  }

  const activeFilterCount = [caseStatus !== "Active", viewer.canViewAllCases && attorneyIds.length > 0].filter(Boolean).length;

  return (
    <Card>
      <CardContent className="space-y-4 p-4 md:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Input
            value={search}
            placeholder="Search case #, client, attorney, or event date..."
            className="max-w-md"
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{filteredRecords.length} lit case(s)</Badge>
            {activeFilterCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => { setCaseStatus("Active"); setAttorneyIds([]); }}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>

        {saveMessage ? <p className="text-sm text-red-600">{saveMessage}</p> : null}

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-white">Case</TableHead>
                <TableHead>Client</TableHead>
                {viewer.canViewAllCases ? (
                  <TableHead>
                    <HeaderMultiFilter
                      label="Attorney"
                      selected={attorneyIds}
                      options={attorneys.map((attorney) => ({ value: attorney.id, label: attorney.name }))}
                      onChange={setAttorneyIds}
                    />
                  </TableHead>
                ) : null}
                <TableHead>
                  <HeaderFilter
                    label="Status"
                    value={caseStatus}
                    options={[
                      { value: "all", label: "All" },
                      { value: "Active", label: "Open" },
                      { value: "Closed", label: "Closed" },
                    ]}
                    onChange={(value) => setCaseStatus(value as "all" | CaseStatus)}
                  />
                </TableHead>
                {LITIGATION_EVENT_DEFINITIONS.map((event) => (
                  <TableHead key={event.key} colSpan={2} className="min-w-[280px] border-l text-center">
                    {event.label}
                  </TableHead>
                ))}
                <TableHead className="w-12" />
              </TableRow>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-white" />
                <TableHead />
                {viewer.canViewAllCases ? <TableHead /> : null}
                <TableHead />
                {LITIGATION_EVENT_DEFINITIONS.map((event) => (
                  <Fragment key={`${event.key}-subheads`}>
                    <TableHead className="border-l text-xs text-muted-foreground">Date</TableHead>
                    <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                  </Fragment>
                ))}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8 + LITIGATION_EVENT_DEFINITIONS.length * 2} className="py-10 text-center text-muted-foreground">
                    No litigation-stage cases match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRecords.map((record) => {
                  const caseId = record.shared.id;
                  const saveStatus = rowSaveStatus[caseId];
                  const saveError = rowSaveErrors[caseId];
                  const pinned = isRowPinnedBySaveFeedback(caseId, rowSaveStatus);

                  return (
                    <TableRow key={caseId} className={cn(pinned && "bg-slate-50/80")}>
                      <TableCell className="sticky left-0 z-10 bg-white">
                        <div className="flex items-center gap-2">
                          <CaseNumberLink caseNumber={record.shared.caseNumber} caseId={caseId} />
                          {saveStatus === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-navy-950">{record.shared.clientName}</TableCell>
                      {viewer.canViewAllCases ? <TableCell>{record.attorney.name}</TableCell> : null}
                      <TableCell>
                        <Badge variant={record.shared.status === "Active" ? "success" : "outline"}>
                          {record.shared.status === "Active" ? "Open" : "Closed"}
                        </Badge>
                      </TableCell>
                      {LITIGATION_EVENT_DEFINITIONS.map((event) => {
                        const current = record.tracker.litigationEvents[event.key];
                        return (
                          <Fragment key={`${caseId}-${event.key}`}>
                            <TableCell className="border-l align-top">
                              <LitigationEventDateInput
                                value={current.date}
                                onChange={(date) => updateEventField(caseId, event.key, { date })}
                              />
                            </TableCell>
                            <TableCell className="align-top">
                              <LitigationEventStatusSelect
                                value={current.status}
                                onChange={(status) =>
                                  updateEventField(caseId, event.key, { status: status as LitigationEventStatus | null })
                                }
                              />
                            </TableCell>
                          </Fragment>
                        );
                      })}
                      <TableCell className="align-top">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/cases/${caseId}`} aria-label={`Open case ${record.shared.caseNumber}`}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        {saveError ? <p className="mt-1 text-xs text-red-600">{saveError}</p> : null}
                        {!saveError && saveStatus === "saved" ? (
                          <p className="mt-1 text-xs text-emerald-600">Saved</p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          One row per litigation-stage case. Edits save automatically. Stage must be Lit to appear here — use the case page to update events before a case moves into litigation.
        </p>
      </CardContent>
    </Card>
  );
}
