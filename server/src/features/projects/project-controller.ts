import type { Request, Response } from "express";
import { z } from "zod";
import { githubRepositoryUrlPattern } from "../../shared/patterns.js";
import { optionalText } from "../../shared/validation.js";
import { projectService } from "./project-service.js";

const createProjectBody = z.object({
  repoUrl: z.string().trim().regex(githubRepositoryUrlPattern, "Use https://github.com/OWNER/REPO"),
  name: optionalText,
  instructions: z.string().optional(),
});

class ProjectController {
  create = async (request: Request<{ id: string }>, response: Response) => {
    response.status(202).json(await projectService.create(request.params.id, createProjectBody.parse(request.body)));
  };
}

export const projectController = new ProjectController();
