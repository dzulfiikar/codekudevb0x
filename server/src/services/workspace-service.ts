import { encrypt } from "../infrastructure/encryption.js";
import { buildSeedIso } from "../integrations/cloud-init/seed-iso-builder.js";
import type { ProxmoxClient } from "../integrations/proxmox/proxmox-client.js";
import { projectRepository } from "../repositories/project-repository.js";
import { workspaceRepository, type WorkspaceRecord } from "../repositories/workspace-repository.js";
import type { Workspace, WorkspaceStatus } from "../shared/api-types.js";
import { ConflictError, InvalidInputError, NotFoundError, toErrorMessage } from "../shared/errors.js";
import { quoteForShell, sleep } from "../shared/shell.js";
import { hostService } from "./host-service.js";
import { projectService } from "./project-service.js";
import { workspaceEventService } from "./workspace-event-service.js";

type NewWorkspaceInput = {
  hostId: string;
  name: string;
  githubToken?: string;
  sshPublicKey: string;
  agentClis: string[];
  cores: number;
  memoryMb: number;
  diskGb: number;
  firstProjectRepoUrl?: string;
};

const busyStatuses: WorkspaceStatus[] = ["cloning_vm", "configuring_vm", "starting", "installing_tools", "deleting"];
const agentCliInstallCommands: Record<string, string> = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  antigravity: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
};
const requiredSetupCommands = [
  "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs",
  "install -d -o dev -g dev /home/dev/projects",
  "install -d -m 700 -o dev -g dev /home/dev/.ssh && ssh-keyscan github.com >> /home/dev/.ssh/known_hosts && chown dev:dev /home/dev/.ssh/known_hosts",
  `grep -q '.local/bin' /home/dev/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/dev/.bashrc`,
];
const isoStorage = "local";
const seedIsoFilename = (vmid: number) => `workspace-${vmid}-seed.iso`;

async function waitForIp(proxmox: ProxmoxClient, vmid: number) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const ip = await proxmox.findIpv4(vmid).catch(() => undefined);
    if (ip) return ip;
    await sleep(5000);
  }
  throw new Error("No IP after 5 min. Check the VM console in Proxmox for cloud-init errors.");
}

class WorkspaceService {
  async list() {
    const records = await workspaceRepository.list();
    return Promise.all(records.map((record) => this.toWorkspaceResponse(record)));
  }

  async get(workspaceId: string) {
    return this.toWorkspaceResponse(await this.getRecord(workspaceId));
  }

  async create(input: NewWorkspaceInput) {
    const { firstProjectRepoUrl, githubToken, ...fields } = input;
    const host = await hostService.findHostRecord(fields.hostId);
    if (!host) throw new InvalidInputError("Host not found. Add a Proxmox host first.");
    if (host.templateStatus !== "ready") {
      throw new InvalidInputError(`Template ${host.templateVmid} is not ready. Prepare the host first.`);
    }
    const record = await workspaceRepository.create({
      ...fields,
      id: crypto.randomUUID(),
      vmid: null,
      ip: null,
      status: "cloning_vm",
      githubToken: githubToken ? encrypt(githubToken) : null,
      error: null,
      createdAt: new Date().toISOString(),
    });
    void this.runSetup(record.id, firstProjectRepoUrl);
    return this.toWorkspaceResponse(record);
  }

  async remove(workspaceId: string) {
    const record = await this.getRecord(workspaceId);
    if (busyStatuses.includes(record.status)) {
      throw new ConflictError("Wait for the current setup step to finish, then delete");
    }
    void this.runDelete(record.id);
  }

  async failInterruptedSetups() {
    for (const record of await workspaceRepository.listByStatuses(busyStatuses)) {
      await this.setStatus(record.id, "failed", "Server restarted during setup");
    }
  }

  private async getRecord(workspaceId: string) {
    const record = await workspaceRepository.findById(workspaceId);
    if (!record) throw new NotFoundError("Workspace not found");
    return record;
  }

  private async toWorkspaceResponse(record: WorkspaceRecord): Promise<Workspace> {
    return {
      id: record.id,
      hostId: record.hostId,
      name: record.name,
      vmid: record.vmid,
      ip: record.ip,
      status: record.status,
      agentClis: record.agentClis,
      cores: record.cores,
      memoryMb: record.memoryMb,
      diskGb: record.diskGb,
      hasGithubToken: record.githubToken !== null,
      error: record.error,
      projects: await projectService.listForWorkspace(record.id),
      createdAt: record.createdAt,
    };
  }

  private async setStatus(workspaceId: string, status: WorkspaceStatus, error: string | null = null) {
    await workspaceRepository.update(workspaceId, { status, error });
    await workspaceEventService.record(workspaceId, null, { type: "status", status });
    if (error) await workspaceEventService.record(workspaceId, null, { type: "error", message: error });
  }

  private log(workspaceId: string, message: string) {
    return workspaceEventService.record(workspaceId, null, { type: "log", message });
  }

