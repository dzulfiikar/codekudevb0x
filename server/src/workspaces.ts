import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { createAgentSession } from "./agent.js";
import { db } from "./db/client.js";
import { events, projects, workspaces } from "./db/schema.js";
import { errorMessage, findHostRow, getProxmoxClient } from "./hosts.js";
import { type CommandResult, type ProxmoxClient, shellQuote, wait } from "./proxmox.js";
import { decrypt } from "./secrets.js";
import { buildSeedIso } from "./seed-iso.js";
import type { Event, EventBody, Project, ProjectStatus, Service, Workspace, WorkspaceStatus } from "./types.js";

export const repoUrlPattern = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/;
export const namePattern = /^[a-z0-9][a-z0-9-]{0,39}$/;

const setupStatuses: WorkspaceStatus[] = ["cloning_vm", "configuring_vm", "starting", "installing_tools", "deleting"];
const unfinishedProjectStatuses: ProjectStatus[] = ["queued", "cloning_repo", "configuring_services", "verifying"];
const cliInstallers: Record<string, string> = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  antigravity: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
};

const eventBus = new EventEmitter();
eventBus.setMaxListeners(0);
const projectQueues = new Map<string, Promise<void>>();


const isoStorage = "local";
const seedIsoFilename = (vmid: number) => `workspace-${vmid}-seed.iso`;

async function recordEvent(workspaceId: string, projectId: string | null, body: EventBody) {
  const at = new Date().toISOString();
  const [row] = await db
    .insert(events)
    .values({ workspaceId, projectId, type: body.type, payload: body, at })
    .returning({ id: events.id });
  if (!row) throw new Error("Event insert returned no row");
  const event: Event = { ...body, id: row.id, workspaceId, projectId, at };
  eventBus.emit(workspaceId, event);
  return event;
}

export async function listEvents(workspaceId: string, afterId = 0): Promise<Event[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.workspaceId, workspaceId), gt(events.id, afterId)))
    .orderBy(asc(events.id));
  return rows.map((row) => ({ ...row.payload, id: row.id, workspaceId: row.workspaceId, projectId: row.projectId, at: row.at }));
}

export function subscribe(workspaceId: string, listener: (event: Event) => void) {
  eventBus.on(workspaceId, listener);
  return () => eventBus.off(workspaceId, listener);
}

function toProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    repoUrl: row.repoUrl,
    status: row.status,
    services: row.services,
    error: row.error,
    createdAt: row.createdAt,
  };
}

export async function toWorkspace(row: typeof workspaces.$inferSelect): Promise<Workspace> {
  const workspaceProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, row.id))
    .orderBy(asc(projects.createdAt));
  return {
    id: row.id,
    hostId: row.hostId,
    name: row.name,
    vmid: row.vmid,
    ip: row.ip,
    status: row.status,
    agentClis: row.agentClis,
    cores: row.cores,
    memoryMb: row.memoryMb,
    diskGb: row.diskGb,
    hasGithubToken: row.githubToken !== null,
    error: row.error,
    projects: workspaceProjects.map(toProject),
    createdAt: row.createdAt,
  };
}

export async function findWorkspaceRow(workspaceId: string) {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  return row;
}

async function getWorkspaceRow(workspaceId: string) {
  const row = await findWorkspaceRow(workspaceId);
  if (!row) throw new Error("Workspace was deleted");
  return row;
}

async function setWorkspaceStatus(workspaceId: string, status: WorkspaceStatus, error: string | null = null) {
  await db.update(workspaces).set({ status, error }).where(eq(workspaces.id, workspaceId));
  await recordEvent(workspaceId, null, { type: "status", status });
  if (error) await recordEvent(workspaceId, null, { type: "error", message: error });
}

async function setProjectStatus(project: Project, status: ProjectStatus, error: string | null = null) {
  await db.update(projects).set({ status, error }).where(eq(projects.id, project.id));
  await recordEvent(project.workspaceId, project.id, { type: "status", status });
  if (error) await recordEvent(project.workspaceId, project.id, { type: "error", message: error });
}

export async function failInterruptedPipelines() {
  const message = "Server restarted during setup";
  for (const row of await db.select().from(workspaces).where(inArray(workspaces.status, setupStatuses))) {
    await setWorkspaceStatus(row.id, "failed", message);
  }
  for (const row of await db.select().from(projects).where(inArray(projects.status, unfinishedProjectStatuses))) {
    await setProjectStatus(toProject(row), "failed", message);
  }
}

