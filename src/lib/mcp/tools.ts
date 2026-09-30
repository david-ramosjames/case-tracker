import { filterRecordsForViewer, isActivePipelineCase } from "@/lib/auth/access";
import {
  ATTORNEY_SOURCED_FIELDS,
  getAttorneyFieldLastReviewedLabel,
  getAttorneySourcedFieldStatus,
  type AttorneySourcedFieldId,
} from "@/lib/attorney-sourced-fields";
import { getOpenStageSuggestions } from "@/lib/calculations";
import {
  CASE_STAGE_OPTIONS,
  EXPECTED_LITIGATION_OPTIONS,
  LIABILITY_OPTIONS,
  formatExpectedLitigationLabel,
  getTargetPeriodSelectOptions,
  toStandardTargetPeriodLabel,
} from "@/lib/case-options";
import { matchesCaseSearch, sortCaseSearchResults } from "@/lib/case-search";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { type McpCaller } from "@/lib/mcp/identity";
import { confirmStageSuggestionById, dismissStageSuggestionById } from "@/lib/supabase/stage-suggestions";
import {
  createTrackerComment,
  getAttorneyGoals,
  getCaseById,
  getCases,
  getUsers,
  updateTrackerEntry,
} from "@/lib/supabase/services";
import {
  type CaseRecord,
  type CaseStage,
  type CommentType,
  type ExpectedLitigationStatus,
  type TrackerUpdateInput,
} from "@/lib/types";

type JsonSchema = Record<string, unknown>;

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  handler: (args: Record<string, unknown>, caller: McpCaller) => Promise<unknown>;
};

/** Error text is returned to Slackbot as a tool error (shown to the user), not a protocol failure. */
export class McpToolError extends Error {}

const STAGE_LABELS: Record<CaseStage, string> = {
  Onboarding: "Onboarding",
  Txt: "Treatment",
  Dmd: "Demand",
  Lit: "Litigation",
  Settled: "Settled",
  Disengaged: "Disengaged",
  Referred: "Referred",
  Terminated: "Terminated",
};

const STAGE_INPUT_VALUES = CASE_STAGE_OPTIONS.map((stage) => STAGE_LABELS[stage]);

function parseStageInput(value: unknown): CaseStage {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const match = CASE_STAGE_OPTIONS.find(
    (stage) => stage.toLowerCase() === raw || STAGE_LABELS[stage].toLowerCase() === raw,
  );
  if (!match) throw new McpToolError(`Unknown stage "${String(value)}". Use one of: ${STAGE_INPUT_VALUES.join(", ")}.`);
  return match;
}

function caseUrl(record: CaseRecord) {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  return base ? `${base}/cases/${record.shared.id}` : null;
}

function actorFor(caller: McpCaller) {
  return { userId: caller.authUserId ?? undefined, userName: `${caller.session.name} (via Slackbot)` };
}

function requireString(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new McpToolError(`"${key}" is required.`);
  return value.trim();
}

async function loadVisibleCases(caller: McpCaller) {
  const [records, users, goals] = await Promise.all([getCases(), getUsers(), getAttorneyGoals()]);
  return { records: filterRecordsForViewer(records, caller.session, users, goals), users, goals };
}

async function requireVisibleCase(caller: McpCaller, rawCaseNumber: unknown) {
  const caseNumber = cleanCaseNumber(typeof rawCaseNumber === "string" ? rawCaseNumber : String(rawCaseNumber ?? ""));
  if (!caseNumber) throw new McpToolError('"case_number" is required.');

  const { records } = await loadVisibleCases(caller);
  const record = records.find((item) => cleanCaseNumber(item.shared.caseNumber) === caseNumber);
  if (!record) throw new McpToolError(`Case ${caseNumber} was not found, or you don't have access to it.`);
  return record;
}

