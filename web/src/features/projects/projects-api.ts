import { post } from "../../shared/api-client";
import type { Project } from "../../shared/api-types";

export const projectsApi = {
  create: (workspaceId: string, project: { repoUrl: string; name?: string; instructions?: string }) =>
    post<Project>(`/workspaces/${workspaceId}/projects`, project),
};