  private async runSetup(workspaceId: string, firstProjectRepoUrl?: string) {
    try {
      const workspace = await this.getRecord(workspaceId);
      const host = await hostService.findHostRecord(workspace.hostId);
      if (!host) throw new Error("Host was deleted");
      const proxmox = await hostService.getProxmoxClient(workspace.hostId);

      await this.setStatus(workspaceId, "cloning_vm");
      const vmid = await proxmox.getNextVmid();
      await workspaceRepository.update(workspaceId, { vmid });
      await proxmox.cloneVm(host.templateVmid, vmid, workspace.name);
      await this.log(workspaceId, `Cloned template ${host.templateVmid} to VM ${vmid}`);

      await this.setStatus(workspaceId, "configuring_vm");
      const seedIso = await buildSeedIso({
        instanceId: `workspace-${workspace.id}`,
        hostname: workspace.name,
        sshPublicKey: workspace.sshPublicKey,
      });
      await proxmox.uploadIso(isoStorage, seedIsoFilename(vmid), seedIso);
      await this.log(workspaceId, "Prepared first-boot config");
      await proxmox.configureVm(vmid, {
        cores: workspace.cores,
        // Claude Code and Vite's native binaries crash with "Illegal instruction" on the default x86-64-v2-AES CPU.
        cpu: "host",
        memory: workspace.memoryMb,
        ide2: `${isoStorage}:iso/${seedIsoFilename(vmid)},media=cdrom`,
        net0: `virtio,bridge=${host.bridge}`,
      });
      await proxmox.resizeDisk(vmid, "scsi0", `${workspace.diskGb}G`);
      const memoryGigabytes = Number((workspace.memoryMb / 1024).toFixed(1));
      await this.log(workspaceId, `Set ${workspace.cores} vCPU, ${memoryGigabytes} GB RAM, ${workspace.diskGb} GB disk`);

      await this.setStatus(workspaceId, "starting");
      await proxmox.startVm(vmid);
      await this.log(workspaceId, "Booting, waiting for IP");
      const ip = await waitForIp(proxmox, vmid);
      await workspaceRepository.update(workspaceId, { ip });
      await this.log(workspaceId, `IP ${ip}`);

      await this.setStatus(workspaceId, "installing_tools");
      const runRecorded = async (command: string) => {
        const result = await proxmox.runInGuest(vmid, ["bash", "-c", command]);
        await workspaceEventService.recordCommand(workspaceId, null, command, result);
        return result;
      };
      await runRecorded("cloud-init status --wait || true");
      for (const command of requiredSetupCommands) {
        const result = await runRecorded(command);
        if (result.exitCode !== 0) throw new Error(`Setup command failed: ${command}`);
      }
      if ((await runRecorded("usermod -aG docker dev")).exitCode !== 0) {
        await workspaceEventService.record(workspaceId, null, {
          type: "error",
          message: "Could not add dev to the docker group. Is Docker installed in the template?",
        });
      }
      for (const cli of workspace.agentClis) {
        const installCommand = agentCliInstallCommands[cli];
        if (!installCommand) continue;
        const result = await runRecorded(`sudo -iu dev bash -lc ${quoteForShell(installCommand)}`);
        if (result.exitCode !== 0) {
          await workspaceEventService.record(workspaceId, null, { type: "error", message: `Installing ${cli} failed` });
        }
      }

      await this.setStatus(workspaceId, "running");
      if (firstProjectRepoUrl) await this.addFirstProject(workspaceId, firstProjectRepoUrl);
    } catch (error) {
      if (await workspaceRepository.findById(workspaceId)) {
        await this.setStatus(workspaceId, "failed", toErrorMessage(error));
      }
    }
  }

  private async addFirstProject(workspaceId: string, repoUrl: string) {
    try {
      await projectService.add(workspaceId, { repoUrl });
    } catch (error) {
      if (!(error instanceof InvalidInputError)) throw error;
      await workspaceEventService.record(workspaceId, null, { type: "error", message: error.message });
    }
  }

  private async runDelete(workspaceId: string) {
    try {
      const workspace = await this.getRecord(workspaceId);
      await this.setStatus(workspaceId, "deleting");
      if (workspace.vmid !== null) await this.removeVm(workspace, workspace.vmid);
      await this.log(workspaceId, "Workspace deleted");
      await workspaceEventService.deleteForWorkspace(workspaceId);
      await projectRepository.deleteByWorkspace(workspaceId);
      await workspaceRepository.delete(workspaceId);
      projectService.clearQueue(workspaceId);
    } catch (error) {
      if (await workspaceRepository.findById(workspaceId)) {
        await this.setStatus(workspaceId, "failed", `Delete failed: ${toErrorMessage(error)}`);
      }
    }
  }

  private async removeVm(workspace: WorkspaceRecord, vmid: number) {
    const proxmox = await hostService.getProxmoxClient(workspace.hostId);
    // Proxmox reuses VM IDs, so only touch the VM and its seed ISO if the VM still carries this workspace's name.
    const vm = await proxmox.findVm(vmid);
    if (!vm) {
      await this.log(workspace.id, `VM ${vmid} does not exist; removing the workspace only`);
      return;
    }
    if (vm.name !== workspace.name) {
      await this.log(workspace.id, `VM ${vmid} now belongs to "${vm.name ?? "another VM"}"; leaving it and its seed ISO alone`);
      return;
    }
    await proxmox.stopVm(vmid).catch((error: unknown) => this.log(workspace.id, `Stop skipped: ${toErrorMessage(error)}`));
    await proxmox.destroyVm(vmid).catch(async (error: unknown) => {
      if (!toErrorMessage(error).includes("does not exist")) throw error;
      await this.log(workspace.id, `VM ${vmid} already gone: ${toErrorMessage(error)}`);
    });
    await proxmox
      .deleteVolume(isoStorage, `${isoStorage}:iso/${seedIsoFilename(vmid)}`)
      .catch((error: unknown) => this.log(workspace.id, `Seed ISO not removed: ${toErrorMessage(error)}`));
  }
}

export const workspaceService = new WorkspaceService();
