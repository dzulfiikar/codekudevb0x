import { Agent, fetch, FormData } from "undici";
import { z } from "zod";
import type { CommandResult } from "../../shared/shell.js";
import { sleep } from "../../shared/sleep.js";

export type ProxmoxConnection = {
  baseUrl: string;
  tokenId: string;
  tokenSecret: string;
  node: string;
  allowSelfSigned: boolean;
};

type VmType = "missing" | "template" | "vm";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type RequestBody = Record<string, string | number | string[]> | FormData;

const taskStatusSchema = z.object({ status: z.string(), exitstatus: z.string().optional() });
const networkInterfacesSchema = z.object({
  result: z.array(
    z.object({
      name: z.string(),
      "ip-addresses": z
        .array(z.object({ "ip-address": z.string(), "ip-address-type": z.string() }))
        .optional(),
    }),
  ),
});
const commandStatusSchema = z.object({
  exited: z.union([z.boolean(), z.number()]).transform(Boolean),
  exitcode: z.number().optional(),
  signal: z.number().optional(),
  "out-data": z.string().optional(),
  "err-data": z.string().optional(),
});
const storageListSchema = z.array(
  z.object({
    storage: z.string(),
    active: z.coerce.number().optional(),
    enabled: z.coerce.number().optional(),
    content: z.string().optional(),
    avail: z.coerce.number().optional(),
    total: z.coerce.number().optional(),
  }),
);
const nodeListSchema = z.array(
  z.object({
    node: z.string(),
    status: z.string().optional(),
    mem: z.coerce.number().optional(),
    maxmem: z.coerce.number().optional(),
  }),
);
const bridgeSchema = z.object({
  active: z.coerce.number().optional(),
  cidr: z.string().optional(),
  address: z.string().optional(),
});
const vmListSchema = z.array(
  z.object({ vmid: z.coerce.number(), name: z.string().optional(), template: z.coerce.number().optional() }),
);
const taskIdSchema = z.string().nullable().optional();
const errorBodySchema = z.object({
  errors: z.record(z.string(), z.string()).optional(),
  message: z.string().optional(),
});

const selfSignedDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

