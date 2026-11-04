import { post, request } from "../../shared/api-client";
import type { CreateWorkspaceInput, Workspace } from "../../shared/api-types";

export const workspacesApi = {
  list: () => request<Workspace[]>("/workspaces"),
  get: (id: string) => request<Workspace>(`/workspaces/${id}`),
  create: (workspace: CreateWorkspaceInput) => post<Workspace>("/workspaces", workspace),
  delete: (id: string) => request<void>(`/workspaces/${id}`, { method: "DELETE" }),
  eventsUrl: (workspaceId: string) => `/api/workspaces/${workspaceId}/events`,
};
