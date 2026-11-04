import type { Project, ProjectStatus } from "../../shared/api-types";
import type { LabelTone } from "../../shared/components/StatusLabel";

export function projectLabel(status: ProjectStatus): { tone: LabelTone; text: string } {
  if (status === "ready") return { tone: "success", text: "Ready" };
  if (status === "failed") return { tone: "danger", text: "Failed" };
  if (status === "queued") return { tone: "muted", text: "Queued" };
  return { tone: "attention", text: "Setting up" };
}

export const projectStatusLabel: Record<ProjectStatus, string> = {
  queued: "Queued",
  cloning_repo: "Cloning repository",
  configuring_services: "Starting services",
  verifying: "Verifying ports",
  ready: "Ready",
  failed: "Setup failed",
};

export function isSettingUp(project: Project): boolean {
  return project.status === "cloning_repo" || project.status === "configuring_services" || project.status === "verifying";
}
