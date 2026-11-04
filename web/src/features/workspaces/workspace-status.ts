import type { Workspace, WorkspaceStatus } from "../../shared/api-types";
import type { LabelTone } from "../../shared/components/StatusLabel";
import { formatMemory } from "../../shared/format";

export function workspaceLabel(status: WorkspaceStatus): { tone: LabelTone; text: string } {
  if (status === "running") return { tone: "success", text: "Running" };
  if (status === "failed") return { tone: "danger", text: "Failed" };
  if (status === "deleting") return { tone: "muted", text: "Deleting" };
  return { tone: "attention", text: "Setting up" };
}

export const workspaceSteps: WorkspaceStatus[] = ["cloning_vm", "configuring_vm", "starting", "installing_tools"];

export const workspaceStatusLabel: Record<WorkspaceStatus, string> = {
  cloning_vm: "Cloning VM from template",
  configuring_vm: "Setting up your user and VM size",
  starting: "Starting the VM",
  installing_tools: "Installing coding tools",
  running: "VM running",
  failed: "VM setup failed",
  deleting: "Deleting VM",
};

export function workspaceSummary(workspace: Workspace): string {
  return `${workspace.cores} vCPU, ${formatMemory(workspace.memoryMb)}, ${workspace.diskGb} GB`;
}