async function runLogged(
  proxmox: ProxmoxClient,
  workspaceId: string,
  projectId: string | null,
  vmid: number,
  command: string,
  options: { input?: string; displayCommand?: string; redact?: string } = {},
): Promise<CommandResult> {
  const result = await proxmox.execInGuest(vmid, ["bash", "-c", command], { input: options.input });
  const redact = (text: string) => (options.redact ? text.replaceAll(options.redact, "***") : text);
  const output = redact(`${result.stdout}${result.stderr}`).slice(-4000);
  await recordEvent(workspaceId, projectId, {
    type: "command",
    command: options.displayCommand ?? command,
    exitCode: result.exitCode,
    output,
  });
  return { exitCode: result.exitCode, stdout: redact(result.stdout), stderr: redact(result.stderr) };
}

export async function runWorkspacePipeline(workspaceId: string, firstProjectRepoUrl?: string) {
  try {
    const workspace = await getWorkspaceRow(workspaceId);
    const host = await findHostRow(workspace.hostId);
    if (!host) throw new Error("Host was deleted");
    const proxmox = await getProxmoxClient(workspace.hostId);

    await setWorkspaceStatus(workspaceId, "cloning_vm");
    const vmid = await proxmox.nextVmid();
    await db.update(workspaces).set({ vmid }).where(eq(workspaces.id, workspaceId));
    await proxmox.cloneVm(host.templateVmid, vmid, workspace.name);
    await recordEvent(workspaceId, null, { type: "log", message: `Cloned template ${host.templateVmid} to VM ${vmid}` });

    await setWorkspaceStatus(workspaceId, "configuring_vm");
    const seedIso = await buildSeedIso({
      instanceId: `workspace-${workspace.id}`,
      hostname: workspace.name,
      sshPublicKey: workspace.sshPublicKey,
    });
    await proxmox.uploadIso(isoStorage, seedIsoFilename(vmid), seedIso);
    await recordEvent(workspaceId, null, { type: "log", message: "Prepared first-boot config" });
    await proxmox.configureVm(vmid, {
      cores: workspace.cores,
      // Claude Code and Vite's native binaries crash with "Illegal instruction" on the default x86-64-v2-AES CPU.
      cpu: "host",
      memory: workspace.memoryMb,
      ide2: `${isoStorage}:iso/${seedIsoFilename(vmid)},media=cdrom`,
      net0: `virtio,bridge=${host.bridge}`,
    });
    await proxmox.resizeDisk(vmid, "scsi0", `${workspace.diskGb}G`);
    await recordEvent(workspaceId, null, { type: "log", message: `Set ${workspace.cores} vCPU, ${Number((workspace.memoryMb / 1024).toFixed(1))} GB RAM, ${workspace.diskGb} GB disk` });

    await setWorkspaceStatus(workspaceId, "starting");
    await proxmox.startVm(vmid);
    await recordEvent(workspaceId, null, { type: "log", message: "Booting, waiting for IP" });
    const ip = await waitForIp(proxmox, vmid);
    await db.update(workspaces).set({ ip }).where(eq(workspaces.id, workspaceId));
    await recordEvent(workspaceId, null, { type: "log", message: `IP ${ip}` });

    await setWorkspaceStatus(workspaceId, "installing_tools");
    const run = (command: string) => runLogged(proxmox, workspaceId, null, vmid, command);
    await run("cloud-init status --wait || true");
    const requiredSteps = [
      "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs",
      "install -d -o dev -g dev /home/dev/projects",
      "install -d -m 700 -o dev -g dev /home/dev/.ssh && ssh-keyscan github.com >> /home/dev/.ssh/known_hosts && chown dev:dev /home/dev/.ssh/known_hosts",
      `grep -q '.local/bin' /home/dev/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/dev/.bashrc`,
    ];
    for (const command of requiredSteps) {
      const result = await run(command);
      if (result.exitCode !== 0) throw new Error(`Setup command failed: ${command}`);
    }
    if ((await run("usermod -aG docker dev")).exitCode !== 0) {
      await recordEvent(workspaceId, null, { type: "error", message: "Could not add dev to the docker group. Is Docker installed in the template?" });
    }
    for (const cli of workspace.agentClis) {
      const installer = cliInstallers[cli];
      if (!installer) continue;
      const result = await run(`sudo -iu dev bash -lc ${shellQuote(installer)}`);
      if (result.exitCode !== 0) await recordEvent(workspaceId, null, { type: "error", message: `Installing ${cli} failed` });
    }

    await setWorkspaceStatus(workspaceId, "running");
    if (firstProjectRepoUrl) {
      const project = await createProject(workspaceId, firstProjectRepoUrl);
      if ("error" in project) await recordEvent(workspaceId, null, { type: "error", message: project.error });
    }
  } catch (error) {
    if (await findWorkspaceRow(workspaceId)) await setWorkspaceStatus(workspaceId, "failed", errorMessage(error));
  }
}

