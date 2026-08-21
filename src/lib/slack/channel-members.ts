import {
  inviteSlackUsersToChannel,
  lookupSlackUserIdByEmail,
} from "@/lib/slack/client";
import { isSlackEnabled } from "@/lib/slack/config";
import { type AppUser, type CaseRecord } from "@/lib/types";

type SlackPerson = Pick<AppUser, "slackUserId" | "email">;

async function slackUserIdForPerson(person: SlackPerson | null | undefined) {
  if (!person) return null;
  const stored = person.slackUserId?.trim();
  if (stored && /^U[A-Z0-9]+$/i.test(stored)) return stored.toUpperCase();
  if (person.email?.includes("@") && !person.email.endsWith("@ramosjameslaw.local")) {
    const lookedUp = await lookupSlackUserIdByEmail(person.email);
    if (lookedUp) return lookedUp.toUpperCase();
  }
  return null;
}

/** Invite attorney, paralegal, and legal assistant into the case Slack channel when IDs are known. */
export async function inviteCaseTeamToSlackChannel(input: {
  channelId: string;
  attorney: SlackPerson;
  paralegal: SlackPerson;
  legalAssistant?: SlackPerson | null;
}) {
  if (!isSlackEnabled()) {
    return { invited: [] as string[], skipped: true as const, reason: "slack_disabled" as const };
  }

  const userIds: string[] = [];
  for (const person of [input.attorney, input.paralegal, input.legalAssistant]) {
    const userId = await slackUserIdForPerson(person);
    if (userId) userIds.push(userId);
  }

  return inviteSlackUsersToChannel(input.channelId, userIds);
}

export async function inviteCaseRecordTeamToSlackChannel(record: CaseRecord, channelId: string) {
  return inviteCaseTeamToSlackChannel({
    channelId,
    attorney: record.attorney,
    paralegal: record.paralegal,
    legalAssistant: record.legalAssistant,
  });
}
