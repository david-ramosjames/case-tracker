import { type CreateDeliverableInput, type PerformanceDeliverableType } from "@/lib/performance/types";

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Build instance-specific identity for duplicate prevention. Never assume one-per-case for repeatable work. */
export function buildIdentityKey(input: {
  deliverableType: PerformanceDeliverableType;
  litPersonName?: string | null;
  hearingType?: string | null;
  documentLabel?: string | null;
  roundNumber?: number | null;
  recipientLabel?: string | null;
  docketEventId?: string | null;
  identityKey?: string | null;
  notes?: string | null;
}): { identityKey: string; identityLabel: string } {
  if (input.identityKey?.trim()) {
    const key = slug(input.identityKey);
    return { identityKey: key || "custom", identityLabel: input.identityKey.trim() };
  }

  switch (input.deliverableType) {
    case "deposition": {
      const person = input.litPersonName?.trim();
      if (!person) throw new Error("Depositions require the person's name.");
      return { identityKey: `person:${slug(person)}`, identityLabel: person };
    }
    case "hearing":
    case "hearing_trial": {
      const hearingType = input.hearingType?.trim();
      if (!hearingType) throw new Error("Hearings require a hearing type.");
      const key = `type:${slug(hearingType)}`;
      return { identityKey: key, identityLabel: hearingType };
    }
    case "mediation":
    case "lit_event_scheduled": {
      if (input.docketEventId?.trim()) {
        return {
          identityKey: `docket:${input.docketEventId.trim()}`,
          identityLabel: input.documentLabel?.trim() || "Calendar event",
        };
      }
      const label = input.documentLabel?.trim() || input.notes?.trim() || "lit-event";
      return { identityKey: `event:${slug(label)}`, identityLabel: label };
    }
    case "demand_sent":
    case "lawsuit_filed":
    case "discovery_responses":
    case "medicals":
    case "aso":
    case "other": {
      if (input.roundNumber != null && Number.isFinite(input.roundNumber)) {
        const label = input.documentLabel?.trim() || `Round ${input.roundNumber}`;
        return { identityKey: `round:${input.roundNumber}`, identityLabel: label };
      }
      if (input.documentLabel?.trim()) {
        const doc = input.documentLabel.trim();
        return { identityKey: `doc:${slug(doc)}`, identityLabel: doc };
      }
      if (input.recipientLabel?.trim()) {
        const recipient = input.recipientLabel.trim();
        return { identityKey: `recipient:${slug(recipient)}`, identityLabel: recipient };
      }
      if (input.docketEventId?.trim()) {
        return {
          identityKey: `docket:${input.docketEventId.trim()}`,
          identityLabel: input.documentLabel?.trim() || "Linked event",
        };
      }
      throw new Error(
        "Repeatable deliverables need a document label, round number, recipient, or source event id.",
      );
    }
    case "settlement":
    case "disbursement":
    case "disengagement": {
      const label = input.documentLabel?.trim() || input.notes?.trim() || input.deliverableType;
      return { identityKey: `item:${slug(label)}`, identityLabel: label };
    }
    default: {
      const label = input.documentLabel?.trim() || "item";
      return { identityKey: `item:${slug(label)}`, identityLabel: label };
    }
  }
}

export function identityFromCreateInput(input: CreateDeliverableInput) {
  return buildIdentityKey(input);
}
