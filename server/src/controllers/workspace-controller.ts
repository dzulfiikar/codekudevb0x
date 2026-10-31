import { z } from "zod";
import type { Event } from "../shared/api-types.js";
import { githubRepositoryUrlPattern, resourceNamePattern } from "../shared/patterns.js";
import { workspaceEventService } from "../services/workspace-event-service.js";
import { workspaceService } from "../services/workspace-service.js";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const newWorkspaceBody = z.object({
  hostId: z.string().min(1),
  name: z.string().trim().regex(resourceNamePattern, "Use lowercase letters, digits and dashes (max 40)"),
  githubToken: optionalText,
  sshPublicKey: z
    .string()
    .trim()
    .regex(/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+|sk-\S+) [A-Za-z0-9+/=]+( .*)?$/, "Paste a single OpenSSH public key"),
  agentClis: z.array(z.enum(["claude", "antigravity"])).default([]),
  cores: z.coerce.number().int().min(1).max(64).default(2),
  memoryMb: z.coerce.number().int().min(512).max(262_144).default(4096),
  diskGb: z.coerce.number().int().min(8).max(2048).default(20),
  firstProjectRepoUrl: optionalText.pipe(
    z.string().regex(githubRepositoryUrlPattern, "Use https://github.com/OWNER/REPO").optional(),
  ),
});

class WorkspaceController {
  list() {
    return workspaceService.list();
  }

  get(workspaceId: string) {
    return workspaceService.get(workspaceId);
  }

  create(body: unknown) {
    return workspaceService.create(newWorkspaceBody.parse(body));
  }

  remove(workspaceId: string) {
    return workspaceService.remove(workspaceId);
  }

  listEventsAfter(workspaceId: string, afterId: number) {
    return workspaceEventService.listAfter(workspaceId, afterId);
  }

  subscribeToEvents(workspaceId: string, listener: (event: Event) => void) {
    return workspaceEventService.subscribe(workspaceId, listener);
  }
}

export const workspaceController = new WorkspaceController();