async function waitForIp(proxmox: ProxmoxClient, vmid: number) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const ip = await proxmox.findIpv4(vmid).catch(() => undefined);
    if (ip) return ip;
    await wait(5000);
  }
  throw new Error("No IP after 5 min. Check the VM console in Proxmox for cloud-init errors.");
}

export async function deleteWorkspace(workspaceId: string) {
  try {
    const workspace = await getWorkspaceRow(workspaceId);
    await setWorkspaceStatus(workspaceId, "deleting");
    const proxmox = await getProxmoxClient(workspace.hostId);
    // Proxmox reuses VM IDs, so only touch the VM (and its seed ISO) if it still carries this workspace's name.
    const vm = workspace.vmid === null ? undefined : await proxmox.findVm(workspace.vmid);
    if (workspace.vmid !== null && !vm) {
      await recordEvent(workspaceId, null, { type: "log", message: `VM ${workspace.vmid} does not exist; removing the workspace only` });
    } else if (workspace.vmid !== null && vm?.name !== workspace.name) {
      await recordEvent(workspaceId, null, {
        type: "log",
        message: `VM ${workspace.vmid} now belongs to "${vm?.name ?? "another VM"}"; leaving it and its seed ISO alone`,
      });
    } else if (workspace.vmid !== null) {
      const vmid = workspace.vmid;
      await proxmox.stopVm(vmid).catch(async (error: unknown) => {
        await recordEvent(workspaceId, null, { type: "log", message: `Stop skipped: ${errorMessage(error)}` });
      });
      await proxmox.destroyVm(vmid).catch(async (error: unknown) => {
        if (!errorMessage(error).includes("does not exist")) throw error;
        await recordEvent(workspaceId, null, { type: "log", message: `VM ${vmid} already gone: ${errorMessage(error)}` });
      });
      await proxmox.deleteVolume(isoStorage, `${isoStorage}:iso/${seedIsoFilename(vmid)}`).catch(async (error: unknown) => {
        await recordEvent(workspaceId, null, { type: "log", message: `Seed ISO not removed: ${errorMessage(error)}` });
      });
    }
    await recordEvent(workspaceId, null, { type: "log", message: "Workspace deleted" });
    await db.delete(events).where(eq(events.workspaceId, workspaceId));
    await db.delete(projects).where(eq(projects.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    projectQueues.delete(workspaceId);
  } catch (error) {
    if (await findWorkspaceRow(workspaceId)) await setWorkspaceStatus(workspaceId, "failed", `Delete failed: ${errorMessage(error)}`);
  }
}

function projectNameFromRepo(repoUrl: string) {
  const repo = repoUrlPattern.exec(repoUrl)?.[2] ?? "";
  return repo
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export async function createProject(
  workspaceId: string,
  repoUrl: string,
  requestedName?: string,
): Promise<{ project: Project } | { error: string }> {
  if (!repoUrlPattern.test(repoUrl)) return { error: `Not a GitHub repository URL: ${repoUrl}` };
  const name = requestedName ?? projectNameFromRepo(repoUrl);
  if (!namePattern.test(name)) {
    return { error: `Project name "${name}" must be lowercase letters, digits and dashes (max 40)` };
  }
  const [projectWithName] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.name, name)));
  if (projectWithName) return { error: `A project named "${name}" already exists in this workspace` };

  const [row] = await db
    .insert(projects)
    .values({
      id: crypto.randomUUID(),
      workspaceId,
      name,
      repoUrl,
      status: "queued",
      services: [],
      error: null,
      createdAt: new Date().toISOString(),
    })
    .returning();
  if (!row) throw new Error("Project insert returned no row");
  const project = toProject(row);
  await recordEvent(workspaceId, project.id, { type: "status", status: "queued" });
  const previous = projectQueues.get(workspaceId) ?? Promise.resolve();
  projectQueues.set(workspaceId, previous.then(() => runProjectPipeline(project)));
  return { project };
}