function toApiRoot(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/api2/json") ? trimmed : `${trimmed}/api2/json`;
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class ProxmoxClient {
  private readonly apiRoot: string;
  private readonly nodePath: string;

  constructor(private readonly connection: ProxmoxConnection) {
    this.apiRoot = toApiRoot(connection.baseUrl);
    this.nodePath = `/nodes/${encodeURIComponent(connection.node)}`;
  }

  private vmPath(vmid: number) {
    return `${this.nodePath}/qemu/${vmid}`;
  }

  private storagePath(storage: string) {
    return `${this.nodePath}/storage/${encodeURIComponent(storage)}`;
  }

  private async request<Schema extends z.ZodType>(
    method: HttpMethod,
    path: string,
    schema: Schema,
    body?: RequestBody,
    timeoutMilliseconds = 30_000,
  ): Promise<z.output<Schema>> {
    const headers: Record<string, string> = {
      Authorization: `PVEAPIToken=${this.connection.tokenId}=${this.connection.tokenSecret}`,
    };
    if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    const response = await fetch(`${this.apiRoot}${path}`, {
      method,
      headers,
      ...(body && { body: body instanceof FormData ? body : JSON.stringify(body) }),
      dispatcher: this.connection.allowSelfSigned ? selfSignedDispatcher : undefined,
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
    const text = await response.text();
    if (!response.ok) {
      const details = errorBodySchema.safeParse(parseJsonOrUndefined(text));
      const fieldErrors = Object.entries(details.data?.errors ?? {}).map(([field, message]) => `${field}: ${message}`);
      const message = [response.statusText || `HTTP ${response.status}`, details.data?.message, ...fieldErrors]
        .filter(Boolean)
        .join("; ");
      throw new Error(`Proxmox ${method} ${path} failed: ${message.trim()}`);
    }
    return schema.parse(z.object({ data: z.unknown() }).parse(parseJsonOrUndefined(text)).data);
  }

  private async waitForTask(taskId: string, timeoutMilliseconds = 600_000) {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      const task = await this.request("GET", `${this.nodePath}/tasks/${encodeURIComponent(taskId)}/status`, taskStatusSchema);
      if (task.status === "stopped") {
        if (task.exitstatus !== "OK") throw new Error(`Proxmox task failed: ${task.exitstatus ?? "unknown error"}`);
        return;
      }
      await sleep(2000);
    }
    throw new Error(`Proxmox task did not finish within ${timeoutMilliseconds / 1000} s`);
  }

  // Some calls return a task ID only when they run asynchronously, so poll whenever one comes back.
  private async runProxmoxTask(method: Exclude<HttpMethod, "GET">, path: string, body?: RequestBody, timeoutMilliseconds?: number) {
    const requestTimeout = timeoutMilliseconds && Math.min(timeoutMilliseconds, 120_000);
    const taskId = await this.request(method, path, taskIdSchema, body, requestTimeout);
    if (taskId?.startsWith("UPID:")) await this.waitForTask(taskId, timeoutMilliseconds);
  }

  async getVersion() {
    const data = await this.request("GET", "/version", z.object({ version: z.string() }));
    return data.version;
  }

  listNodeStatuses() {
    return this.request("GET", "/nodes", nodeListSchema);
  }

  async findPermissions(path: string) {
    const permissionsByPath = await this.request(
      "GET",
      `/access/permissions?path=${encodeURIComponent(path)}`,
      z.record(z.string(), z.record(z.string(), z.coerce.number())),
    );
    return permissionsByPath[path] ?? {};
  }

  listStorages() {
    return this.request("GET", `${this.nodePath}/storage`, storageListSchema);
  }

  async findImageStorage() {
    const storages = await this.request("GET", `${this.nodePath}/storage?content=images&enabled=1`, storageListSchema);
    return storages.find((storage) => storage.active !== 0)?.storage;
  }

  getBridge(bridge: string) {
    return this.request("GET", `${this.nodePath}/network/${encodeURIComponent(bridge)}`, bridgeSchema);
  }

  getNextVmid() {
    return this.request("GET", "/cluster/nextid", z.coerce.number().int());
  }

  async findVm(vmid: number) {
    const vms = await this.request("GET", `${this.nodePath}/qemu`, vmListSchema);
    return vms.find((entry) => entry.vmid === vmid);
  }

  async findVmType(vmid: number): Promise<VmType> {
    const vm = await this.findVm(vmid);
    if (!vm) return "missing";
    return vm.template === 1 ? "template" : "vm";
  }

  getVmConfig(vmid: number) {
    return this.request("GET", `${this.vmPath(vmid)}/config`, z.record(z.string(), z.union([z.string(), z.number()])));
  }

  async getStorageContentTypes(storage: string) {
    const storageConfig = await this.request(
      "GET",
      `/storage/${encodeURIComponent(storage)}`,
      z.object({ content: z.string(), digest: z.string().optional() }),
    );
    return { contentTypes: storageConfig.content.split(",").filter(Boolean), digest: storageConfig.digest };
  }

  async setStorageContentTypes(storage: string, contentTypes: string[], digest?: string) {
    await this.request("PUT", `/storage/${encodeURIComponent(storage)}`, z.unknown(), {
      content: contentTypes.join(","),
      ...(digest && { digest }),
    });
  }

  async listStorageVolumes(storage: string, content: string) {
    const volumes = await this.request(
      "GET",
      `${this.storagePath(storage)}/content?content=${encodeURIComponent(content)}`,
      z.array(z.object({ volid: z.string() })),
    );
    return volumes.map((volume) => volume.volid);
  }

  downloadFromUrl(storage: string, options: { content: string; filename: string; url: string }) {
    return this.runProxmoxTask("POST", `${this.storagePath(storage)}/download-url`, options, 30 * 60_000);
  }

  uploadIso(storage: string, filename: string, file: Buffer) {
    // Proxmox requires text fields first and the file part last, under the field name "filename".
    const form = new FormData();
    form.append("content", "iso");
    form.append("filename", new Blob([new Uint8Array(file)]), filename);
    return this.runProxmoxTask("POST", `${this.storagePath(storage)}/upload`, form, 120_000);
  }

  deleteVolume(storage: string, volumeId: string) {
    return this.runProxmoxTask("DELETE", `${this.storagePath(storage)}/content/${encodeURIComponent(volumeId)}`);
  }

  createVm(vmConfig: Record<string, string | number>) {
    return this.runProxmoxTask("POST", `${this.nodePath}/qemu`, vmConfig, 30 * 60_000);
  }

  convertToTemplate(vmid: number) {
    return this.runProxmoxTask("POST", `${this.vmPath(vmid)}/template`, {});
  }

  cloneVm(templateVmid: number, newVmid: number, name: string) {
    return this.runProxmoxTask("POST", `${this.vmPath(templateVmid)}/clone`, { newid: newVmid, name, full: 0 });
  }

  configureVm(vmid: number, vmConfig: Record<string, string | number>) {
    return this.runProxmoxTask("POST", `${this.vmPath(vmid)}/config`, vmConfig);
  }

  resizeDisk(vmid: number, disk: string, size: string) {
    return this.runProxmoxTask("PUT", `${this.vmPath(vmid)}/resize`, { disk, size });
  }

  startVm(vmid: number) {
    return this.runProxmoxTask("POST", `${this.vmPath(vmid)}/status/start`, {});
  }

  stopVm(vmid: number) {
    return this.runProxmoxTask("POST", `${this.vmPath(vmid)}/status/stop`, {});
  }

  destroyVm(vmid: number) {
    return this.runProxmoxTask("DELETE", `${this.vmPath(vmid)}?purge=1&destroy-unreferenced-disks=1`);
  }

  async findIpv4(vmid: number) {
    const interfaces = await this.request("GET", `${this.vmPath(vmid)}/agent/network-get-interfaces`, networkInterfacesSchema);
    for (const networkInterface of interfaces.result) {
      if (!networkInterface.name.startsWith("e")) continue;
      for (const address of networkInterface["ip-addresses"] ?? []) {
        const ip = address["ip-address"];
        if (address["ip-address-type"] === "ipv4" && !ip.startsWith("127.") && !ip.startsWith("169.254.")) return ip;
      }
    }
    return undefined;
  }

  async runInGuest(
    vmid: number,
    command: string[],
    options: { input?: string; timeoutMilliseconds?: number } = {},
  ): Promise<CommandResult> {
    const timeoutMilliseconds = options.timeoutMilliseconds ?? 600_000;
    const body: Record<string, string | string[]> = { command };
    if (options.input !== undefined) body["input-data"] = options.input;
    const { pid } = await this.request("POST", `${this.vmPath(vmid)}/agent/exec`, z.object({ pid: z.number() }), body);
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      const status = await this.request("GET", `${this.vmPath(vmid)}/agent/exec-status?pid=${pid}`, commandStatusSchema);
      if (status.exited) {
        const stdout = status["out-data"] ?? "";
        const stderr = status["err-data"] ?? "";
        if (status.exitcode !== undefined) return { exitCode: status.exitcode, stdout, stderr };
        const reason = status.signal === undefined ? "ended without an exit code" : `was killed by signal ${status.signal}`;
        return { exitCode: -1, stdout, stderr: `${stderr}\nProcess ${reason}`.trim() };
      }
      await sleep(2000);
    }
    throw new Error(`Command timed out after ${timeoutMilliseconds / 1000} s`);
  }
}

class ProxmoxClientRegistry {
  private readonly clientsByHostId = new Map<string, ProxmoxClient>();

  forHost(host: { id: string } & ProxmoxConnection) {
    const existing = this.clientsByHostId.get(host.id);
    if (existing) return existing;
    const client = new ProxmoxClient(host);
    this.clientsByHostId.set(host.id, client);
    return client;
  }

  forget(hostId: string) {
    this.clientsByHostId.delete(hostId);
  }
}

export const proxmoxClients = new ProxmoxClientRegistry();
