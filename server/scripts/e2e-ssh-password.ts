import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import type { Host, Workspace } from "../src/shared/api-types.js";
import { sleep } from "../src/shared/sleep.js";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:8787";
const username = "e2euser";
const password = randomBytes(18).toString("base64url");
const steps: { name: string; ok: boolean; seconds: number; detail?: string }[] = [];
const report = {
  what: "Password-only workspace: create, SSH in with the password, check the password is stored nowhere, delete",
  startedAt: new Date().toISOString(),
  username,
  memoryMb: 512,
  steps,
  ssh: null as { whoami: string; isSudoWithoutPassword: boolean } | null,
  passwordFoundIn: [] as string[],
  workspace: null as Workspace | null,
};

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
    const detail = (error instanceof Error ? error.message : String(error)).replaceAll(password, "***");
    steps.push({ name, ok: false, seconds: Math.round((Date.now() - started) / 1000), detail });
    console.log(`FAIL ${name}: ${detail}`);
    throw error;
  }
}

async function readStoredEvents(workspaceId: string) {
  const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/events`, { signal: AbortSignal.timeout(3000) });
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    // The stream stays open for live events; the timeout ends the read once stored events are in.
  }
  return text;
}

// expect reads the password from its environment, so it never appears in a process list.
async function runOverSsh(ip: string, remoteCommand: string) {
  const script = `
set timeout 30
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PubkeyAuthentication=no -o PreferredAuthentications=password ${username}@${ip} ${remoteCommand}
expect {
  -re "assword:" { send "$env(E2E_SSH_PASSWORD)\\r"; exp_continue }
  eof
}
catch wait result
exit [lindex $result 3]
`;
  const { stdout } = await execFileAsync("expect", ["-c", script], {
    env: { ...process.env, E2E_SSH_PASSWORD: password },
  });
  return stdout;
}

let workspaceId: string | undefined;
try {
  const [host] = await api<Host[]>("GET", "/api/hosts");
  if (!host) throw new Error("Add a host before running this test");

  const created = await step("Create password-only workspace", () =>
    api<Workspace>("POST", "/api/workspaces", {
      hostId: process.env.E2E_HOST_ID ?? host.id,
      name: `pw-e2e-${Date.now().toString(36)}`,
      username,
      password,
      agentClis: [],
      cores: 1,
      memoryMb: 512,
      diskGb: 10,
    }),
  );
  workspaceId = created.id;

  const running = await step("Wait for the workspace to run", async () => {
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const workspace = await api<Workspace>("GET", `/api/workspaces/${created.id}`);
      if (workspace.status === "running") return workspace;
      if (workspace.status === "failed") throw new Error(workspace.error ?? "Workspace failed");
      await sleep(5000);
    }
    throw new Error("Workspace not running after 15 min");
  });
  report.workspace = running;
  const ip = running.ip ?? "";

  await step("SSH in with the password", async () => {
    const whoami = (await runOverSsh(ip, "whoami")).split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
    if (whoami !== username) throw new Error(`whoami printed "${whoami}"`);
    const sudoOutput = await runOverSsh(ip, "sudo -n true && echo sudo-ok");
    report.ssh = { whoami, isSudoWithoutPassword: sudoOutput.includes("sudo-ok") };
    if (!report.ssh.isSudoWithoutPassword) throw new Error("sudo -n true failed");
  });

  await step("Password is stored nowhere", async () => {
    const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await database.connect();
    try {
      const rows = await database.query("SELECT row_to_json(workspaces)::text AS json FROM workspaces WHERE id = $1", [created.id]);
      if (rows.rows.some((row: { json: string }) => row.json.includes(password))) report.passwordFoundIn.push("database");
    } finally {
      await database.end();
    }
    if ((await readStoredEvents(created.id)).includes(password)) report.passwordFoundIn.push("events");
    const userData = await runOverSsh(ip, "sudo cat /var/lib/cloud/instance/user-data.txt");
    if (!userData.includes("#cloud-config")) throw new Error("Could not read the seed user-data in the VM");
    if (userData.includes(password)) report.passwordFoundIn.push("seed ISO user-data");
    const { stdout: logs } = await execFileAsync("docker", ["compose", "logs", "app"], { cwd: join(import.meta.dirname, "../.."), maxBuffer: 50_000_000 });
    if (logs.includes(password)) report.passwordFoundIn.push("server logs");
    if (report.passwordFoundIn.length) throw new Error(`Password found in: ${report.passwordFoundIn.join(", ")}`);
  });
} catch {
  process.exitCode = 1;
} finally {
  if (workspaceId) {
    const id = workspaceId;
    await step("Delete the workspace", async () => {
      await api("DELETE", `/api/workspaces/${id}`);
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        const response = await fetch(`${baseUrl}/api/workspaces/${id}`);
        if (response.status === 404) return;
        await sleep(3000);
      }
      throw new Error("Workspace still exists after 5 min");
    }).catch(() => {
      process.exitCode = 1;
    });
  }
  const evidenceDirectory = join(import.meta.dirname, "../../docs/evidence");
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidencePath = join(evidenceDirectory, `e2e-ssh-password-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(evidencePath, `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`Report written to ${evidencePath}`);
}
