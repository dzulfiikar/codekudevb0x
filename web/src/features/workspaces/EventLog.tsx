import { ArrowsClockwiseIcon, ChatCircleTextIcon, CheckCircleIcon, CircleDashedIcon, TerminalWindowIcon, XCircleIcon } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Event, ProjectStatus, WorkspaceStatus } from "../../shared/api-types";
import { StatusLabel } from "../../shared/components/StatusLabel";
import { boxClass, boxHeaderClass, secondaryButton } from "../../shared/components/styles";
import { projectStatusLabel } from "../projects/project-status";
import { workspaceStatusLabel } from "./workspace-status";

export type StreamState = "connecting" | "streaming" | "reconnecting" | "closed";

const streamLabel: Record<StreamState, string> = {
  connecting: "connecting",
  streaming: "streaming",
  reconnecting: "disconnected, retrying",
  closed: "disconnected",
};

export function EventLog({
  title,
  events,
  streamState,
  onReconnect,
  emptyText,
}: {
  title: string;
  events: Event[];
  streamState: StreamState;
  onReconnect: () => void;
  emptyText: string;
}) {
  const scrollRef = useRef<HTMLOListElement>(null);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [events.length, title]);

  return (
    <section className={boxClass} aria-label={title}>
      <div className={boxHeaderClass}>
        <h2 className="m-0 text-sm font-semibold">{title}</h2>
        <span className="flex items-center gap-2">
          <StatusLabel tone={streamState === "streaming" ? "success" : streamState === "closed" ? "danger" : "attention"}>
            {streamLabel[streamState]}
          </StatusLabel>
          {streamState === "closed" && (
            <button type="button" onClick={onReconnect} className={secondaryButton}>
              <ArrowsClockwiseIcon size={16} aria-hidden="true" />
              Reconnect
            </button>
          )}
        </span>
      </div>
      {events.length === 0 ? (
        <p className="m-0 px-4 py-6 text-sm text-muted">{emptyText}</p>
      ) : (
        <ol
          ref={scrollRef}
          role="log"
          tabIndex={0}
          aria-label={`${title} entries`}
          className="focus-ring m-0 flex max-h-[calc(100vh-420px)] min-h-[240px] list-none flex-col gap-4 overflow-y-auto p-4"
        >
          {events.map((event) => (
            <LogEntry key={event.id} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineBadge({ children }: { children: ReactNode }) {
  return <span className="grid size-8 shrink-0 place-items-center rounded-full bg-button text-muted">{children}</span>;
}

function TimelineText({ badge, tone, children }: { badge: ReactNode; tone: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <TimelineBadge>{badge}</TimelineBadge>
      <p className={`m-0 flex-1 pt-1.5 text-sm leading-5 break-words whitespace-pre-wrap ${tone}`}>{children}</p>
    </li>
  );
}

function LogEntry({ event }: { event: Event }) {
  switch (event.type) {
    case "agent":
      return (
        <TimelineText badge={<ChatCircleTextIcon size={16} aria-label="Setup agent" />} tone="text-text">
          {event.message}
        </TimelineText>
      );
    case "log":
      return (
        <TimelineText badge={<TerminalWindowIcon size={16} aria-label="Server" />} tone="text-muted">
          {event.message}
        </TimelineText>
      );
    case "error":
      return (
        <TimelineText badge={<XCircleIcon size={16} className="text-danger" aria-label="Error" />} tone="text-danger">
          {event.message}
        </TimelineText>
      );
    case "status":
      return (
        <TimelineText badge={<CircleDashedIcon size={16} aria-label="Status" />} tone="text-muted">
          {event.projectId === null
            ? workspaceStatusLabel[event.status as WorkspaceStatus]
            : projectStatusLabel[event.status as ProjectStatus]}
        </TimelineText>
      );
    case "services":
      return (
        <TimelineText badge={<CheckCircleIcon size={16} className="text-success" aria-label="Services" />} tone="text-text">
          {event.services.length > 0
            ? event.services.map((service) => `${service.name} on ${service.port}${service.reachable ? "" : " (not reachable)"}`).join(", ")
            : "No services reported"}
        </TimelineText>
      );
    case "command":
      return (
        <li className="flex items-start gap-3">
          <TimelineBadge>
            <TerminalWindowIcon size={16} aria-label="Command" />
          </TimelineBadge>
          <div className="min-w-0 flex-1 rounded-md border border-line bg-inset px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <code className="flex-1 font-mono text-[13px] break-all whitespace-pre-wrap text-text">$ {event.command}</code>
              <span className={`font-mono text-xs ${event.exitCode === 0 ? "text-muted" : "text-danger"}`}>exit {event.exitCode}</span>
            </div>
            {event.output && (
              <pre className="m-0 mt-2 max-h-60 overflow-y-auto font-mono text-xs break-all whitespace-pre-wrap text-muted">{event.output}</pre>
            )}
          </div>
        </li>
      );
  }
}