function attorneyFieldSummary(record: CaseRecord) {
  const { tracker } = record;
  const values: Record<AttorneySourcedFieldId, unknown> = {
    liability: tracker.liability,
    targetResolutionQuarter: toStandardTargetPeriodLabel(tracker.targetResolutionQuarter) ?? tracker.targetResolutionQuarter,
    minimumValue: tracker.minimumValue,
    referralFee: tracker.referralFee,
    policyLimits: tracker.policyLimits,
    policyInfoSource: tracker.policyInfoSource,
    injuries: tracker.injuries || null,
    caseDescription: tracker.caseDescription || null,
  };
  return ATTORNEY_SOURCED_FIELDS.map((field) => ({
    field: FIELD_INPUT_KEY_BY_ID[field.id],
    label: field.label,
    value: values[field.id] ?? null,
    status: getAttorneySourcedFieldStatus(record, field.id),
    lastReviewed: getAttorneyFieldLastReviewedLabel(record, field.id),
  }));
}

function fieldsNeedingUpdate(record: CaseRecord) {
  if (!caseRequiresOngoingUpdates(record)) return [];
  return attorneyFieldSummary(record)
    .filter((field) => field.status !== "current")
    .map((field) => `${field.label} (${field.status})`);
}

function caseRow(record: CaseRecord) {
  return {
    caseNumber: record.shared.caseNumber,
    client: record.shared.clientName,
    attorney: record.attorney.name,
    stage: STAGE_LABELS[record.tracker.caseStage],
    expectedLitigation: formatExpectedLitigationLabel(record.tracker.expectedLitigation),
    minimumValue: record.tracker.minimumValue,
    expectedDisbursementQuarter: toStandardTargetPeriodLabel(record.tracker.targetResolutionQuarter),
  };
}

function caseDetail(record: CaseRecord, activePipeline: boolean) {
  const { shared, tracker } = record;
  const result = tracker.result;
  return {
    caseNumber: shared.caseNumber,
    client: shared.clientName,
    url: caseUrl(record),
    stage: STAGE_LABELS[tracker.caseStage],
    expectedLitigation: formatExpectedLitigationLabel(tracker.expectedLitigation),
    activePipeline,
    caseType: shared.caseType || null,
    dateSigned: shared.dateSigned || null,
    dateOfIncident: shared.dateOfIncident,
    team: {
      attorney: record.attorney.name,
      paralegal: record.paralegal.name,
      legalAssistant: record.legalAssistant?.name ?? null,
    },
    attorneyFields: attorneyFieldSummary(record),
    statusNotes: tracker.statusNotes || null,
    openStageSuggestions: getOpenStageSuggestions(record).map((signal) => ({
      id: signal.id,
      suggestedStage: STAGE_LABELS[signal.suggestedStage],
      confidence: signal.confidence,
      excerpt: signal.excerpt,
      detectedAt: signal.detectedAt,
      slackPost: signal.sourceUrl,
    })),
    settlement:
      result.settlementAmount != null || tracker.caseStage === "Settled"
        ? {
            settlementDate: result.settlementDate,
            settlementAmount: result.settlementAmount,
            attorneyFees: result.attorneyFees,
            release: result.releaseStatus,
            closing: result.closingStatus,
            check: result.checkStatus,
            reductions: result.reductionsStatus,
            disbursed: result.disbursedStatus,
            disburseDate: result.disburseDate,
          }
        : null,
    lastUpdatedAt: tracker.updatedAt,
  };
}

/** Input keys Slackbot uses for attorney fields (snake_case, matching the tool schema). */
const FIELD_INPUT_KEY_BY_ID: Record<AttorneySourcedFieldId, string> = {
  liability: "liability",
  targetResolutionQuarter: "expected_disbursement_quarter",
  minimumValue: "minimum_value",
  referralFee: "referral_fee",
  policyLimits: "policy_limits",
  policyInfoSource: "policy_source",
  injuries: "injuries",
  caseDescription: "case_description",
};

const VALIDATION_INPUT_KEYS = ["liability", "expected_disbursement_quarter", "minimum_value", "policy_limits"] as const;

function parseMoney(key: string, value: unknown): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) throw new McpToolError(`"${key}" must be a dollar amount of 0 or more.`);
  return Math.round(parsed * 100) / 100;
}

