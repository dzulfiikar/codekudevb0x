import { decrypt, encrypt } from "../../infrastructure/encryption.js";
import { ProxmoxClient, proxmoxClients, type ProxmoxConnection } from "../../integrations/proxmox/proxmox-client.js";
import { hostRepository, type HostRecord } from "./host-repository.js";
import { workspaceRepository } from "../workspaces/workspace-repository.js";
import type { Host, TemplateStatus } from "../../shared/api-types.js";
import { ConflictError, HostNotReadyError, InvalidInputError, NotFoundError, toErrorMessage } from "../../shared/errors.js";
import { checkHostReadiness, type HostCheckInput } from "./host-readiness-check.js";

type CreateHostInput = HostCheckInput & { name: string };

const imageStorage = "local";
const cloudImageFilename = "noble-server-cloudimg-amd64.qcow2";
const cloudImageUrl = "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img";

function toHostResponse(record: HostRecord): Host {
  return {
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl,
    tokenId: record.tokenId,
    node: record.node,
    templateVmid: record.templateVmid,
    bridge: record.bridge,
    vmStorage: record.vmStorage,
    allowSelfSigned: record.allowSelfSigned,
    version: record.version,
    templateStatus: record.templateStatus,
    templateMessage: record.templateMessage,
    lastCheck: record.lastCheck,
    createdAt: record.createdAt,
  };
}

async function detectHostDetails(connection: Omit<ProxmoxConnection, "node"> & { node?: string }, templateVmid: number) {
  const clusterClient = new ProxmoxClient({ ...connection, node: "" });
  const version = await clusterClient.getVersion();
  const node = connection.node ?? (await clusterClient.listNodeStatuses())[0]?.node;
  if (!node) throw new Error("This Proxmox host lists no nodes");
  const proxmox = new ProxmoxClient({ ...connection, node });
  const vmStorage = await proxmox.findImageStorage();
  if (!vmStorage) throw new Error(`Node ${node} has no active storage for VM disks`);
  const vmType = await proxmox.findVmType(templateVmid);
  const templateStatus: TemplateStatus = vmType === "template" ? "ready" : "missing";
  const templateMessage = vmType === "vm" ? `VM ${templateVmid} exists but is not a template` : null;
  return { version, node, vmStorage, templateStatus, templateMessage };
}

class HostService {
  async list() {
    return (await hostRepository.list()).map(toHostResponse);
  }

  findHostRecord(hostId: string) {
    return hostRepository.findById(hostId);
  }

  async getProxmoxClient(hostId: string) {
    const record = await hostRepository.findById(hostId);
    if (!record) throw new Error("Host was deleted");
    return proxmoxClients.forHost({ ...record, tokenSecret: decrypt(record.tokenSecret) });
  }

  checkUnsavedHost(input: HostCheckInput) {
    return checkHostReadiness(input);
  }

  async create(input: CreateHostInput) {
    const check = await checkHostReadiness(input);
    if (!check.ready) throw new HostNotReadyError(check);
    let details: Awaited<ReturnType<typeof detectHostDetails>>;
    try {
      details = await detectHostDetails(input, input.templateVmid);
    } catch (error) {
      throw new InvalidInputError(`Could not connect to Proxmox: ${toErrorMessage(error)}`);
    }
    const record = await hostRepository.create({
      ...input,
      ...details,
      id: crypto.randomUUID(),
      tokenSecret: encrypt(input.tokenSecret),
      lastCheck: check,
      createdAt: new Date().toISOString(),
    });
    return toHostResponse(record);
  }

  async delete(hostId: string) {
    const record = await this.getHostRecord(hostId);
    if (await workspaceRepository.hasWorkspacesOnHost(record.id)) {
      throw new ConflictError("Delete the workspaces on this host first");
    }
    await hostRepository.delete(record.id);
    proxmoxClients.forget(record.id);
  }

