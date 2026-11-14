import { identityFromCreateInput } from "@/lib/performance/identity";
import { createPerformanceClient } from "@/lib/performance/db";
import {
  type CreateDeliverableInput,
  type PerformanceCommitment,
  type PerformanceDeliverable,
  type PerformanceDeliverableEvent,
} from "@/lib/performance/types";
import { weekStartMondayCt } from "@/lib/performance/weeks";

type UnknownRow = Record<string, unknown>;

function asString(value: unknown) {
  return typeof value === "string" ? value : value == null ? null : String(value);
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : value == null ? 0 : Number(value) || 0;
}

export function rowToDeliverable(row: UnknownRow): PerformanceDeliverable {
  return {
    id: String(row.id),
    caseId: asString(row.case_id),
    caseNumber: String(row.case_number ?? ""),
    clientNameSnapshot: asString(row.client_name_snapshot),
    deliverableType: row.deliverable_type as PerformanceDeliverable["deliverableType"],
    identityKey: String(row.identity_key),
    identityLabel: asString(row.identity_label),
    attorneyUserId: asString(row.attorney_user_id),
    assigneeUserId: asString(row.assignee_user_id),
    identifiedAt: String(row.identified_at),
    identifiedBy: asString(row.identified_by),
    workflowStatus: row.workflow_status as PerformanceDeliverable["workflowStatus"],
    requestedCompletionDate: asString(row.requested_completion_date),
    plannedDate: asString(row.planned_date),
    completedAt: asString(row.completed_at),
    completionSource: (asString(row.completion_source) as PerformanceDeliverable["completionSource"]) ?? null,
    rescheduleCount: asNumber(row.reschedule_count),
    litPersonName: asString(row.lit_person_name),
    hearingType: asString(row.hearing_type),
    documentLabel: asString(row.document_label),
    roundNumber: row.round_number == null ? null : asNumber(row.round_number),
    recipientLabel: asString(row.recipient_label),
    docketEventId: asString(row.docket_event_id),
    notes: asString(row.notes),
    cancelReason: asString(row.cancel_reason),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function rowToCommitment(row: UnknownRow): PerformanceCommitment {
  return {
    id: String(row.id),
    deliverableId: String(row.deliverable_id),
    weekStart: String(row.week_start),
    committedBy: asString(row.committed_by),
    committedAt: String(row.committed_at),
    plannedDate: asString(row.planned_date),
    outcome: row.outcome as PerformanceCommitment["outcome"],
    movedToWeekStart: asString(row.moved_to_week_start),
    mondaySnapshotId: asString(row.monday_snapshot_id),
    cancelReason: asString(row.cancel_reason),
  };
}

async function appendEvent(input: {
  deliverableId: string;
  commitmentId?: string | null;
  actorUserId?: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  const client = await createPerformanceClient();
  await client.from("performance_deliverable_events").insert({
    deliverable_id: input.deliverableId,
    commitment_id: input.commitmentId ?? null,
    actor_user_id: input.actorUserId ?? null,
    event_type: input.eventType,
    payload: input.payload ?? {},
  });
}

/** Create deliverable in backlog — does not create a weekly commitment. Never mutates case status. */
export async function createDeliverable(
  input: CreateDeliverableInput,
  actorUserId?: string | null,
): Promise<PerformanceDeliverable> {
  const { identityKey, identityLabel } = identityFromCreateInput(input);
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_deliverables")
    .insert({
      case_id: input.caseId ?? null,
      case_number: input.caseNumber,
      client_name_snapshot: input.clientNameSnapshot ?? null,
      deliverable_type: input.deliverableType,
      identity_key: identityKey,
      identity_label: identityLabel,
      attorney_user_id: input.attorneyUserId ?? null,
      assignee_user_id: input.assigneeUserId ?? null,
      identified_by: input.identifiedBy ?? actorUserId ?? null,
      workflow_status: "backlog",
      requested_completion_date: input.requestedCompletionDate ?? null,
      lit_person_name: input.litPersonName ?? null,
      hearing_type: input.hearingType ?? null,
      document_label: input.documentLabel ?? null,
      round_number: input.roundNumber ?? null,
      recipient_label: input.recipientLabel ?? null,
      docket_event_id: input.docketEventId ?? null,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("An open deliverable with this identity already exists on the case.");
    }
    throw error;
  }

  const deliverable = rowToDeliverable(data as UnknownRow);
  await appendEvent({
    deliverableId: deliverable.id,
    actorUserId,
    eventType: "created",
    payload: { workflowStatus: "backlog", identityKey },
  });
  return deliverable;
}

export async function commitDeliverableToWeek(input: {
  deliverableId: string;
  weekStart?: string;
  plannedDate?: string | null;
  actorUserId?: string | null;
}): Promise<{ deliverable: PerformanceDeliverable; commitment: PerformanceCommitment }> {
  const client = await createPerformanceClient();
  const weekStart = input.weekStart ?? weekStartMondayCt();

  const { data: existing, error: loadError } = await client
    .from("performance_deliverables")
    .select("*")
    .eq("id", input.deliverableId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing) throw new Error("Deliverable not found.");
  const current = rowToDeliverable(existing as UnknownRow);
  if (current.workflowStatus === "done" || current.workflowStatus === "cancelled") {
    throw new Error("Cannot commit a closed deliverable.");
  }

  const { data: commitmentRow, error: commitError } = await client
    .from("performance_commitments")
    .insert({
      deliverable_id: input.deliverableId,
      week_start: weekStart,
      committed_by: input.actorUserId ?? null,
      planned_date: input.plannedDate ?? current.requestedCompletionDate,
      outcome: "promised",
    })
    .select("*")
    .single();
  if (commitError) throw commitError;

  const { data: updated, error: updateError } = await client
    .from("performance_deliverables")
    .update({
      workflow_status: "committed",
      planned_date: input.plannedDate ?? current.requestedCompletionDate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.deliverableId)
    .select("*")
    .single();
  if (updateError) throw updateError;

  const commitment = rowToCommitment(commitmentRow as UnknownRow);
  const deliverable = rowToDeliverable(updated as UnknownRow);
  await appendEvent({
    deliverableId: deliverable.id,
    commitmentId: commitment.id,
    actorUserId: input.actorUserId,
    eventType: "committed",
    payload: { weekStart },
  });
  return { deliverable, commitment };
}

export async function moveCommitmentToWeek(input: {
  deliverableId: string;
  fromCommitmentId: string;
  toWeekStart: string;
  plannedDate?: string | null;
  actorUserId?: string | null;
}): Promise<{ deliverable: PerformanceDeliverable; commitment: PerformanceCommitment }> {
  const client = await createPerformanceClient();

  const { data: deliv } = await client
    .from("performance_deliverables")
    .select("*")
    .eq("id", input.deliverableId)
    .maybeSingle();
  if (!deliv) throw new Error("Deliverable not found.");
  const current = rowToDeliverable(deliv as UnknownRow);

  await client
    .from("performance_commitments")
    .update({
      outcome: "moved",
      moved_to_week_start: input.toWeekStart,
    })
    .eq("id", input.fromCommitmentId);

  const { data: commitmentRow, error: commitError } = await client
    .from("performance_commitments")
    .insert({
      deliverable_id: input.deliverableId,
      week_start: input.toWeekStart,
      committed_by: input.actorUserId ?? null,
      planned_date: input.plannedDate ?? current.plannedDate,
      outcome: "promised",
    })
    .select("*")
    .single();
  if (commitError) throw commitError;

  const { data: updated, error: updateError } = await client
    .from("performance_deliverables")
    .update({
      workflow_status: "committed",
      planned_date: input.plannedDate ?? current.plannedDate,
      reschedule_count: current.rescheduleCount + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.deliverableId)
    .select("*")
    .single();
  if (updateError) throw updateError;

  const commitment = rowToCommitment(commitmentRow as UnknownRow);
  const deliverable = rowToDeliverable(updated as UnknownRow);
  await appendEvent({
    deliverableId: deliverable.id,
    commitmentId: commitment.id,
    actorUserId: input.actorUserId,
    eventType: "moved",
    payload: { toWeekStart: input.toWeekStart, fromCommitmentId: input.fromCommitmentId },
  });
  return { deliverable, commitment };
}

export async function completeDeliverable(input: {
  deliverableId: string;
  commitmentId?: string | null;
  actorUserId?: string | null;
  completionSource?: "manual" | "confirmed_event" | "system";
}): Promise<PerformanceDeliverable> {
  const client = await createPerformanceClient();
  const completedAt = new Date().toISOString();

  if (input.commitmentId) {
    await client
      .from("performance_commitments")
      .update({ outcome: "completed" })
      .eq("id", input.commitmentId);
  }

  const { data, error } = await client
    .from("performance_deliverables")
    .update({
      workflow_status: "done",
      completed_at: completedAt,
      completion_source: input.completionSource ?? "manual",
      updated_at: completedAt,
    })
    .eq("id", input.deliverableId)
    .select("*")
    .single();
  if (error) throw error;

  const deliverable = rowToDeliverable(data as UnknownRow);
  await appendEvent({
    deliverableId: deliverable.id,
    commitmentId: input.commitmentId,
    actorUserId: input.actorUserId,
    eventType: "completed",
    payload: { completionSource: input.completionSource ?? "manual" },
  });
  return deliverable;
}

export async function cancelDeliverable(input: {
  deliverableId: string;
  reason?: string | null;
  actorUserId?: string | null;
}): Promise<PerformanceDeliverable> {
  const client = await createPerformanceClient();
  await client
    .from("performance_commitments")
    .update({ outcome: "cancelled", cancel_reason: input.reason ?? null })
    .eq("deliverable_id", input.deliverableId)
    .eq("outcome", "promised");

  const { data, error } = await client
    .from("performance_deliverables")
    .update({
      workflow_status: "cancelled",
      cancel_reason: input.reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.deliverableId)
    .select("*")
    .single();
  if (error) throw error;

  const deliverable = rowToDeliverable(data as UnknownRow);
  await appendEvent({
    deliverableId: deliverable.id,
    actorUserId: input.actorUserId,
    eventType: "cancelled",
    payload: { reason: input.reason ?? null },
  });
  return deliverable;
}

export async function listDeliverablesForAssignee(assigneeUserId: string) {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_deliverables")
    .select("*")
    .eq("assignee_user_id", assigneeUserId)
    .order("identified_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToDeliverable);
}

export async function listDeliverablesForAttorney(attorneyUserId: string) {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_deliverables")
    .select("*")
    .eq("attorney_user_id", attorneyUserId)
    .order("identified_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToDeliverable);
}

/** Open + recently completed work for a person's My Work page. */
export async function listDeliverablesForPerson(input: {
  contactId: string;
  asAttorney: boolean;
  completedSince?: string;
}) {
  const client = await createPerformanceClient();
  const column = input.asAttorney ? "attorney_user_id" : "assignee_user_id";
  let query = client.from("performance_deliverables").select("*").eq(column, input.contactId);
  if (input.completedSince) {
    query = query.or(
      `workflow_status.in.(backlog,committed),and(workflow_status.eq.done,completed_at.gte.${input.completedSince}T00:00:00)`,
    );
  }
  const { data, error } = await query.order("identified_at", { ascending: false }).limit(2000);
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToDeliverable);
}

export async function listAllOpenDeliverables() {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_deliverables")
    .select("*")
    .in("workflow_status", ["backlog", "committed"])
    .order("identified_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToDeliverable);
}

export async function listCommitmentsForWeek(weekStart: string) {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_commitments")
    .select("*")
    .eq("week_start", weekStart)
    .order("committed_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToCommitment);
}

export async function listEventsForDeliverable(deliverableId: string): Promise<PerformanceDeliverableEvent[]> {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_deliverable_events")
    .select("*")
    .eq("deliverable_id", deliverableId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map((row) => ({
    id: String(row.id),
    deliverableId: String(row.deliverable_id),
    commitmentId: asString(row.commitment_id),
    actorUserId: asString(row.actor_user_id),
    eventType: String(row.event_type),
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  }));
}

export async function getDeliverableById(id: string) {
  const client = await createPerformanceClient();
  const { data, error } = await client.from("performance_deliverables").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToDeliverable(data as UnknownRow) : null;
}
