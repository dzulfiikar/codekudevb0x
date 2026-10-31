import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage, type Host, type Project, type ProjectStatus, type Workspace, type WorkspaceStatus } from "./api";

const buttonBase =
  "focus-ring inline-flex items-center justify-center gap-2 rounded-md border px-4 py-[5px] text-sm font-medium leading-5 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60";
export const primaryButton = `${buttonBase} border-white/10 bg-success-emphasis text-white hover:brightness-110`;
export const secondaryButton = `${buttonBase} border-line bg-button text-text hover:bg-line-muted`;
export const dangerButton = `${buttonBase} border-line bg-button text-danger-button hover:border-danger hover:bg-danger/10`;
export const inputClass =
  "focus-ring w-full rounded-md border border-line bg-bg px-3 py-[5px] leading-5 font-mono text-sm text-text placeholder:text-muted aria-invalid:border-danger focus-visible:border-accent";
export const boxClass = "overflow-hidden rounded-md border border-line";
export const boxHeaderClass = "flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3";

export type LabelTone = "success" | "attention" | "danger" | "muted";

const labelToneClass: Record<LabelTone, string> = {
  success: "border-success text-success",
  attention: "border-warn text-warn",
  danger: "border-danger text-danger",
  muted: "border-line text-muted",
};

export function StatusLabel({ tone, children }: { tone: LabelTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 text-xs leading-[18px] font-medium whitespace-nowrap ${labelToneClass[tone]}`}>
      {children}
    </span>
  );
}

export function workspaceLabel(status: WorkspaceStatus): { tone: LabelTone; text: string } {
  if (status === "running") return { tone: "success", text: "Running" };
  if (status === "failed") return { tone: "danger", text: "Failed" };
  if (status === "deleting") return { tone: "muted", text: "Deleting" };
  return { tone: "attention", text: "Setting up" };
}

export function projectLabel(status: ProjectStatus): { tone: LabelTone; text: string } {
  if (status === "ready") return { tone: "success", text: "Ready" };
  if (status === "failed") return { tone: "danger", text: "Failed" };
  if (status === "queued") return { tone: "muted", text: "Queued" };
  return { tone: "attention", text: "Setting up" };
}

export type Resource<T> = {
  data: T | undefined;
  error: string | undefined;
  isLoading: boolean;
  reload: () => Promise<void>;
};

export function useResource<T>(load: () => Promise<T>, key: string): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setData(undefined);
    void reload();
  }, [key, reload]);

  return { data, error, isLoading, reload };
}

export type CopyState = "idle" | "copied" | "failed";

export function useCopy(text: string): { copyState: CopyState; copy: () => Promise<void> } {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return { copyState, copy };
}

export const HostsContext = createContext<Resource<Host[]> | undefined>(undefined);

export function useHosts(): Resource<Host[]> {
  const hosts = useContext(HostsContext);
  if (!hosts) throw new Error("useHosts needs HostsContext");
  return hosts;
}

export function ErrorBox({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-danger/60 bg-danger/10 px-4 py-3">
      <p className="m-0 text-sm font-semibold text-danger">{title}</p>
      {children && <div className="mt-1 text-xs leading-5 text-text">{children}</div>}
    </div>
  );
}

export function LoadingText({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="m-0 text-sm text-muted">
      {children}
    </p>
  );
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

function formatMemory(memoryMb: number): string {
  return memoryMb % 1024 === 0 ? `${memoryMb / 1024} GB` : `${memoryMb} MB`;
}

export function workspaceSummary(workspace: Workspace): string {
  return `${workspace.cores} vCPU, ${formatMemory(workspace.memoryMb)}, ${workspace.diskGb} GB`;
}
