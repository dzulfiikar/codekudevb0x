import { GitBranchIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import type { Project, ProjectStatus, Workspace } from "../../shared/api-types";
import { StatusLabel } from "../../shared/components/StatusLabel";
import { boxClass, boxHeaderClass, secondaryButton } from "../../shared/components/styles";
import { projectLabel, projectStatusLabel } from "./project-status";

const projectDetail: Record<ProjectStatus, string> = {
  queued: "queued",
  cloning_repo: "cloning",
  configuring_services: "starting dev server",
  verifying: "checking ports",
  ready: "reloads on save",
  failed: "setup failed",
};

export function ProjectsBox({
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
