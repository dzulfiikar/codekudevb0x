export type Host = {
  id: string;
  name: string;
  baseUrl: string;
  tokenId: string;
  node: string;
  templateVmid: number;
  bridge: string;
  vmStorage: string;
  allowSelfSigned: boolean;
  version: string | null;
  templateStatus: TemplateStatus;
  templateMessage: string | null;
  lastCheck: HostCheck | null;
  createdAt: string;
};

export type CheckStatus = "ok" | "warn" | "fail";

export type HostCheck = {
  ready: boolean;
  checkedAt: string;
  version: string | null;
  node: string | null;
  checks: { id: string; label: string; status: CheckStatus; detail: string; fix: string | null }[];
};

type TemplateStatus = "missing" | "preparing" | "ready" | "failed";

export type WorkspaceStatus =
  | "cloning_vm"
  | "configuring_vm"
  | "starting"
  | "installing_tools"
  | "running"
  | "failed"
  | "deleting";
export type ProjectStatus = "queued" | "cloning_repo" | "configuring_services" | "verifying" | "ready" | "failed";

type Service = { name: string; port: number; url: string; reachable: boolean };
export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  status: ProjectStatus;
  services: Service[];
  error: string | null;
  createdAt: string;
};
export type Workspace = {
  id: string;
  hostId: string;
  name: string;
  vmid: number | null;
  ip: string | null;
  status: WorkspaceStatus;
  agentClis: string[];
  cores: number;
  memoryMb: number;
  diskGb: number;
  hasGithubToken: boolean;
  error: string | null;
  projects: Project[];
  createdAt: string;
};

export type Event = { id: number; workspaceId: string; projectId: string | null; at: string } & (
  | { type: "status"; status: WorkspaceStatus | ProjectStatus }
  | { type: "log"; message: string }
  | { type: "agent"; message: string }
  | { type: "command"; command: string; exitCode: number; output: string }
  | { type: "services"; services: Service[] }
  | { type: "error"; message: string }
);

export type AgentCli = "claude" | "antigravity";

export type NewHost = {
  name: string;
  baseUrl: string;
  tokenId: string;
  tokenSecret: string;
  node?: string;
  templateVmid?: number;
  bridge?: string;
  allowSelfSigned: boolean;
};

export type NewWorkspace = {
  hostId: string;
  name: string;
  githubToken?: string;
  sshPublicKey: string;
  agentClis: AgentCli[];
  cores: number;
  memoryMb: number;
  diskGb: number;
  firstProjectRepoUrl?: string;
};

export type HostTestResult = { ok: true; version: string } | { ok: false; message: string };

export type Settings = {
  geminiApiKeySource: "database" | "none";
  geminiApiKeyHint: string | null;
  primaryModel: string;
  fallbackModel: string | null;
  availableModels: { id: string; displayName: string }[];
};

export type SettingsUpdate = { geminiApiKey?: string; primaryModel: string; fallbackModel: string | null };

export type KeyTestResult = { ok: true; modelCount: number } | { ok: false; message: string };

export const workspaceNamePattern = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const repoUrlPattern = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/;

class ApiError extends Error {
  constructor(
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function readError(response: Response): Promise<ApiError> {
  const fallback =
    response.status === 502 || response.status === 504
      ? "Could not reach the app server on port 8787. Check that it is running."
      : `The server answered ${response.status} ${response.statusText}.`;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiError(fallback, undefined);
  }
  if (body && typeof body === "object") {
    const { message, error } = body as { message?: unknown; error?: unknown };
    if (typeof message === "string") return new ApiError(message, body);
    if (typeof error === "string") return new ApiError(error, body);
  }
  return new ApiError(fallback, body);
}

export function findHostCheck(error: unknown): HostCheck | undefined {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return undefined;
  const { check } = error.body as { check?: HostCheck };
  return check && Array.isArray(check.checks) ? check : undefined;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

export const api = {
  listHosts: () => request<Host[]>("/hosts"),
  createHost: (host: NewHost) => post<Host>("/hosts", host),
  deleteHost: (id: string) => request<void>(`/hosts/${id}`, { method: "DELETE" }),
  testHost: (id: string) => post<HostTestResult>(`/hosts/${id}/test`),
  checkNewHost: (host: Omit<NewHost, "name">) => post<HostCheck>("/hosts/check", host),
  checkHost: (id: string) => post<HostCheck>(`/hosts/${id}/check`),
  prepareHost: (id: string) => post<void>(`/hosts/${id}/prepare`),
  listWorkspaces: () => request<Workspace[]>("/workspaces"),
  getWorkspace: (id: string) => request<Workspace>(`/workspaces/${id}`),
  createWorkspace: (workspace: NewWorkspace) => post<Workspace>("/workspaces", workspace),
  deleteWorkspace: (id: string) => request<void>(`/workspaces/${id}`, { method: "DELETE" }),
  addProject: (workspaceId: string, project: { repoUrl: string; name?: string }) =>
    post<Project>(`/workspaces/${workspaceId}/projects`, project),
  getSettings: () => request<Settings>("/settings"),
  updateSettings: (settings: SettingsUpdate) => request<Settings>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
  testGeminiKey: (geminiApiKey?: string) => post<KeyTestResult>("/settings/test", geminiApiKey ? { geminiApiKey } : undefined),
  eventsUrl: (workspaceId: string) => `/api/workspaces/${workspaceId}/events`,
};

export function errorMessage(error: unknown): string {
  if (error instanceof TypeError) return "Could not reach the app server on port 8787. Check that it is running.";
  return error instanceof Error ? error.message : String(error);
}
