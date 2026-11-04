import { decrypt } from "../../infrastructure/encryption.js";
import { GeminiClient } from "../../integrations/gemini/gemini-client.js";
import { type ReportedService, SetupAgent } from "./project-setup-agent.js";
import { projectRepository, type ProjectRecord } from "./project-repository.js";
import { workspaceRepository } from "../workspaces/workspace-repository.js";
import type { Project, ProjectStatus, Service } from "../../shared/api-types.js";
import { ConflictError, InvalidInputError, NotFoundError, toErrorMessage } from "../../shared/errors.js";
import { isTcpPortOpen } from "../../shared/network.js";
import { githubRepositoryUrlPattern, resourceNamePattern } from "../../shared/patterns.js";
import { quoteForShell } from "../../shared/shell.js";
import { sleep } from "../../shared/sleep.js";
import { hostService } from "../hosts/host-service.js";
import { settingsService } from "../settings/settings-service.js";
import { eventService } from "../events/event-service.js";

const busyStatuses: ProjectStatus[] = ["queued", "cloning_repo", "configuring_services", "verifying"];

function toProjectResponse(record: ProjectRecord): Project {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    name: record.name,
    repoUrl: record.repoUrl,
    status: record.status,
    services: record.services,
    error: record.error,
    createdAt: record.createdAt,
  };
}

function projectNameFromRepositoryUrl(repoUrl: string) {
  const repositoryName = githubRepositoryUrlPattern.exec(repoUrl)?.[2] ?? "";
  return repositoryName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

async function waitForPort(ip: string, port: number) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isTcpPortOpen(ip, port)) return true;
    await sleep(5000);
  }
  return false;
}

function checkServices(ip: string, reported: ReportedService[]): Promise<Service[]> {
  return Promise.all(
    reported.map(async (service) => ({
      ...service,
      url: `http://${ip}:${service.port}`,
      reachable: await waitForPort(ip, service.port),
    })),
  );
}

class ProjectService {
  private readonly setupQueues = new Map<string, Promise<void>>();

  async listByWorkspace(workspaceId: string) {
    return (await projectRepository.listByWorkspace(workspaceId)).map(toProjectResponse);
  }

  async create(workspaceId: string, input: { repoUrl: string; name?: string }) {
    await this.getRunningWorkspace(workspaceId);

    if (!githubRepositoryUrlPattern.test(input.repoUrl)) {
      throw new InvalidInputError(`Not a GitHub repository URL: ${input.repoUrl}`);
    }
    const name = input.name ?? projectNameFromRepositoryUrl(input.repoUrl);
    if (!resourceNamePattern.test(name)) {
      throw new InvalidInputError(`Project name "${name}" must be lowercase letters, digits and dashes (max 40)`);
    }
    if (await projectRepository.findByName(workspaceId, name)) {
      throw new InvalidInputError(`A project named "${name}" already exists in this workspace`);
    }

    const project = toProjectResponse(
      await projectRepository.create({
        id: crypto.randomUUID(),
        workspaceId,
        name,
        repoUrl: input.repoUrl,
        status: "queued",
        services: [],
        error: null,
        createdAt: new Date().toISOString(),
      }),
    );
    await eventService.record(workspaceId, project.id, { type: "status", status: "queued" });
    const previousSetup = this.setupQueues.get(workspaceId) ?? Promise.resolve();
    this.setupQueues.set(workspaceId, previousSetup.then(() => this.runSetup(project)));
    return project;
  }

  async deleteByWorkspace(workspaceId: string) {
    await projectRepository.deleteByWorkspace(workspaceId);
    this.setupQueues.delete(workspaceId);
  }

  async failInterruptedSetups() {
    for (const record of await projectRepository.listByStatuses(busyStatuses)) {
      await this.setStatus(toProjectResponse(record), "failed", "Server restarted during setup");
    }
  }

  private async getRunningWorkspace(workspaceId: string) {
    const workspace = await workspaceRepository.findById(workspaceId);
    if (!workspace) throw new NotFoundError("Workspace not found");
    if (workspace.status !== "running") throw new ConflictError("The workspace VM is not running yet");
    return workspace;
  }

  private async setStatus(project: Project, status: ProjectStatus, error: string | null = null) {
    await projectRepository.update(project.id, { status, error });
    await eventService.record(project.workspaceId, project.id, { type: "status", status });
    if (error) await eventService.record(project.workspaceId, project.id, { type: "error", message: error });
  }

  private async findUsedPorts(workspaceId: string, exceptProjectId: string) {
    const records = await projectRepository.listByWorkspace(workspaceId);
    return records.flatMap((record) =>
      record.id === exceptProjectId ? [] : record.services.map((service) => service.port),
    );
  }

