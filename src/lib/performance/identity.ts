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
    case "hearing":
    case "hearing_trial": {
      const hearingType = input.hearingType?.trim() || input.notes?.trim();
      if (!hearingType) throw new Error("Hearings require a hearing type or notes.");
      const key = `type:${slug(hearingType)}`;
      return { identityKey: key, identityLabel: hearingType };
    }
    case "mediation": {
      if (input.docketEventId?.trim()) {
        return {
          identityKey: `docket:${input.docketEventId.trim()}`,
          identityLabel: input.documentLabel?.trim() || "Calendar event",
        };
      }
      const label = input.documentLabel?.trim() || input.notes?.trim() || "mediation";
      return { identityKey: `event:${slug(label)}`, identityLabel: label };
    }
    case "lit_event_scheduled": {
      if (input.docketEventId?.trim()) {
        return {
          identityKey: `docket:${input.docketEventId.trim()}`,
          identityLabel: input.documentLabel?.trim() || "Calendar event",
        };
      }
      const kind = input.hearingType?.trim() || "event";
      const party = input.documentLabel?.trim();
      const notes = input.notes?.trim();
      const parts = [kind, party, notes].filter(Boolean) as string[];
      if (!input.hearingType?.trim()) {
        throw new Error("Schedule Litigation Event needs an event type.");
      }
      if (!party && !notes) {
        throw new Error("Add a deposition party role or notes with further details.");
      }
      const identityLabel = parts
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" · ");
      return {
        identityKey: `lit:${parts.map(slug).join(":")}`,
        identityLabel,
      };
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
      if (input.notes?.trim()) {
        const notes = input.notes.trim();
        return { identityKey: `notes:${slug(notes)}`, identityLabel: notes };
      }
      if (input.docketEventId?.trim()) {
        return {
          identityKey: `docket:${input.docketEventId.trim()}`,
          identityLabel: input.documentLabel?.trim() || "Linked event",
        };
      }
      throw new Error(
        "Add notes (or a document label / round) so this item can be distinguished from others.",
      );
    }
    case "deposition": {
      const role = input.hearingType?.trim() || input.documentLabel?.trim();
      const person = input.litPersonName?.trim();
      const notes = input.notes?.trim();
      if (person) {
        const label = role ? `${role}: ${person}` : person;
        return { identityKey: `person:${slug(person)}`, identityLabel: label };
      }
      if (role && notes) {
        return {
          identityKey: `depo:${slug(role)}:${slug(notes)}`,
          identityLabel: `${role} · ${notes}`,
        };
      }
      if (role) {
        return { identityKey: `depo:${slug(role)}`, identityLabel: role };
      }
      if (notes) {
        return { identityKey: `depo:${slug(notes)}`, identityLabel: notes };
      }
      throw new Error("Depositions need a party role, person name, or notes.");
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
