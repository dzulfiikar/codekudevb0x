import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { hosts } from "./db/schema.js";
import { createProxmoxClient, type ProxmoxConnection } from "./proxmox.js";
import { decrypt } from "./secrets.js";
import type { Host, TemplateStatus } from "./types.js";

const imageStorage = "local";
const cloudImageFilename = "noble-server-cloudimg-amd64.qcow2";
const cloudImageUrl = "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img";

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function toHost(row: typeof hosts.$inferSelect): Host {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    tokenId: row.tokenId,
    node: row.node,
    templateVmid: row.templateVmid,
    bridge: row.bridge,
    vmStorage: row.vmStorage,
    allowSelfSigned: row.allowSelfSigned,
    version: row.version,
    templateStatus: row.templateStatus,
    templateMessage: row.templateMessage,
    lastCheck: row.lastCheck,
    createdAt: row.createdAt,
  };
}

export async function findHostRow(hostId: string) {
  const [row] = await db.select().from(hosts).where(eq(hosts.id, hostId));
  return row;
}

export async function getProxmoxClient(hostId: string) {
  const host = await findHostRow(hostId);
  if (!host) throw new Error("Host was deleted");
  return createProxmoxClient({ ...host, tokenSecret: decrypt(host.tokenSecret) });
}

export async function detectHostSettings(connection: Omit<ProxmoxConnection, "node"> & { node?: string }, templateVmid: number) {
  const version = await createProxmoxClient({ ...connection, node: "" }).getVersion();
  const node = connection.node ?? (await createProxmoxClient({ ...connection, node: "" }).listNodes())[0];
  if (!node) throw new Error("This Proxmox host lists no nodes");
  const proxmox = createProxmoxClient({ ...connection, node });
  const vmStorage = await proxmox.findImageStorage();
  if (!vmStorage) throw new Error(`Node ${node} has no active storage for VM disks`);
  const vmKind = await proxmox.findVmKind(templateVmid);
  const templateStatus: TemplateStatus = vmKind === "template" ? "ready" : "missing";
  const templateMessage = vmKind === "vm" ? `VM ${templateVmid} exists but is not a template` : null;
  return { version, node, vmStorage, templateStatus, templateMessage };
}

async function setTemplateStatus(hostId: string, templateStatus: TemplateStatus, templateMessage: string | null) {
  await db.update(hosts).set({ templateStatus, templateMessage }).where(eq(hosts.id, hostId));
}

export async function failInterruptedHostPreparation() {
  await db
    .update(hosts)
    .set({ templateStatus: "failed", templateMessage: "Server restarted during setup" })
    .where(eq(hosts.templateStatus, "preparing"));
}

export async function prepareHost(hostId: string) {
  try {
    const host = await findHostRow(hostId);
    if (!host) return;
    const proxmox = await getProxmoxClient(hostId);
    const vmid = host.templateVmid;

    await setTemplateStatus(hostId, "preparing", "Checking the VM");
    const vmKind = await proxmox.findVmKind(vmid);
    if (vmKind === "template") {
      await setTemplateStatus(hostId, "ready", null);
      return;
    }
    if (vmKind === "vm") throw new Error(`VM ${vmid} already exists and is not a template. Remove it or pick another template VM ID.`);

    await setTemplateStatus(hostId, "preparing", `Enabling ISO and import content on storage ${imageStorage}`);
    const { contentTypes, digest } = await proxmox.getStorageContentTypes(imageStorage);
    const missingTypes = ["import", "iso"].filter((type) => !contentTypes.includes(type));
    if (missingTypes.length) {
      await proxmox.setStorageContentTypes(imageStorage, [...contentTypes, ...missingTypes], digest);
    }

    const volumes = await proxmox.listStorageVolumes(imageStorage, "import");
    if (!volumes.includes(`${imageStorage}:import/${cloudImageFilename}`)) {
      await setTemplateStatus(hostId, "preparing", "Downloading Ubuntu 24.04 cloud image");
      await proxmox.downloadUrl(imageStorage, { content: "import", filename: cloudImageFilename, url: cloudImageUrl });
    }

    await setTemplateStatus(hostId, "preparing", `Creating VM ${vmid}`);
    await proxmox.createVm({
      vmid,
      name: "sandbox-ubuntu-2404",
      ostype: "l26",
      memory: 2048,
      cores: 2,
      cpu: "host",
      scsihw: "virtio-scsi-single",
      scsi0: `${host.vmStorage}:0,import-from=${imageStorage}:import/${cloudImageFilename}`,
      net0: `virtio,bridge=${host.bridge}`,
      agent: "enabled=1",
      serial0: "socket",
      vga: "serial0",
      boot: "order=scsi0",
    });

    await setTemplateStatus(hostId, "preparing", `Converting VM ${vmid} to a template`);
    await proxmox.convertToTemplate(vmid);
    await setTemplateStatus(hostId, "ready", null);
  } catch (error) {
    if (await findHostRow(hostId)) await setTemplateStatus(hostId, "failed", errorMessage(error));
  }
}
