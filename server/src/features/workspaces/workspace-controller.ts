import type { Request, Response } from "express";
import { z } from "zod";
import { githubRepositoryUrlPattern, resourceNamePattern } from "../../shared/patterns.js";
import { optionalText } from "../../shared/validation.js";
import { workspaceService } from "./workspace-service.js";

const passwordMessage = "Use 12 to 128 characters, on one line.";

const createWorkspaceBody = z.object({
  hostId: z.string().min(1),
  name: z.string().trim().regex(resourceNamePattern, "Use lowercase letters, digits and dashes (max 40)"),
  githubToken: optionalText,
  username: optionalText.pipe(
    z
      .string()
      .regex(/^[a-z_][a-z0-9_-]{0,31}$/, "Use a-z, 0-9, - and _, starting with a letter or _ (max 32).")
      .default("dev"),
  ),
  sshPublicKey: optionalText.pipe(
    z
      .string()
      .regex(/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+|sk-\S+) [A-Za-z0-9+/=]+( .*)?$/, "Paste a single OpenSSH public key")
      .optional(),
  ),
  password: z
    .string()
    .optional()
    .transform((value) => value || undefined)
    .pipe(z.string().min(12, passwordMessage).max(128, passwordMessage).regex(/^[^\r\n]*$/, passwordMessage).optional()),
  agentClis: z.array(z.enum(["claude", "antigravity"])).default([]),
  cores: z.coerce.number().int().min(1).max(64).default(2),
  memoryMb: z.coerce.number().int().min(512).max(262_144).default(4096),
  diskGb: z.coerce.number().int().min(8).max(2048).default(20),
  firstProjectRepoUrl: optionalText.pipe(
    z.string().regex(githubRepositoryUrlPattern, "Use https://github.com/OWNER/REPO").optional(),
  ),
});

class WorkspaceController {
  list = async (_request: Request, response: Response) => {
    response.json(await workspaceService.list());
  };

  get = async (request: Request<{ id: string }>, response: Response) => {
    response.json(await workspaceService.get(request.params.id));
  };

  create = async (request: Request, response: Response) => {
    response.status(202).json(await workspaceService.create(createWorkspaceBody.parse(request.body)));
  };

  delete = async (request: Request<{ id: string }>, response: Response) => {
    await workspaceService.delete(request.params.id);
    response.status(202).end();
  };
}

export const workspaceController = new WorkspaceController();
