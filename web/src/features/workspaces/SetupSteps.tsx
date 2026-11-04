import { CheckCircleIcon, CircleDashedIcon, WarningIcon } from "@phosphor-icons/react";
import type { Event, Workspace } from "../../shared/api-types";
import { workspaceStatusLabel, workspaceSteps } from "./workspace-status";

function failedStepIndex(events: Event[], projectId: string | null, steps: string[]): number {
  const statuses = events.filter(
    (event): event is Extract<Event, { type: "status" }> => event.type === "status" && event.projectId === projectId,
  );
  const lastStep = statuses.map((event) => steps.indexOf(event.status)).filter((index) => index >= 0).at(-1);
  return lastStep ?? 0;
}

export function SetupSteps({ workspace, events }: { workspace: Workspace; events: Event[] }) {
  const failedAt = failedStepIndex(events, null, workspaceSteps);
  const current = workspaceSteps.indexOf(workspace.status);
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
      {workspaceSteps.map((step, index) => {
        const state =
          workspace.status === "running" || workspace.status === "deleting"
            ? "done"
            : workspace.status === "failed"
              ? index < failedAt
                ? "done"
                : index === failedAt
                  ? "failed"
                  : "todo"
              : index < current
                ? "done"
                : index === current
                  ? "doing"
                  : "todo";
        return (
          <li key={step} className={`flex items-center gap-2.5 text-sm ${state === "todo" ? "text-muted" : "text-text"}`}>
            {state === "done" && <CheckCircleIcon size={16} className="text-success" aria-label="Done" />}
            {state === "doing" && <CircleDashedIcon size={16} className="text-warn" aria-label="In progress" />}
            {state === "failed" && <WarningIcon size={16} className="text-danger" aria-label="Failed" />}
            {state === "todo" && <CircleDashedIcon size={16} className="text-muted" aria-label="Not started" />}
            {workspaceStatusLabel[step]}
          </li>
        );
      })}
      {workspace.status === "failed" && workspace.error && <li className="text-sm text-danger">{workspace.error}</li>}
    </ol>
  );
}
