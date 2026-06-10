/** Extract Slack user mention tokens from a channel topic (Attorney <@U…> | Paralegal <@U…>). */
export function formatTopicUserMentions(topic: string | null | undefined) {
  if (!topic?.trim()) return "";

  const ids = [
    ...topic.matchAll(/<@(U[A-Z0-9]+)(?:\|[^>]+)?>/gi),
  ].map((match) => match[1]);

  const unique = [...new Set(ids)];
  return unique.map((id) => `<@${id}>`).join(" ");
}
