import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { hosts, workspaces } from "../db/schema.js";
import { detectHostSettings, errorMessage, findHostRow, getProxmoxClient, prepareHost, toHost } from "../hosts.js";
import { runHostCheck } from "../host-check.js";
import { decrypt, encrypt } from "../secrets.js";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const createHostBody = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.url({ protocol: /^https?$/ }),
  tokenId: z.string().trim().regex(/^[^@\s]+@[^!\s]+![^\s]+$/, "Token ID looks like user@realm!tokenname"),
  tokenSecret: z.string().trim().min(1),
  node: optionalText,
  templateVmid: z.coerce.number().int().min(100).default(9000),
  bridge: z.string().trim().min(1).default("vmbr0"),
  allowSelfSigned: z.boolean().default(false),
});

const checkHostBody = createHostBody.omit({ name: true });

export const hostsRouter = Router();

hostsRouter.post("/check", async (request, response) => {
  const body = checkHostBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ message: z.prettifyError(body.error) });
    return;
  }
  response.json(await runHostCheck(body.data));
});

hostsRouter.post("/", async (request, response) => {
  const body = createHostBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ message: z.prettifyError(body.error) });
    return;
  }
  const check = await runHostCheck(body.data);
  if (!check.ready) {
    const failing = check.checks.filter((item) => item.status === "fail").map((item) => item.label);
    response.status(400).json({ message: `This host is not ready: ${failing.join(", ")}`, check });
    return;
  }
  let settings: Awaited<ReturnType<typeof detectHostSettings>>;
  try {
    settings = await detectHostSettings(body.data, body.data.templateVmid);
  } catch (error) {
    response.status(400).json({ message: `Could not connect to Proxmox: ${errorMessage(error)}` });
    return;
  }
  const [row] = await db
    .insert(hosts)
    .values({
      ...body.data,
      ...settings,
      id: crypto.randomUUID(),
      tokenSecret: encrypt(body.data.tokenSecret),
      lastCheck: check,
      createdAt: new Date().toISOString(),
    })
    .returning();
  if (!row) throw new Error("Host insert returned no row");
  response.status(201).json(toHost(row));
});

hostsRouter.get("/", async (_request, response) => {
  response.json((await db.select().from(hosts).orderBy(asc(hosts.createdAt))).map(toHost));
});

hostsRouter.delete("/:id", async (request, response) => {
  const host = await findHostRow(request.params.id);
  if (!host) {
    response.status(404).json({ message: "Host not found" });
    return;
  }
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.hostId, host.id)).limit(1);
  if (workspace) {
    response.status(409).json({ message: "Delete the workspaces on this host first" });
    return;
  }
  await db.delete(hosts).where(eq(hosts.id, host.id));
  response.status(204).end();
});

hostsRouter.post("/:id/test", async (request, response) => {
  const host = await findHostRow(request.params.id);
  if (!host) {
    response.status(404).json({ message: "Host not found" });
    return;
  }
  try {
    const version = await (await getProxmoxClient(host.id)).getVersion();
    await db.update(hosts).set({ version }).where(eq(hosts.id, host.id));
    response.json({ ok: true, version });
  } catch (error) {
    response.json({ ok: false, message: errorMessage(error) });
  }
});

hostsRouter.post("/:id/check", async (request, response) => {
  const host = await findHostRow(request.params.id);
  if (!host) {
    response.status(404).json({ message: "Host not found" });
    return;
  }
  const check = await runHostCheck({ ...host, tokenSecret: decrypt(host.tokenSecret) });
  await db.update(hosts).set({ lastCheck: check }).where(eq(hosts.id, host.id));
  response.json(check);
});

hostsRouter.post("/:id/prepare", async (request, response) => {
  const host = await findHostRow(request.params.id);
  if (!host) {
    response.status(404).json({ message: "Host not found" });
    return;
  }
  if (host.templateStatus === "preparing") {
    response.status(409).json({ message: "This host is already being prepared" });
    return;
  }
  await db
    .update(hosts)
    .set({ templateStatus: "preparing", templateMessage: "Starting" })
    .where(eq(hosts.id, host.id));
  void prepareHost(host.id);
  response.status(202).end();
});
