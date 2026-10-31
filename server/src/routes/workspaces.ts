import { desc } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { workspaces } from "../db/schema.js";
import { findHostRow } from "../hosts.js";
import { encrypt } from "../secrets.js";
import type { Event, WorkspaceStatus } from "../types.js";
import {
  createProject,
  deleteWorkspace,
  findWorkspaceRow,
  listEvents,
  namePattern,
  repoUrlPattern,
  runWorkspacePipeline,
  subscribe,
  toWorkspace,
} from "../workspaces.js";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const createWorkspaceBody = z.object({
  hostId: z.string().min(1),
  name: z.string().trim().regex(namePattern, "Use lowercase letters, digits and dashes (max 40)"),
  githubToken: optionalText,
  sshPublicKey: z
    .string()
    .trim()
    .regex(/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+|sk-\S+) [A-Za-z0-9+/=]+( .*)?$/, "Paste a single OpenSSH public key"),
  agentClis: z.array(z.enum(["claude", "antigravity"])).default([]),
  cores: z.coerce.number().int().min(1).max(64).default(2),
  memoryMb: z.coerce.number().int().min(512).max(262_144).default(4096),
  diskGb: z.coerce.number().int().min(8).max(2048).default(20),
  firstProjectRepoUrl: optionalText.pipe(z.string().regex(repoUrlPattern, "Use https://github.com/OWNER/REPO").optional()),
});

const createProjectBody = z.object({
  repoUrl: z.string().trim().regex(repoUrlPattern, "Use https://github.com/OWNER/REPO"),
  name: optionalText,
});

const busyStatuses: WorkspaceStatus[] = ["cloning_vm", "configuring_vm", "starting", "installing_tools", "deleting"];

export const workspacesRouter = Router();

workspacesRouter.get("/", async (_request, response) => {
  const rows = await db.select().from(workspaces).orderBy(desc(workspaces.createdAt));
  response.json(await Promise.all(rows.map(toWorkspace)));
});

workspacesRouter.get("/:id", async (request, response) => {
  const row = await findWorkspaceRow(request.params.id);
  if (!row) {
    response.status(404).json({ message: "Workspace not found" });
    return;
  }
  response.json(await toWorkspace(row));
});

workspacesRouter.post("/", async (request, response) => {
  const body = createWorkspaceBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ message: z.prettifyError(body.error) });
    return;
  }
  const { firstProjectRepoUrl, githubToken, ...fields } = body.data;
  const host = await findHostRow(fields.hostId);
  if (!host) {
    response.status(400).json({ message: "Host not found. Add a Proxmox host first." });
    return;
  }
  if (host.templateStatus !== "ready") {
    response.status(400).json({ message: `Template ${host.templateVmid} is not ready. Prepare the host first.` });
    return;
  }
  const [row] = await db
    .insert(workspaces)
    .values({
      ...fields,
      id: crypto.randomUUID(),
      vmid: null,
      ip: null,
      status: "cloning_vm",
      githubToken: githubToken ? encrypt(githubToken) : null,
      error: null,
      createdAt: new Date().toISOString(),
    })
    .returning();
  if (!row) throw new Error("Workspace insert returned no row");
  void runWorkspacePipeline(row.id, firstProjectRepoUrl);
  response.status(202).json(await toWorkspace(row));
});

workspacesRouter.delete("/:id", async (request, response) => {
  const row = await findWorkspaceRow(request.params.id);
  if (!row) {
    response.status(404).json({ message: "Workspace not found" });
    return;
  }
  if (busyStatuses.includes(row.status)) {
    response.status(409).json({ message: "Wait for the current setup step to finish, then delete" });
    return;
  }
  void deleteWorkspace(row.id);
  response.status(202).end();
});

workspacesRouter.post("/:id/projects", async (request, response) => {
  const row = await findWorkspaceRow(request.params.id);
  if (!row) {
    response.status(404).json({ message: "Workspace not found" });
    return;
  }
  if (row.status !== "running") {
    response.status(409).json({ message: "The workspace VM is not running yet" });
    return;
  }
  const body = createProjectBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ message: z.prettifyError(body.error) });
    return;
  }
  const result = await createProject(row.id, body.data.repoUrl, body.data.name);
  if ("error" in result) {
    response.status(400).json({ message: result.error });
    return;
  }
  response.status(202).json(result.project);
});

workspacesRouter.get("/:id/events", async (request, response) => {
  const workspaceId = request.params.id;
  if (!(await findWorkspaceRow(workspaceId))) {
    response.status(404).json({ message: "Workspace not found" });
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  response.flushHeaders();

  let lastSentId = Number(request.header("Last-Event-ID") ?? 0) || 0;
  const send = (event: { id: number }) => {
    if (event.id <= lastSentId) return;
    lastSentId = event.id;
    response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  // Subscribe before the replay query so no event falls between the two; buffered ones go out after the replay.
  let buffered: Event[] | undefined = [];
  const unsubscribe = subscribe(workspaceId, (event) => (buffered ? buffered.push(event) : send(event)));
  for (const event of await listEvents(workspaceId, lastSentId)) send(event);
  for (const event of buffered) send(event);
  buffered = undefined;
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20_000);
  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