function parseQuarter(value: unknown): string | null {
  if (value === null) return null;
  const standard = toStandardTargetPeriodLabel(String(value));
  const allowed = getTargetPeriodSelectOptions(null);
  if (!standard || !allowed.includes(standard)) {
    throw new McpToolError(
      `"expected_disbursement_quarter" must be the current quarter or later, formatted like ${allowed[0]}. Allowed: ${allowed.join(", ")}.`,
    );
  }
  return standard;
}

/** Build a tracker patch from Slackbot's snake_case field input. Unknown keys are ignored. */
function buildFieldPatch(args: Record<string, unknown>): TrackerUpdateInput {
  const patch: TrackerUpdateInput = {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(args, key) && args[key] !== undefined;

  if (has("liability")) {
    const value = args.liability;
    if (value !== null && !LIABILITY_OPTIONS.includes(String(value) as (typeof LIABILITY_OPTIONS)[number])) {
      throw new McpToolError(`"liability" must be one of: ${LIABILITY_OPTIONS.join(", ")}.`);
    }
    patch.liability = value === null ? null : String(value);
  }
  if (has("expected_disbursement_quarter")) patch.targetResolutionQuarter = parseQuarter(args.expected_disbursement_quarter);
  if (has("minimum_value")) patch.minimumValue = parseMoney("minimum_value", args.minimum_value);
  if (has("policy_limits")) patch.policyLimits = parseMoney("policy_limits", args.policy_limits);
  if (has("referral_fee")) {
    const value = args.referral_fee === null ? null : Number(args.referral_fee);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
      throw new McpToolError('"referral_fee" is a percent between 0 and 100.');
    }
    patch.referralFee = value;
  }
  if (has("policy_source")) patch.policyInfoSource = args.policy_source === null ? null : String(args.policy_source).trim() || null;
  if (has("injuries")) patch.injuries = String(args.injuries ?? "").trim();
  if (has("case_description")) patch.caseDescription = String(args.case_description ?? "").trim();
  if (has("status_notes")) patch.statusNotes = String(args.status_notes ?? "").trim();
  if (has("expected_litigation")) {
    const value = args.expected_litigation;
    if (value !== null && !EXPECTED_LITIGATION_OPTIONS.includes(value as ExpectedLitigationStatus)) {
      throw new McpToolError(`"expected_litigation" must be one of: ${EXPECTED_LITIGATION_OPTIONS.join(", ")}.`);
    }
    patch.expectedLitigation = (value as ExpectedLitigationStatus | null) ?? null;
  }
  return patch;
}

async function saveTrackerPatch(caller: McpCaller, record: CaseRecord, patch: TrackerUpdateInput) {
  await updateTrackerEntry(record.shared.id, patch, {
    actor: actorFor(caller),
    markReviewed: true,
    changeInput: patch,
  });
  const refreshed = await getCaseById(record.shared.id);
  return refreshed ?? record;
}

