import { CalendarDays, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatScheduledEventWhen } from "@/lib/docketflow/case-events";
import type { DocketFlowScheduledEvent } from "@/lib/types";

export function NextScheduledEventsCard({
  events,
  docketFlowCaseUrl,
}: {
  events: DocketFlowScheduledEvent[];
  docketFlowCaseUrl: string | null;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="h-5 w-5 text-pink-500" />
            Next Scheduled Events
          </CardTitle>
          <CardDescription>Upcoming deadlines and meetings from DocketFlow.</CardDescription>
        </div>
        {docketFlowCaseUrl ? (
          <a
            href={docketFlowCaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-pink-600 hover:text-pink-500"
          >
            Open in DocketFlow
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming events on or after today.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {events.map((event) => (
              <li key={event.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-navy-950">{event.title}</p>
                  <p className="text-sm text-muted-foreground">{formatScheduledEventWhen(event)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Badge variant="outline">{event.scheduleKind === "meeting" ? "Meeting" : "Deadline"}</Badge>
                  {event.category ? <Badge variant="outline">{event.category}</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {!docketFlowCaseUrl ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Set <code className="rounded bg-muted px-1 py-0.5">NEXT_PUBLIC_DOCKETFLOW_URL</code> to enable the DocketFlow
            link.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
