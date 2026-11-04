import { useEffect, useRef, useState } from "react";
import type { Event, ProjectStatus, Workspace, WorkspaceStatus } from "../../shared/api-types";
import { ErrorBox } from "../../shared/components/ErrorBox";
import { LoadingText } from "../../shared/components/LoadingText";
import { Link } from "../../shared/router";
import { useResource } from "../../shared/use-resource";
import { AddProjectDialog } from "../projects/AddProjectDialog";
import { ProjectsBox } from "../projects/ProjectsBox";
import { isSettingUp } from "../projects/project-status";
import { EventLog, type StreamState } from "./EventLog";
import { VmPanel } from "./VmPanel";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { workspacesApi } from "./workspaces-api";

const vmSelection = "vm";

export function WorkspaceDetailPage({ workspaceId }: { workspaceId: string }) {
  const workspaceResource = useResource(() => workspacesApi.get(workspaceId), workspaceId);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [events, setEvents] = useState<Event[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [chosenSelection, setChosenSelection] = useState<string>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const addProjectButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<Workspace>(undefined);
  const seenEventIds = useRef(new Set<number>());
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const { reload } = workspaceResource;

  useEffect(() => {
    if (workspaceResource.data) setWorkspace(workspaceResource.data);
  }, [workspaceResource.data]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    const source = new EventSource(workspacesApi.eventsUrl(workspaceId));
    const seenIds = seenEventIds.current;
    let reloadTimer: number | undefined;
    setStreamState("connecting");
    source.addEventListener("open", () => setStreamState("streaming"));
    source.addEventListener("error", () => setStreamState(source.readyState === EventSource.CLOSED ? "closed" : "reconnecting"));
    source.addEventListener("message", (message: MessageEvent<string>) => {
      let event: Event;
      try {
        event = JSON.parse(message.data) as Event;
      } catch {
        return;
      }
      if (seenIds.has(event.id)) return;
      seenIds.add(event.id);
      setEvents((current) => [...current, event]);
      setWorkspace((current) => (current ? applyEvent(current, event) : current));
      const isNewProject = !workspaceRef.current?.projects.some((project) => project.id === event.projectId);
      if (event.type === "status" && (event.projectId === null || isNewProject)) {
        window.clearTimeout(reloadTimer);
        reloadTimer = window.setTimeout(() => void reload(), 300);
      }
    });
    return () => {
      window.clearTimeout(reloadTimer);
      source.close();
    };
  }, [workspaceId, reload, connectionAttempt]);

  if (!workspace) {
    return (
      <div className="max-w-[640px] px-10 py-9">
        {workspaceResource.error ? (
          <ErrorBox title="Could not load this workspace">
            {workspaceResource.error}{" "}
            <Link href="/workspaces" className="focus-ring rounded-sm font-semibold text-accent">
              Back to workspaces
            </Link>
          </ErrorBox>
        ) : (
          <LoadingText>Loading workspace</LoadingText>
        )}
      </div>
    );
  }

  const activeProject = workspace.projects.find(isSettingUp);
  const defaultSelection =
    activeProject?.id ?? (workspace.status !== "running" || workspace.projects.length === 0 ? vmSelection : workspace.projects[0].id);
  const selection =
    chosenSelection === vmSelection || workspace.projects.some((project) => project.id === chosenSelection)
      ? (chosenSelection ?? defaultSelection)
      : defaultSelection;
  const selectedProject = workspace.projects.find((project) => project.id === selection);

  function closeDialog() {
    setIsDialogOpen(false);
    addProjectButtonRef.current?.focus();
  }

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-10 pt-5 pb-10">
      <WorkspaceHeader workspace={workspace} addProjectButtonRef={addProjectButtonRef} onAddProject={() => setIsDialogOpen(true)} />
      {workspaceResource.error && (
        <ErrorBox title="Could not refresh this workspace">{workspaceResource.error} Showing the last loaded state.</ErrorBox>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <ProjectsBox
            workspace={workspace}
            activeProject={activeProject}
            selection={selection}
            onSelect={setChosenSelection}
          />
          <EventLog
            title={selectedProject ? `Agent log: ${selectedProject.name}` : "Setup log"}
            events={events.filter((event) => event.projectId === (selectedProject?.id ?? null))}
            streamState={streamState}
            onReconnect={() => setConnectionAttempt((attempt) => attempt + 1)}
            emptyText={
              selectedProject
                ? selectedProject.status === "queued"
                  ? `${selectedProject.name} is queued. Its log starts when ${activeProject?.name ?? "the previous project"} finishes.`
                  : `No agent output for ${selectedProject.name} yet.`
                : "Nothing yet. Setup steps show up here as the VM starts."
            }
          />
        </div>
        <VmPanel
          workspace={workspace}
          events={events}
          isSetupSelected={selection === vmSelection}
          onShowSetupLog={() => setChosenSelection(vmSelection)}
        />
      </div>
      {workspace.status === "running" && (
        <AddProjectDialog
          workspace={workspace}
          isOpen={isDialogOpen}
          onClose={closeDialog}
          onAdded={(project) => {
            setWorkspace((current) =>
              current && !current.projects.some((existing) => existing.id === project.id)
                ? { ...current, projects: [...current.projects, project] }
                : current,
            );
            setChosenSelection(undefined);
          }}
        />
      )}
    </div>
  );
}

function applyEvent(workspace: Workspace, event: Event): Workspace {
  if (event.type !== "status" && event.type !== "services" && event.type !== "error") return workspace;
  if (event.projectId === null) {
    if (event.type === "status") return { ...workspace, status: event.status as WorkspaceStatus };
    if (event.type === "error" && workspace.status === "failed") return { ...workspace, error: event.message };
    return workspace;
  }
  return {
    ...workspace,
    projects: workspace.projects.map((project) => {
      if (project.id !== event.projectId) return project;
      if (event.type === "status") return { ...project, status: event.status as ProjectStatus };
      if (event.type === "services") return { ...project, services: event.services };
      return { ...project, error: event.message };
    }),
  };
}
