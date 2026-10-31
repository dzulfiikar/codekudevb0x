import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createProxmoxClient, shellQuote, wait } from "../src/proxmox.js";
import type { Host, Workspace } from "../src/types.js";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:8787";
const reportPath = resolve(process.cwd(), "../e2e-report.json");
const steps: { name: string; ok: boolean; seconds: number; detail?: string }[] = [];
const report = {
  startedAt: new Date().toISOString(),
  baseUrl,
  steps,
  workspace: null as Workspace | null,
  hotReload: null as { file: string; marker: string; seenAfterMs: number } | null,
  events: [] as unknown[],
};

async function readStoredEvents(workspaceId: string) {
  const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/events`, { signal: AbortSignal.timeout(3000) });
  const reader = response.body?.getReader();
  if (!reader) return [];
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // The stream stays open for live events; the timeout ends the read once stored events are in.
  }
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as unknown);
}

function requireEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env to run the E2E test`);
  return value;
}

async function api<Result>(method: string, path: string, body?: Record<string, unknown>): Promise<Result> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body && { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text}`);
  return (text ? JSON.parse(text) : null) as Result;
}

async function step<Result>(name: string, action: () => Promise<Result>) {
  const started = Date.now();
  try {
    const result = await action();
    steps.push({ name, ok: true, seconds: Math.round((Date.now() - started) / 1000) });
    console.log(`ok   ${name}`);
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    steps.push({ name, ok: false, seconds: Math.round((Date.now() - started) / 1000), detail });
    console.log(`FAIL ${name}: ${detail}`);
    throw error;
  }
}

async function pollWorkspace(workspaceId: string, isDone: (workspace: Workspace) => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workspace = await api<Workspace>("GET", `/api/workspaces/${workspaceId}`);
    report.workspace = workspace;
    if (workspace.status === "failed") throw new Error(`Workspace failed: ${workspace.error}`);
    if (isDone(workspace)) return workspace;
    await wait(10_000);
  }
  throw new Error(`Timed out after ${timeoutMs / 1000} s`);
}

let host: Host | undefined;
let workspaceId: string | undefined;
try {
  host = await step("add host", () =>
    api<Host>("POST", "/api/hosts", {
      name: "e2e",
      baseUrl: requireEnvironment("E2E_PROXMOX_URL"),
      tokenId: requireEnvironment("E2E_PROXMOX_TOKEN_ID"),
      tokenSecret: requireEnvironment("E2E_PROXMOX_TOKEN_SECRET"),
      node: process.env.E2E_PROXMOX_NODE || undefined,
      templateVmid: Number(process.env.E2E_TEMPLATE_VMID || 9000),
      bridge: process.env.E2E_BRIDGE || "vmbr0",
      allowSelfSigned: process.env.E2E_ALLOW_SELF_SIGNED === "true",
    }),
  );
  const hostId = host.id;
  if (host.templateStatus !== "ready") {
    await step("prepare host template", async () => {
      await api("POST", `/api/hosts/${hostId}/prepare`);
      const deadline = Date.now() + 30 * 60_000;
      while (Date.now() < deadline) {
        const current = (await api<Host[]>("GET", "/api/hosts")).find((entry) => entry.id === hostId);
        if (current?.templateStatus === "ready") return;
        if (current?.templateStatus === "failed") throw new Error(`Prepare failed: ${current.templateMessage}`);
        await wait(5000);
      }
      throw new Error("Template not ready after 30 minutes");
    });
  }
  const workspace = await step("create workspace", () =>
    api<Workspace>("POST", "/api/workspaces", {
      hostId,
      name: `e2e-${Date.now().toString(36)}`,
      sshPublicKey: requireEnvironment("E2E_SSH_PUBLIC_KEY"),
      githubToken: process.env.E2E_GITHUB_TOKEN,
      agentClis: ["claude"],
      memoryMb: Number(process.env.E2E_MEMORY_MB || 2048),
      firstProjectRepoUrl: requireEnvironment("E2E_REPO_URL"),
    }),
  );
  workspaceId = workspace.id;
  const id = workspace.id;
  await step("workspace running", () => pollWorkspace(id, (current) => current.status === "running", 15 * 60_000));
  const ready = await step("first project ready", () =>
    pollWorkspace(
      id,
      (current) => {
        const project = current.projects[0];
        if (project?.status === "failed") throw new Error(`Project failed: ${project.error}`);
        return project?.status === "ready";
      },
      30 * 60_000,
    ),
  );
  await step("service URLs respond", async () => {
    for (const service of ready.projects[0]?.services ?? []) {
      const response = await fetch(service.url, { signal: AbortSignal.timeout(10_000) });
      if (response.status >= 500) throw new Error(`${service.url} -> ${response.status}`);
    }
  });
  await step("hot reload", async () => {
    const file = process.env.E2E_RELOAD_FILE || "index.html";
    const project = ready.projects[0];
    const service = project?.services[0];
    if (!project || !service || ready.vmid === null || !host) throw new Error("No service to check");
    const before = await (await fetch(service.url, { signal: AbortSignal.timeout(10_000) })).text();
    const marker = `e2e-reload-${Date.now().toString(36)}`;
    if (before.includes(marker)) throw new Error("Marker already present before the edit");

    const proxmox = createProxmoxClient({
      baseUrl: host.baseUrl,
      tokenId: host.tokenId,
      tokenSecret: requireEnvironment("E2E_PROXMOX_TOKEN_SECRET"),
      node: host.node,
      allowSelfSigned: host.allowSelfSigned,
    });
    const path = `/home/dev/projects/${project.name}/${file}`;
    const append = `printf '%s\\n' ${shellQuote(`<!-- ${marker} -->`)} >> ${shellQuote(path)}`;
    const result = await proxmox.execInGuest(ready.vmid, ["sudo", "-u", "dev", "bash", "-c", append]);
    if (result.exitCode !== 0) throw new Error(`Editing ${path} failed: ${result.stderr}`);

    const editedAt = Date.now();
    while (Date.now() - editedAt < 30_000) {
      const response = await fetch(service.url, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
      if (response && (await response.text()).includes(marker)) {
        report.hotReload = { file, marker, seenAfterMs: Date.now() - editedAt };
        return;
      }
      await wait(1000);
    }
    throw new Error(`Marker did not appear at ${service.url} within 30 s of editing ${file}`);
  });
} catch {
  process.exitCode = 1;
} finally {
  if (workspaceId) {
    const id = workspaceId;
    report.events = await readStoredEvents(id).catch(() => []);
    await step("delete workspace", async () => {
      await api("DELETE", `/api/workspaces/${id}`);
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        const response = await fetch(`${baseUrl}/api/workspaces/${id}`);
        if (response.status === 404) return;
        await wait(5000);
      }
      throw new Error("Workspace still exists after 5 minutes");
    }).catch(() => {
      process.exitCode = 1;
    });
  }
  if (host) {
    const id = host.id;
    await step("delete host", () => api("DELETE", `/api/hosts/${id}`)).catch(() => {
      process.exitCode = 1;
    });
  }
  writeFileSync(reportPath, `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`Report written to ${reportPath}`);
}
