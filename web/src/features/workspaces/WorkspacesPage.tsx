import { DesktopTowerIcon, FunnelIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Workspace } from "../../shared/api-types";
import { ErrorBox } from "../../shared/components/ErrorBox";
import { LoadingText } from "../../shared/components/LoadingText";
import { PageLayout } from "../../shared/components/PageLayout";
import { StatusLabel } from "../../shared/components/StatusLabel";
import { boxClass, boxHeaderClass, primaryButton, secondaryButton } from "../../shared/components/styles";
import { Link } from "../../shared/router";
import { useResource } from "../../shared/use-resource";
import { useHosts } from "../hosts/HostsContext";
import { isSettingUp, projectStatusLabel } from "../projects/project-status";
import { EmptyWorkspaces } from "./EmptyWorkspaces";
import { workspaceLabel, workspaceStatusLabel, workspaceSummary } from "./workspace-status";
import { workspacesApi } from "./workspaces-api";

type StatusFilter = "all" | "running" | "setting-up" | "failed";

const statusFilterLabel: Record<StatusFilter, string> = {
  all: "All",
  running: "Running",
  "setting-up": "Setting up",
  failed: "Failed",
};

function matchesStatus(workspace: Workspace, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running") return workspace.status === "running";
  if (filter === "failed") return workspace.status === "failed";
  return workspace.status !== "running" && workspace.status !== "failed";
}

function matchesQuery(workspace: Workspace, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [workspace.name, workspace.ip ?? "", ...workspace.projects.map((project) => project.name)].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

export function WorkspacesPage() {
  const workspaces = useResource(workspacesApi.list, "workspaces");
  const hosts = useHosts();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { reload } = workspaces;

  useEffect(() => {
    const timer = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(timer);
  }, [reload]);

  if (workspaces.isLoading || hosts.isLoading) {
    return (
      <PageLayout title="Workspaces">
        <LoadingText>Loading workspaces</LoadingText>
      </PageLayout>
    );
  }

  if (workspaces.error && !workspaces.data) {
    return (
      <PageLayout title="Workspaces">
        <ErrorBox title="Could not load workspaces">
          {workspaces.error}{" "}
          <button type="button" onClick={() => void reload()} className="focus-ring cursor-pointer rounded-sm bg-transparent p-0 font-semibold text-accent">
            Try again
          </button>
        </ErrorBox>
      </PageLayout>
    );
  }

  const list = workspaces.data ?? [];
  if (list.length === 0) return <EmptyWorkspaces />;

  const hostNames = new Map((hosts.data ?? []).map((host) => [host.id, host.name]));
  const visible = list
    .filter((workspace) => matchesStatus(workspace, statusFilter) && matchesQuery(workspace, query))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <PageLayout
      title="Workspaces"
      description="One VM per workspace. Projects run in dev mode with hot reload."
      action={
        <Link href="/workspaces/new" className={`${primaryButton} no-underline`}>
          <PlusIcon size={16} aria-hidden="true" />
          New workspace
        </Link>
      }
    >
      <div className="flex gap-2">
        <label className="relative w-[360px]">
          <span className="sr-only">Filter workspaces</span>
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name, IP or project"
            className="focus-ring w-full rounded-md border border-line bg-bg py-[5px] pr-3 pl-9 text-sm leading-5 text-text placeholder:text-muted"
          />
        </label>
        <label className={`${secondaryButton} relative cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent`}>
          <FunnelIcon size={16} className="text-muted" aria-hidden="true" />
          Status: {statusFilterLabel[statusFilter]}
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Filter by status"
          >
            {(Object.keys(statusFilterLabel) as StatusFilter[]).map((filter) => (
              <option key={filter} value={filter}>
                {statusFilterLabel[filter]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {workspaces.error && <ErrorBox title="Could not refresh workspaces">{workspaces.error} Showing the last loaded list.</ErrorBox>}
      <section className={boxClass} aria-label="Workspaces">
        <div className={boxHeaderClass}>
          <h2 className="m-0 text-sm font-semibold">
            {visible.length === list.length ? `${list.length} ${list.length === 1 ? "workspace" : "workspaces"}` : `${visible.length} of ${list.length} workspaces`}
          </h2>
          <span className="text-xs text-muted">Newest first</span>
        </div>
        {visible.length === 0 ? (
          <p className="m-0 px-4 py-8 text-center text-sm text-muted">
            No workspaces match these filters.{" "}
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
              }}
              className="focus-ring cursor-pointer rounded-sm border-0 bg-transparent p-0 text-accent"
            >
              Clear filters
            </button>
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {visible.map((workspace) => (
              <WorkspaceRow key={workspace.id} workspace={workspace} hostName={hostNames.get(workspace.hostId)} />
            ))}
          </ul>
        )}
      </section>
    </PageLayout>
  );
}

function WorkspaceRow({ workspace, hostName }: { workspace: Workspace; hostName: string | undefined }) {
  const label = workspaceLabel(workspace.status);
  const detail = describeProgress(workspace);
  const meta = [
    workspace.vmid === null ? "no VM yet" : `VM ${workspace.vmid}`,
    workspace.ip ?? "no IP",
    hostName,
    workspaceSummary(workspace),
  ].filter(Boolean);
  return (
    <li className="flex gap-4 border-t border-line-muted px-4 py-3 first:border-t-0">
      <DesktopTowerIcon size={20} className="mt-1 shrink-0 text-muted" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/workspaces/${encodeURIComponent(workspace.id)}`}
            className="focus-ring rounded-sm text-base font-semibold text-accent no-underline hover:underline"
          >
            {workspace.name}
          </Link>
          <StatusLabel tone={label.tone}>{label.text}</StatusLabel>
        </div>
        <div className="flex flex-wrap gap-x-4 font-mono text-xs text-muted">
          {meta.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </div>
        {detail && <p className={`m-0 text-sm ${workspace.status === "failed" ? "text-danger" : "text-muted"}`}>{detail}</p>}
      </div>
      <div className="w-[300px] shrink-0">
        <ProjectLinks workspace={workspace} />
      </div>
    </li>
  );
}

function ProjectLinks({ workspace }: { workspace: Workspace }) {
  if (workspace.projects.length === 0) {
    return (
      <p className="m-0 text-sm text-muted">
        {workspace.status === "running" ? "No projects yet" : workspace.status === "failed" ? "No projects set up" : "Projects start after setup"}
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {workspace.projects.map((project) => {
        const service = project.services[0];
        return (
          <li key={project.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{project.name}</span>
            {service ? (
              <a href={service.url} target="_blank" rel="noreferrer" className="focus-ring rounded-sm font-mono text-xs text-accent no-underline hover:underline">
                {service.url.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              <span className="text-xs text-muted">{projectStatusLabel[project.status]}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function describeProgress(workspace: Workspace): string | undefined {
  if (workspace.status === "failed") return workspace.error ?? workspaceStatusLabel.failed;
  if (workspace.status !== "running") return workspaceStatusLabel[workspace.status];
  const active = workspace.projects.find(isSettingUp);
  if (active) return `Setting up ${active.name}`;
  const failed = workspace.projects.find((project) => project.status === "failed");
  if (failed) return `${failed.name}: ${failed.error ?? projectStatusLabel.failed}`;
  return undefined;
}
