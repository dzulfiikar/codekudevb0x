import { z } from "zod";
import { githubRepositoryUrlPattern } from "../../shared/patterns.js";
import { projectService } from "./project-service.js";

const newProjectBody = z.object({
  repoUrl: z.string().trim().regex(githubRepositoryUrlPattern, "Use https://github.com/OWNER/REPO"),
  name: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
});

class ProjectController {
  async add(workspaceId: string, body: unknown) {
    await projectService.getRunningWorkspace(workspaceId);
    return projectService.add(workspaceId, newProjectBody.parse(body));
  }
}

export const projectController = new ProjectController();