  private async createSetupAgent(options: Omit<ConstructorParameters<typeof SetupAgent>[0], "gemini">) {
    const gemini = await settingsService.findGeminiSettings();
    if (!gemini.apiKey) throw new Error("No Gemini API key. Add one on the Settings page.");
    const models = gemini.fallbackModel ? [gemini.primaryModel, gemini.fallbackModel] : [gemini.primaryModel];
    return new SetupAgent({ ...options, gemini: new GeminiClient(gemini.apiKey, models) });
  }

  private async runSetup(project: Project) {
    try {
      const workspace = await workspaceRepository.findById(project.workspaceId);
      if (!workspace) throw new Error("Workspace was deleted");
      if (workspace.status !== "running" || workspace.vmid === null || workspace.ip === null) {
        throw new Error("Workspace is not running");
      }
      const { vmid, ip } = workspace;
      const proxmox = await hostService.getProxmoxClient(workspace.hostId);
      const match = githubRepositoryUrlPattern.exec(project.repoUrl);
      if (!match) throw new Error(`Not a GitHub repository URL: ${project.repoUrl}`);
      const repositoryPath = `${match[1]}/${match[2]}`;
      const projectPath = `/home/dev/projects/${project.name}`;
      const quotedProjectPath = quoteForShell(projectPath);

      await this.setStatus(project, "cloning_repo");
      const token = workspace.githubToken ? decrypt(workspace.githubToken) : undefined;
      const setSshRemote = `sudo -u dev git -C ${quotedProjectPath} remote set-url origin ${quoteForShell(`git@github.com:${repositoryPath}.git`)}`;
      // The GitHub token goes in on stdin so it never appears in a command line, the process list or Proxmox task logs.
      const cloneCommand = token
        ? `read -r TOKEN; sudo -u dev git clone "https://x-access-token:\${TOKEN}@github.com/"${quoteForShell(`${repositoryPath}.git`)} ${quotedProjectPath} && ${setSshRemote}`
        : `sudo -u dev git clone ${quoteForShell(`https://github.com/${repositoryPath}.git`)} ${quotedProjectPath} && ${setSshRemote}`;
      const cloneResult = await proxmox.runInGuest(vmid, ["bash", "-c", cloneCommand], {
        input: token ? `${token}\n` : undefined,
      });
      const redactToken = (text: string) => (token ? text.replaceAll(token, "***") : text);
      const redactedCloneResult = {
        exitCode: cloneResult.exitCode,
        stdout: redactToken(cloneResult.stdout),
        stderr: redactToken(cloneResult.stderr),
      };
      await eventService.recordCommand(
        project.workspaceId,
        project.id,
        `git clone https://github.com/${repositoryPath}.git ${projectPath}`,
        redactedCloneResult,
      );
      if (cloneResult.exitCode !== 0) throw new Error(`git clone failed: ${redactedCloneResult.stderr.trim().slice(-500)}`);

      await this.setStatus(project, "configuring_services");
      const agent = await this.createSetupAgent({
        projectName: project.name,
        projectPath,
        usedPorts: await this.findUsedPorts(project.workspaceId, project.id),
        runCommand: async (command) => {
          const result = await proxmox
            .runInGuest(vmid, ["bash", "-lc", `cd ${quotedProjectPath} && ${command}`])
            .catch((error: unknown) => ({
              exitCode: 124,
              stdout: "",
              stderr: `${toErrorMessage(error)}. Long-lived processes must run as systemd units, not in the foreground.`,
            }));
          await eventService.recordCommand(project.workspaceId, project.id, command, result);
          return result;
        },
        onAgentMessage: (message) =>
          void eventService.record(project.workspaceId, project.id, { type: "agent", message }),
      });

      let reported = await agent.run(`Set up the project "${project.name}" at ${projectPath} and start its services.`);
      await this.setStatus(project, "verifying");
      let services = await checkServices(ip, reported);
      await eventService.record(project.workspaceId, project.id, { type: "services", services });

      const unreachable = services.filter((service) => !service.reachable);
      if (unreachable.length) {
        const ports = unreachable.map((service) => `${service.name} on port ${service.port}`).join(", ");
        await this.setStatus(project, "configuring_services");
        reported = await agent.run(
          `These services are not reachable from outside the VM after 60 s: ${ports}. Check that they run and listen on 0.0.0.0, fix them, then call report_services again.`,
        );
        await this.setStatus(project, "verifying");
        services = await checkServices(ip, reported);
        await eventService.record(project.workspaceId, project.id, { type: "services", services });
      }

      await projectRepository.update(project.id, { services });
      if (services.some((service) => !service.reachable)) {
        await this.setStatus(project, "failed", "Some services are still unreachable after a second attempt");
      } else {
        await this.setStatus(project, "ready");
      }
    } catch (error) {
      if (await projectRepository.findById(project.id)) await this.setStatus(project, "failed", toErrorMessage(error));
    }
  }
}

export const projectService = new ProjectService();
