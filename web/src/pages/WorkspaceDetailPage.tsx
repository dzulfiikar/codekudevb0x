import {
  ArrowsClockwiseIcon,
  ChatCircleTextIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CodeIcon,
  CopyIcon,
  GitBranchIcon,
  PlusIcon,
  TerminalWindowIcon,
  TrashIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { api, errorMessage, type Event, type Project, type ProjectStatus, type Workspace, type WorkspaceStatus } from "../api";
import { Link, navigate } from "../router";
import {
  ErrorBox,
  LoadingText,
  StatusLabel,
  boxClass,
  boxHeaderClass,
  dangerButton,
  isSettingUp,
  primaryButton,
  projectLabel,
  projectStatusLabel,
  secondaryButton,
  useCopy,
  useHosts,
  useResource,
  workspaceLabel,
  workspaceStatusLabel,
  workspaceSteps,
  workspaceSummary,
} from "../ui";
import { AddProjectDialog } from "./AddProjectDialog";

type StreamState = "connecting" | "streaming" | "reconnecting" | "closed";
const vmSelection = "vm";

export function WorkspaceDetailPage({ workspaceId }: { workspaceId: string }) {
  const workspaceResource = useResource(() => api.getWorkspace(workspaceId), workspaceId);
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
    const source = new EventSource(api.eventsUrl(workspaceId));
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

function failedStepIndex(events: Event[], projectId: string | null, steps: string[]): number {
  const statuses = events.filter(
    (event): event is Extract<Event, { type: "status" }> => event.type === "status" && event.projectId === projectId,
  );
  const lastStep = statuses.map((event) => steps.indexOf(event.status)).filter((index) => index >= 0).at(-1);
  return lastStep ?? 0;
}


function WorkspaceHeader({
  workspace,
  addProjectButtonRef,
  onAddProject,
}: {
  workspace: Workspace;
  addProjectButtonRef: RefObject<HTMLButtonElement | null>;
  onAddProject: () => void;
}) {
  const hosts = useHosts();
  const hostName = hosts.data?.find((host) => host.id === workspace.hostId)?.name;
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const label = workspaceLabel(workspace.status);

  async function deleteWorkspace() {
    setIsDeleting(true);
    setDeleteError(undefined);
    try {
      await api.deleteWorkspace(workspace.id);
      navigate("/workspaces");
    } catch (caught) {
      setDeleteError(errorMessage(caught));
      setIsDeleting(false);
      setIsConfirmingDelete(false);
    }
  }

  const meta = [
    workspace.vmid === null ? "no VM yet" : `VM ${workspace.vmid}`,
    workspace.ip ?? "no IP yet",
    hostName,
    `${workspace.projects.length} ${workspace.projects.length === 1 ? "project" : "projects"}`,
  ].filter(Boolean);

  return (
    <>
      <nav aria-label="Breadcrumb" className="flex gap-2 text-sm">
        <Link href="/workspaces" className="focus-ring rounded-sm text-accent no-underline hover:underline">
          Workspaces
        </Link>
        <span className="text-muted" aria-hidden="true">
          /
        </span>
        <span className="font-semibold" aria-current="page">
          {workspace.name}
        </span>
      </nav>
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="m-0 text-2xl font-semibold">{workspace.name}</h1>
            <StatusLabel tone={label.tone}>{label.text}</StatusLabel>
          </div>
          <div className="flex flex-wrap gap-x-4 font-mono text-xs text-muted">
            {meta.map((value) => (
              <span key={value}>{value}</span>
            ))}
          </div>
        </div>
        {isConfirmingDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Stop and delete this VM with all its projects?</span>
            <button type="button" className={dangerButton} onClick={() => void deleteWorkspace()} disabled={isDeleting}>
              {isDeleting ? "Deleting" : "Delete"}
            </button>
            <button type="button" className={secondaryButton} onClick={() => setIsConfirmingDelete(false)} disabled={isDeleting}>
              Keep workspace
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {workspace.status !== "deleting" && (
              <button type="button" className={dangerButton} onClick={() => setIsConfirmingDelete(true)}>
                <TrashIcon size={16} aria-hidden="true" />
                Delete workspace
              </button>
            )}
            {workspace.status === "running" ? (
              <button ref={addProjectButtonRef} type="button" className={primaryButton} onClick={onAddProject}>
                <PlusIcon size={16} aria-hidden="true" />
                Add project
              </button>
            ) : (
              workspace.status !== "failed" &&
              workspace.status !== "deleting" && <span className="text-xs text-muted">Add projects once the VM is running</span>
            )}
          </div>
        )}
      </div>
      {deleteError && <ErrorBox title={`Could not delete ${workspace.name}`}>{deleteError}</ErrorBox>}
    </>
  );
}

const projectDetail: Record<ProjectStatus, string> = {
  queued: "queued",
  cloning_repo: "cloning",
  configuring_services: "starting dev server",
  verifying: "checking ports",
  ready: "reloads on save",
  failed: "setup failed",
};

function ProjectsBox({
  workspace,
  activeProject,
  selection,
  onSelect,
}: {
  workspace: Workspace;
  activeProject: Project | undefined;
  selection: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className={boxClass} aria-labelledby="projects-title">
      <div className={boxHeaderClass}>
        <h2 id="projects-title" className="m-0 text-sm font-semibold">
          Projects
        </h2>
        <span className="text-xs text-muted">One at a time, no port clashes</span>
      </div>
      {workspace.projects.length === 0 ? (
        <p className="m-0 px-4 py-6 text-sm text-muted">
          {workspace.status === "running" ? "No projects yet. Add a GitHub repo to start one." : "Add projects once the VM is running."}
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {workspace.projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              activeProject={activeProject}
              isSelected={selection === project.id}
              onSelect={() => onSelect(project.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectRow({
  project,
  activeProject,
  isSelected,
  onSelect,
}: {
  project: Project;
  activeProject: Project | undefined;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const label = projectLabel(project.status);
  const statusText =
    project.status === "queued" && activeProject ? `Waiting for ${activeProject.name}` : projectStatusLabel[project.status];
  return (
    <li className={`flex items-center gap-4 border-t border-line-muted px-4 py-3 first:border-t-0 ${isSelected ? "bg-accent/10" : ""}`}>
      <GitBranchIcon size={20} className="shrink-0 text-muted" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{project.name}</span>
          <StatusLabel tone={label.tone}>{label.text === "Setting up" ? statusText : label.text}</StatusLabel>
        </div>
        <div className="flex flex-wrap gap-x-4 font-mono text-xs text-muted">
          <span className="truncate">{project.repoUrl.replace(/^https:\/\//, "")}</span>
          <span>~/projects/{project.name}</span>
        </div>
        {project.status === "failed" && <p className="m-0 text-sm text-danger">{project.error ?? "Setup failed. Open the log to see why."}</p>}
      </div>
      <div className="flex w-[260px] shrink-0 flex-col gap-0.5">
        {project.services.length > 0 ? (
          <>
            <span className="text-xs text-muted">{projectDetail[project.status]}</span>
            {project.services.map((service) => (
              <a
                key={`${service.name}-${service.port}`}
                href={service.url}
                target="_blank"
                rel="noreferrer"
                className={`focus-ring rounded-sm font-mono text-sm no-underline hover:underline ${service.reachable ? "text-accent" : "text-muted"}`}
                aria-label={`${service.name} on port ${service.port}${service.reachable ? "" : ", not reachable"}, opens in a new tab`}
              >
                {service.url}
              </a>
            ))}
          </>
        ) : (
          <span className="text-xs text-muted">{project.status === "failed" ? "No services" : "No services yet"}</span>
        )}
      </div>
      <button type="button" aria-pressed={isSelected} onClick={onSelect} className={secondaryButton}>
        <TerminalWindowIcon size={16} aria-hidden="true" />
        {isSelected ? "Showing log" : "Show log"}
      </button>
    </li>
  );
}

const streamLabel: Record<StreamState, string> = {
  connecting: "connecting",
  streaming: "streaming",
  reconnecting: "disconnected, retrying",
  closed: "disconnected",
};

function EventLog({
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
        <TimelineText badge={<ChatCircleTextIcon size={16} aria-label="Gemma" />} tone="text-text">
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

function SideBox({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={boxClass} aria-label={title}>
      <div className={boxHeaderClass}>
        <h2 className="m-0 text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </section>
  );
}

function VmPanel({
  workspace,
  events,
  isSetupSelected,
  onShowSetupLog,
}: {
  workspace: Workspace;
  events: Event[];
  isSetupSelected: boolean;
  onShowSetupLog: () => void;
}) {
  const hosts = useHosts();
  const host = hosts.data?.find((candidate) => candidate.id === workspace.hostId);
  const agentNames = workspace.agentClis.map((agent) => (agent === "antigravity" ? "Antigravity CLI" : agent === "claude" ? "Claude Code" : agent));
  const facts: [string, string][] = [
    ["Host", host ? `${host.name} (${host.node})` : "unknown host"],
    ["Template", host ? String(host.templateVmid) : "unknown"],
    ["Size", workspaceSummary(workspace)],
    ["Agent CLI", agentNames.length > 0 ? agentNames.join(", ") : "none"],
    ["GitHub token", workspace.hasGithubToken ? "saved, encrypted" : "none"],
  ];

  return (
    <aside className="flex flex-col gap-4" aria-label="VM">
      {workspace.ip && <ConnectBox ip={workspace.ip} />}
      <SideBox title="About this VM">
        <dl className="m-0 flex flex-col gap-3">
          {facts.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="m-0 text-right font-mono text-xs leading-5">{value}</dd>
            </div>
          ))}
        </dl>
      </SideBox>
      <SideBox
        title="Setup"
        action={
          <button type="button" aria-pressed={isSetupSelected} onClick={onShowSetupLog} className={secondaryButton}>
            {isSetupSelected ? "Showing log" : "Show log"}
          </button>
        }
      >
        <SetupSteps workspace={workspace} events={events} />
      </SideBox>
    </aside>
  );
}

function SetupSteps({ workspace, events }: { workspace: Workspace; events: Event[] }) {
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

function ConnectBox({ ip }: { ip: string }) {
  const command = `ssh -A dev@${ip}`;
  const { copyState, copy } = useCopy(command);

  return (
    <SideBox title="Connect">
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-inset px-3 py-[5px] font-mono text-[13px] leading-5 select-all">
          {command}
        </code>
        <button type="button" onClick={() => void copy()} className={`${secondaryButton} px-2`} aria-label="Copy SSH command">
          {copyState === "copied" ? <CheckCircleIcon size={16} className="text-success" aria-hidden="true" /> : <CopyIcon size={16} aria-hidden="true" />}
        </button>
      </div>
      <span role="status" className="sr-only">
        {copyState === "copied" ? "SSH command copied" : ""}
      </span>
      {copyState === "failed" && <p className="m-0 text-xs text-danger">Copy failed. Select the command and copy it by hand.</p>}
      <a href={`vscode://vscode-remote/ssh-remote+dev@${ip}/home/dev/projects`} className={`${secondaryButton} self-start no-underline`}>
        <CodeIcon size={16} aria-hidden="true" />
        Open ~/projects in VS Code
      </a>
      <p className="m-0 text-xs leading-5 text-muted">-A lets git push use your SSH key. No push token in the VM.</p>
    </SideBox>
  );
}