async function runProjectPipeline(project: Project) {
  try {
    const workspace = await getWorkspaceRow(project.workspaceId);
    if (workspace.status !== "running" || workspace.vmid === null || workspace.ip === null) {
      throw new Error("Workspace is not running");
    }
    const { vmid, ip } = workspace;
    const proxmox = await getProxmoxClient(workspace.hostId);
    const match = repoUrlPattern.exec(project.repoUrl);
    if (!match) throw new Error(`Not a GitHub repository URL: ${project.repoUrl}`);
    const ownerRepo = `${match[1]}/${match[2]}`;
    const projectPath = `/home/dev/projects/${project.name}`;
    const path = shellQuote(projectPath);

    await setProjectStatus(project, "cloning_repo");
    const token = workspace.githubToken ? decrypt(workspace.githubToken) : undefined;
    const setRemote = `sudo -u dev git -C ${path} remote set-url origin ${shellQuote(`git@github.com:${ownerRepo}.git`)}`;
    const cloneCommand = token
      ? `read -r TOKEN; sudo -u dev git clone "https://x-access-token:\${TOKEN}@github.com/"${shellQuote(`${ownerRepo}.git`)} ${path} && ${setRemote}`
      : `sudo -u dev git clone ${shellQuote(`https://github.com/${ownerRepo}.git`)} ${path} && ${setRemote}`;
    const clone = await runLogged(proxmox, project.workspaceId, project.id, vmid, cloneCommand, {
      input: token ? `${token}\n` : undefined,
      displayCommand: `git clone https://github.com/${ownerRepo}.git ${projectPath}`,
      redact: token,
    });
    if (clone.exitCode !== 0) throw new Error(`git clone failed: ${clone.stderr.trim().slice(-500)}`);

    await setProjectStatus(project, "configuring_services");
    const agent = await createAgentSession({
      projectName: project.name,
      projectPath,
      usedPorts: await findUsedPorts(project.workspaceId, project.id),
      runCommand: async (command) => {
        const result = await proxmox
          .execInGuest(vmid, ["bash", "-lc", `cd ${path} && ${command}`])
          .catch((error: unknown) => ({
            exitCode: 124,
            stdout: "",
            stderr: `${errorMessage(error)}. Long-lived processes must run as systemd units, not in the foreground.`,
          }));
        await recordEvent(project.workspaceId, project.id, {
          type: "command",
          command,
          exitCode: result.exitCode,
          output: `${result.stdout}${result.stderr}`.slice(-4000),
        });
        return result;
      },
      onAgentMessage: (message) => void recordEvent(project.workspaceId, project.id, { type: "agent", message }),
    });

    let reported = await agent.run(`Set up the project "${project.name}" at ${projectPath} and start its services.`);
    await setProjectStatus(project, "verifying");
    let services = await verifyServices(ip, reported);
    await recordEvent(project.workspaceId, project.id, { type: "services", services });

    const unreachable = services.filter((service) => !service.reachable);
    if (unreachable.length) {
      const ports = unreachable.map((service) => `${service.name} on port ${service.port}`).join(", ");
      await setProjectStatus(project, "configuring_services");
      reported = await agent.run(
        `These services are not reachable from outside the VM after 60 s: ${ports}. Check that they run and listen on 0.0.0.0, fix them, then call report_services again.`,
      );
      await setProjectStatus(project, "verifying");
      services = await verifyServices(ip, reported);
      await recordEvent(project.workspaceId, project.id, { type: "services", services });
    }

    await db.update(projects).set({ services }).where(eq(projects.id, project.id));
    if (services.some((service) => !service.reachable)) {
      await setProjectStatus(project, "failed", "Some services are still unreachable after a second attempt");
    } else {
      await setProjectStatus(project, "ready");
    }
  } catch (error) {
    const [stillExists] = await db.select().from(projects).where(eq(projects.id, project.id));
    if (stillExists) {
      await setProjectStatus(project, "failed", errorMessage(error));
    }
  }
}

async function findUsedPorts(workspaceId: string, exceptProjectId: string) {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));
  return rows.flatMap((row) => (row.id === exceptProjectId ? [] : row.services.map((service) => service.port)));
}

async function verifyServices(ip: string, reported: { name: string; port: number }[]): Promise<Service[]> {
  return Promise.all(
    reported.map(async (service) => ({
      ...service,
      url: `http://${ip}:${service.port}`,
      reachable: await waitForPort(ip, service.port),
    })),
  );
}

async function waitForPort(ip: string, port: number) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isPortOpen(ip, port)) return true;
    await wait(5000);
  }
  return false;
}

export function isPortOpen(ip: string, port: number, timeoutMs = 3000) {
  return new Promise<boolean>((resolve) => {
    const socket = new Socket();
    const finish = (isOpen: boolean) => {
      socket.destroy();
      resolve(isOpen);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, ip);
  });
}