const caseNumberProperty = {
  type: "string",
  description: "Firm case number, e.g. 1720 (a leading # is fine).",
};

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "whoami",
    title: "Who am I in Case Tracker",
    description: "Shows which Case Tracker user and role the current Slack user maps to, and what cases they can see.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    handler: async (_args, caller) => {
      const { records } = await loadVisibleCases(caller);
      return {
        name: caller.session.name,
        email: caller.session.email,
        role: caller.session.role ?? "pending (no access)",
        visibleCases: records.length,
      };
    },
  },
  {
    name: "find_cases",
    title: "Find cases",
    description:
      "Search and list cases the user can see in Case Tracker (DocketFlow cases plus tracker status). Filter by client name or case number text, attorney, stage, or pipeline. Returns a compact list; use get_case for full detail.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Client name or case number text to match." },
        attorney: { type: "string", description: "Attorney name (partial match), e.g. Kody." },
        stage: { type: "string", enum: STAGE_INPUT_VALUES, description: "Only cases in this stage." },
        pipeline: {
          type: "string",
          enum: ["active", "all"],
          description: "active (default) = the Cases page Active pipeline; all = include closed/historical.",
        },
        needs_update: {
          type: "boolean",
          description: "Only cases with missing or 90-day-stale attorney fields.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max rows (default 25)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: async (args, caller) => {
      const { records, goals } = await loadVisibleCases(caller);
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const attorney = typeof args.attorney === "string" ? args.attorney.trim().toLowerCase() : "";
      const stage = args.stage ? parseStageInput(args.stage) : null;
      const activeOnly = args.pipeline !== "all";
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 25));

      let matches = records.filter((record) => {
        if (activeOnly && !isActivePipelineCase(record, goals)) return false;
        if (stage && record.tracker.caseStage !== stage) return false;
        if (attorney && !record.attorney.name.toLowerCase().includes(attorney)) return false;
        if (query && !matchesCaseSearch(record, query)) return false;
        if (args.needs_update === true && fieldsNeedingUpdate(record).length === 0) return false;
        return true;
      });
      matches = query ? sortCaseSearchResults(matches, query) : matches;

      return {
        total: matches.length,
        showing: Math.min(limit, matches.length),
        cases: matches.slice(0, limit).map((record) => ({
          ...caseRow(record),
          ...(args.needs_update === true ? { needsUpdate: fieldsNeedingUpdate(record) } : {}),
        })),
      };
    },
  },
  {
    name: "get_case",
    title: "Get case status",
    description:
      "Full current status of one case: stage, team, attorney fields with missing/stale status, status notes, open stage suggestions, and settlement/disbursement progress.",
    inputSchema: {
      type: "object",
      properties: { case_number: caseNumberProperty },
      required: ["case_number"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: async (args, caller) => {
      const record = await requireVisibleCase(caller, args.case_number);
      const goals = await getAttorneyGoals();
      return caseDetail(record, isActivePipelineCase(record, goals));
    },
  },
  {
    name: "cases_needing_updates",
    title: "Cases needing attorney updates",
    description:
      "Active cases where attorney fields (liability, expected disbursement quarter, minimum value, policy limits, policy source, etc.) are missing or past the 90-day confirmation window.",
    inputSchema: {
      type: "object",
      properties: {
        attorney: { type: "string", description: "Attorney name filter (admins/managers). Defaults to all visible cases." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: async (args, caller) => {
      const { records, goals } = await loadVisibleCases(caller);
      const attorney = typeof args.attorney === "string" ? args.attorney.trim().toLowerCase() : "";
      const rows = records
        .filter((record) => isActivePipelineCase(record, goals))
        .filter((record) => !attorney || record.attorney.name.toLowerCase().includes(attorney))
        .map((record) => ({ record, needs: fieldsNeedingUpdate(record) }))
        .filter((item) => item.needs.length > 0);
      return {
        total: rows.length,
        cases: rows.slice(0, 60).map(({ record, needs }) => ({
          caseNumber: record.shared.caseNumber,
          client: record.shared.clientName,
          attorney: record.attorney.name,
          needsUpdate: needs,
        })),
      };
    },
  },
  {
    name: "update_case_fields",
    title: "Update case fields",
    description:
      "Update the attorney-maintained fields on a case. Only include fields being changed. Saving liability, expected disbursement quarter, minimum value, or policy limits also marks them confirmed for the 90-day check. Text fields (injuries, case_description, policy_source, status_notes) REPLACE the existing text, so include the full desired text. Confirm the change with the user before calling.",
    inputSchema: {
      type: "object",
      properties: {
        case_number: caseNumberProperty,
        liability: { type: ["string", "null"], enum: [...LIABILITY_OPTIONS, null] },
        expected_disbursement_quarter: {
          type: ["string", "null"],
          description: "Quarter the case is expected to disburse, formatted Q#-YY (e.g. Q1-27). Current quarter or later.",
        },
        minimum_value: { type: ["number", "null"], minimum: 0, description: "Minimum case value in dollars." },
        policy_limits: { type: ["number", "null"], minimum: 0, description: "Policy limits in dollars (0 = no coverage)." },
        policy_source: { type: ["string", "null"], description: "Where the policy info came from (dec page, adjuster, etc.)." },
        referral_fee: { type: ["number", "null"], minimum: 0, maximum: 100, description: "Referral fee percent." },
        injuries: { type: "string", description: "Injuries and treatment summary (replaces existing)." },
        case_description: { type: "string", description: "Case description (replaces existing)." },
        status_notes: { type: "string", description: "Case status notes (replaces existing)." },
        expected_litigation: {
          type: ["string", "null"],
          enum: [...EXPECTED_LITIGATION_OPTIONS, null],
          description: "Pre = pre-litigation, Expect = litigation expected, Lit = in litigation.",
        },
      },
      required: ["case_number"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: async (args, caller) => {
      const record = await requireVisibleCase(caller, args.case_number);
      const patch = buildFieldPatch(args);
      if (Object.keys(patch).length === 0) throw new McpToolError("No fields to update were provided.");

      const before = attorneyFieldSummary(record);
      const refreshed = await saveTrackerPatch(caller, record, patch);
      const after = attorneyFieldSummary(refreshed);
      const changedKeys = new Set(Object.keys(args).filter((key) => key !== "case_number"));

      return {
        saved: true,
        caseNumber: refreshed.shared.caseNumber,
        url: caseUrl(refreshed),
        fields: after
          .filter((field) => changedKeys.has(field.field))
          .map((field) => ({
            ...field,
            previousValue: before.find((item) => item.field === field.field)?.value ?? null,
          })),
        ...(patch.expectedLitigation !== undefined
          ? { expectedLitigation: formatExpectedLitigationLabel(refreshed.tracker.expectedLitigation) }
          : {}),
        ...(patch.statusNotes !== undefined ? { statusNotes: refreshed.tracker.statusNotes } : {}),
      };
    },
  },
  {
    name: "confirm_fields_current",
    title: "Confirm fields are still current",
    description:
      "Re-confirm that liability, expected disbursement quarter, minimum value, and/or policy limits are still accurate without changing them. Clears the 90-day stale alert for those fields.",
    inputSchema: {
      type: "object",
      properties: {
        case_number: caseNumberProperty,
        fields: {
          type: "array",
          items: { type: "string", enum: [...VALIDATION_INPUT_KEYS] },
          minItems: 1,
          description: "Each field the user confirmed is still accurate.",
        },
      },
      required: ["case_number", "fields"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: async (args, caller) => {
      const record = await requireVisibleCase(caller, args.case_number);
      const fields = Array.isArray(args.fields) ? args.fields.map(String) : [];
      const { tracker } = record;
      const patch: TrackerUpdateInput = {};
      const missing: string[] = [];

      for (const field of fields) {
        if (field === "liability") {
          if (tracker.liability?.trim()) patch.liability = tracker.liability;
          else missing.push("liability");
        } else if (field === "expected_disbursement_quarter") {
          if (tracker.targetResolutionQuarter?.trim()) patch.targetResolutionQuarter = tracker.targetResolutionQuarter;
          else missing.push("expected_disbursement_quarter");
        } else if (field === "minimum_value") {
          if (tracker.minimumValue != null) patch.minimumValue = tracker.minimumValue;
          else missing.push("minimum_value");
        } else if (field === "policy_limits") {
          if (tracker.policyLimits != null) patch.policyLimits = tracker.policyLimits;
          else missing.push("policy_limits");
        } else {
          throw new McpToolError(`Unknown field "${field}". Use: ${VALIDATION_INPUT_KEYS.join(", ")}.`);
        }
      }

      if (missing.length > 0) {
        throw new McpToolError(
          `These fields have no value to confirm yet: ${missing.join(", ")}. Set them with update_case_fields instead.`,
        );
      }
      if (Object.keys(patch).length === 0) throw new McpToolError("No fields to confirm were provided.");

      const refreshed = await saveTrackerPatch(caller, record, patch);
      return {
        confirmed: true,
        caseNumber: refreshed.shared.caseNumber,
        fields: attorneyFieldSummary(refreshed).filter((field) => fields.includes(field.field)),
      };
    },
  },
  {
    name: "set_case_stage",
    title: "Set case stage",
    description:
      "Move a case to a new stage (Onboarding, Treatment, Demand, Litigation, Settled, Disengaged, Referred, Terminated). Confirm with the user first; closing stages remove the case from the active pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        case_number: caseNumberProperty,
        stage: { type: "string", enum: STAGE_INPUT_VALUES },
      },
      required: ["case_number", "stage"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: async (args, caller) => {
      const record = await requireVisibleCase(caller, args.case_number);
      const stage = parseStageInput(args.stage);
      const previousStage = record.tracker.caseStage;
      if (previousStage === stage) {
        return { saved: false, caseNumber: record.shared.caseNumber, stage: STAGE_LABELS[stage], note: "Already at this stage." };
      }

      const refreshed = await saveTrackerPatch(caller, record, { caseStage: stage });
      return {
        saved: true,
        caseNumber: refreshed.shared.caseNumber,
        previousStage: STAGE_LABELS[previousStage],
        stage: STAGE_LABELS[refreshed.tracker.caseStage],
        expectedLitigation: formatExpectedLitigationLabel(refreshed.tracker.expectedLitigation),
        url: caseUrl(refreshed),
      };
    },
  },
  {
    name: "resolve_stage_suggestion",
    title: "Confirm or dismiss a stage suggestion",
    description:
      "Confirm (applies the suggested stage) or dismiss an open stage suggestion on a case, e.g. from the daily pulse. Use get_case to see open suggestions and their ids.",
    inputSchema: {
      type: "object",
      properties: {
        case_number: caseNumberProperty,
        action: { type: "string", enum: ["confirm", "dismiss"] },
        suggestion_id: {
          type: "string",
          description: "Required only when the case has more than one open suggestion.",
        },
      },
      required: ["case_number", "action"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: async (args, caller) => {
      const record = await requireVisibleCase(caller, args.case_number);
      const open = getOpenStageSuggestions(record);
      if (open.length === 0) throw new McpToolError(`Case ${record.shared.caseNumber} has no open stage suggestions.`);

      const requestedId = typeof args.suggestion_id === "string" ? args.suggestion_id.trim() : "";
      const suggestion = requestedId ? open.find((item) => item.id === requestedId) : open.length === 1 ? open[0] : null;
      if (!suggestion) {
        throw new McpToolError(
          requestedId
            ? `Suggestion ${requestedId} is not open on case ${record.shared.caseNumber}.`
            : `Case ${record.shared.caseNumber} has ${open.length} open suggestions; pass suggestion_id (${open.map((item) => `${item.id} = ${STAGE_LABELS[item.suggestedStage]}`).join("; ")}).`,
        );
      }

      const actorName = actorFor(caller).userName;
      if (args.action === "dismiss") {
        await dismissStageSuggestionById(suggestion.id, actorName);
        return { dismissed: true, caseNumber: record.shared.caseNumber, suggestedStage: STAGE_LABELS[suggestion.suggestedStage] };
      }
      if (args.action !== "confirm") throw new McpToolError('"action" must be confirm or dismiss.');

      const result = await confirmStageSuggestionById(suggestion.id, { actorName });
      return { confirmed: true, caseNumber: record.shared.caseNumber, stage: STAGE_LABELS[result.stage] };
    },
  },
  {
    name: "add_case_comment",
    title: "Add case comment",
    description:
      "Add a comment to a case's Case Tracker timeline (also posted to the case Slack channel like comments from the website).",
    inputSchema: {
      type: "object",
      properties: {
        case_number: caseNumberProperty,
        body: { type: "string", description: "Comment text." },
        type: {
          type: "string",
          enum: ["attorney_update", "general_note", "risk_flag"],
          description: "Defaults to attorney_update.",
        },
      },
      required: ["case_number", "body"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: async (args, caller) => {
      const record = await requireVisibleCase(caller, args.case_number);
      const body = requireString(args, "body");
      const type = (["attorney_update", "general_note", "risk_flag"].includes(String(args.type))
        ? args.type
        : "attorney_update") as CommentType;

      const { comment } = await createTrackerComment({
        caseId: record.shared.id,
        authorId: caller.authUserId ?? "",
        authorName: actorFor(caller).userName,
        type,
        body,
      });
      return { saved: true, caseNumber: record.shared.caseNumber, commentId: comment.id, type, url: caseUrl(record) };
    },
  },
];

export const MCP_TOOLS_BY_NAME = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]));
