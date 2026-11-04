import type { Host, HostCheck, HostTestResult, KeyTestResult, NewHost, NewWorkspace, Project, Settings, SettingsUpdate, Workspace } from "./api-types";

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
