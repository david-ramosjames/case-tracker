"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  filterMentionCandidates,
  mentionHandleForUser,
  usersWithSlackIds,
} from "@/lib/slack/comment-mentions";
import { type AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";

type MentionState = {
  start: number;
  query: string;
};

export function CommentMentionInput({
  value,
  onChange,
  users,
  priorityContactIds = [],
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  users: AppUser[];
  priorityContactIds?: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const mentionableCount = useMemo(() => usersWithSlackIds(users).length, [users]);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    return filterMentionCandidates(users, mention.query, priorityContactIds).slice(0, 8);
  }, [mention, priorityContactIds, users]);

  useEffect(() => {
    setActiveIndex(0);
  }, [mention?.query, mention?.start]);

  function syncMentionFromValue(nextValue: string, cursor: number) {
    const before = nextValue.slice(0, cursor);
    const match = before.match(/(^|[\s([{])@([^\s@]*)$/);
    if (!match) {
      setMention(null);
      return;
    }
    const atIndex = before.lastIndexOf("@");
    setMention({ start: atIndex, query: match[2] ?? "" });
  }

  function applyMention(user: AppUser) {
    if (!mention || !textareaRef.current) return;
    const handle = mentionHandleForUser(user);
    const cursor = textareaRef.current.selectionStart ?? value.length;
    const before = value.slice(0, mention.start);
    const after = value.slice(cursor);
    const next = `${before}@${handle} ${after}`;
    const nextCursor = before.length + handle.length + 2;
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
    });
  }

  return (
    <div className="relative min-w-0">
      <Textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        placeholder={
          placeholder ??
          (mentionableCount > 0 ? "Add a case note… type @ to mention someone in Slack" : "Add a case note...")
        }
        rows={2}
        className="min-h-[2.75rem] resize-y"
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          syncMentionFromValue(next, event.target.selectionStart ?? next.length);
        }}
        onClick={(event) => {
          syncMentionFromValue(value, event.currentTarget.selectionStart ?? value.length);
        }}
        onKeyUp={(event) => {
          syncMentionFromValue(value, event.currentTarget.selectionStart ?? value.length);
        }}
        onKeyDown={(event) => {
          if (!mention || suggestions.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % suggestions.length);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
            return;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            applyMention(suggestions[activeIndex] ?? suggestions[0]);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setMention(null);
          }
        }}
        onBlur={() => {
          // Allow click on suggestion before closing.
          window.setTimeout(() => setMention(null), 150);
        }}
      />
      {mention && suggestions.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-white shadow-lg">
          <ul className="max-h-56 overflow-y-auto py-1">
            {suggestions.map((user, index) => {
              const handle = mentionHandleForUser(user);
              return (
                <li key={user.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted",
                      index === activeIndex && "bg-muted",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applyMention(user);
                    }}
                  >
                    <span className="font-medium text-navy-950">@{handle}</span>
                    <span className="truncate text-xs text-muted-foreground">{user.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {mention && suggestions.length === 0 && mentionableCount > 0 ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border bg-white px-3 py-2 text-sm text-muted-foreground shadow-lg">
          No Slack-linked users match “{mention.query}”.
        </div>
      ) : null}
      {mentionableCount === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          No contacts have a Slack user ID yet — set them in Settings → User Roles to enable @mentions.
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Type @ to tag someone; Slack uses their linked user ID.</p>
      )}
    </div>
  );
}