  async testConnection(hostId: string) {
    const record = await this.getHostRecord(hostId);
    try {
      const version = await (await this.getProxmoxClient(record.id)).getVersion();
      await hostRepository.update(record.id, { version });
      return { ok: true, version } as const;
    } catch (error) {
      return { ok: false, message: toErrorMessage(error) } as const;
    }
  }

  async checkSavedHost(hostId: string) {
    const record = await this.getHostRecord(hostId);
    const check = await checkHostReadiness({ ...record, tokenSecret: decrypt(record.tokenSecret) });
    await hostRepository.update(record.id, { lastCheck: check });
    return check;
  }

  async startTemplatePreparation(hostId: string) {
    const record = await this.getHostRecord(hostId);
    if (record.templateStatus === "preparing") throw new ConflictError("This host is already being prepared");
    await hostRepository.update(record.id, { templateStatus: "preparing", templateMessage: "Starting" });
    void this.prepareTemplate(record.id);
  }

  failInterruptedPreparation() {
    return hostRepository.failPreparingTemplates("Server restarted during setup");
  }

  private async getHostRecord(hostId: string) {
    const record = await hostRepository.findById(hostId);
    if (!record) throw new NotFoundError("Host not found");
    return record;
  }

  private async setTemplateStatus(hostId: string, templateStatus: TemplateStatus, templateMessage: string | null) {
    await hostRepository.update(hostId, { templateStatus, templateMessage });
  }

  private async prepareTemplate(hostId: string) {
    try {
      const record = await hostRepository.findById(hostId);
      if (!record) return;
      const proxmox = await this.getProxmoxClient(hostId);
      const vmid = record.templateVmid;

      await this.setTemplateStatus(hostId, "preparing", "Checking the VM");
      const vmType = await proxmox.findVmType(vmid);
      if (vmType === "template") {
        await this.setTemplateStatus(hostId, "ready", null);
        return;
      }
      if (vmType === "vm") {
        throw new Error(`VM ${vmid} already exists and is not a template. Remove it or pick another template VM ID.`);
      }

      await this.setTemplateStatus(hostId, "preparing", `Enabling ISO and import content on storage ${imageStorage}`);
      const { contentTypes, digest } = await proxmox.getStorageContentTypes(imageStorage);
      const missingTypes = ["import", "iso"].filter((type) => !contentTypes.includes(type));
      if (missingTypes.length) {
        await proxmox.setStorageContentTypes(imageStorage, [...contentTypes, ...missingTypes], digest);
      }

      const volumes = await proxmox.listStorageVolumes(imageStorage, "import");
      if (!volumes.includes(`${imageStorage}:import/${cloudImageFilename}`)) {
        await this.setTemplateStatus(hostId, "preparing", "Downloading Ubuntu 24.04 cloud image");
        await proxmox.downloadFromUrl(imageStorage, { content: "import", filename: cloudImageFilename, url: cloudImageUrl });
      }

      await this.setTemplateStatus(hostId, "preparing", `Creating VM ${vmid}`);
      await proxmox.createVm({
        vmid,
        name: "sandbox-ubuntu-2404",
        ostype: "l26",
        memory: 2048,
        cores: 2,
        cpu: "host",
        scsihw: "virtio-scsi-single",
        scsi0: `${record.vmStorage}:0,import-from=${imageStorage}:import/${cloudImageFilename}`,
        net0: `virtio,bridge=${record.bridge}`,
        agent: "enabled=1",
        serial0: "socket",
        vga: "serial0",
        boot: "order=scsi0",
      });

      await this.setTemplateStatus(hostId, "preparing", `Converting VM ${vmid} to a template`);
      await proxmox.convertToTemplate(vmid);
      await this.setTemplateStatus(hostId, "ready", null);
    } catch (error) {
      if (await hostRepository.findById(hostId)) await this.setTemplateStatus(hostId, "failed", toErrorMessage(error));
    }
  }
}

export const hostService = new HostService();
