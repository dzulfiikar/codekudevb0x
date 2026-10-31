import { Agent, fetch, FormData } from "undici";
import { z } from "zod";

export type ProxmoxConnection = {
  baseUrl: string;
  tokenId: string;
  tokenSecret: string;
  node: string;
  allowSelfSigned: boolean;
};

export type CommandResult = { exitCode: number; stdout: string; stderr: string };

type RequestBody = Record<string, string | number | string[]> | FormData;

const taskStatusSchema = z.object({ status: z.string(), exitstatus: z.string().optional() });
const interfacesSchema = z.object({
  result: z.array(
    z.object({
      name: z.string(),
      "ip-addresses": z
        .array(z.object({ "ip-address": z.string(), "ip-address-type": z.string() }))
        .optional(),
    }),
  ),
});
const execStatusSchema = z.object({
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
const taskResultSchema = z.string().nullable().optional();

const selfSignedDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

export const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function apiRoot(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/api2/json") ? trimmed : `${trimmed}/api2/json`;
}

export function createProxmoxClient(connection: ProxmoxConnection) {
  const root = apiRoot(connection.baseUrl);
  const nodePath = `/nodes/${encodeURIComponent(connection.node)}`;
  const vmPath = (vmid: number) => `${nodePath}/qemu/${vmid}`;

  async function request<Schema extends z.ZodType>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    schema: Schema,
    body?: RequestBody,
    timeoutMs = 30_000,
  ): Promise<z.output<Schema>> {
    const headers: Record<string, string> = {
      Authorization: `PVEAPIToken=${connection.tokenId}=${connection.tokenSecret}`,
    };
    if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    const response = await fetch(`${root}${path}`, {
      method,
      headers,
      ...(body && { body: body instanceof FormData ? body : JSON.stringify(body) }),
      dispatcher: connection.allowSelfSigned ? selfSignedDispatcher : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      const details = z
        .object({ errors: z.record(z.string(), z.string()).optional(), message: z.string().optional() })
        .safeParse(safeJson(text));
      const fieldErrors = Object.entries(details.data?.errors ?? {}).map(([field, message]) => `${field}: ${message}`);
      const message = [response.statusText || `HTTP ${response.status}`, details.data?.message, ...fieldErrors]
        .filter(Boolean)
        .join("; ");
      throw new Error(`Proxmox ${method} ${path} failed: ${message.trim()}`);
    }
    return schema.parse(z.object({ data: z.unknown() }).parse(safeJson(text)).data);
  }

  async function waitForTask(upid: string, timeoutMs = 600_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const task = await request("GET", `${nodePath}/tasks/${encodeURIComponent(upid)}/status`, taskStatusSchema);
      if (task.status === "stopped") {
        if (task.exitstatus !== "OK") throw new Error(`Proxmox task failed: ${task.exitstatus ?? "unknown error"}`);
        return;
      }
      await wait(2000);
    }
    throw new Error(`Proxmox task did not finish within ${timeoutMs / 1000} s`);
  }

  // Some calls return a task ID only when they run asynchronously, so poll whenever one comes back.
  async function runTask(method: "POST" | "PUT" | "DELETE", path: string, body?: RequestBody, timeoutMs?: number) {
    const upid = await request(method, path, taskResultSchema, body, timeoutMs && Math.min(timeoutMs, 120_000));
    if (upid?.startsWith("UPID:")) await waitForTask(upid, timeoutMs);
  }

  return {
    getVersion: () => request("GET", "/version", z.object({ version: z.string() })).then((data) => data.version),
    listNodes: () =>
      request("GET", "/nodes", z.array(z.object({ node: z.string() }))).then((nodes) => nodes.map((entry) => entry.node)),
    listNodeStatuses: () => request("GET", "/nodes", nodeListSchema),
    findPermissions: (path: string) =>
      request("GET", `/access/permissions?path=${encodeURIComponent(path)}`, z.record(z.string(), z.record(z.string(), z.coerce.number()))).then(
        (permissions) => permissions[path] ?? {},
      ),
    listStorages: () => request("GET", `${nodePath}/storage`, storageListSchema),
    getBridge: (bridge: string) => request("GET", `${nodePath}/network/${encodeURIComponent(bridge)}`, bridgeSchema),
    nextVmid: () => request("GET", "/cluster/nextid", z.coerce.number().int()),

    async findImageStorage() {
      const storages = await request("GET", `${nodePath}/storage?content=images&enabled=1`, storageListSchema);
      return storages.find((storage) => storage.active !== 0)?.storage;
    },

    async findVm(vmid: number) {
      const vms = await request("GET", `${nodePath}/qemu`, vmListSchema);
      return vms.find((entry) => entry.vmid === vmid);
    },

    getVmConfig: (vmid: number) =>
      request("GET", `${vmPath(vmid)}/config`, z.record(z.string(), z.union([z.string(), z.number()]))),

    async findVmKind(vmid: number) {
      const vms = await request("GET", `${nodePath}/qemu`, vmListSchema);
      const vm = vms.find((entry) => entry.vmid === vmid);
      if (!vm) return "missing";
      return vm.template === 1 ? "template" : "vm";
    },

    async getStorageContentTypes(storage: string) {
      const config = await request(
        "GET",
        `/storage/${encodeURIComponent(storage)}`,
        z.object({ content: z.string(), digest: z.string().optional() }),
      );
      return { contentTypes: config.content.split(",").filter(Boolean), digest: config.digest };
    },

    setStorageContentTypes: (storage: string, contentTypes: string[], digest?: string) =>
      request("PUT", `/storage/${encodeURIComponent(storage)}`, z.unknown(), {
        content: contentTypes.join(","),
        ...(digest && { digest }),
      }),

    listStorageVolumes: (storage: string, content: string) =>
      request(
        "GET",
        `${nodePath}/storage/${encodeURIComponent(storage)}/content?content=${encodeURIComponent(content)}`,
        z.array(z.object({ volid: z.string() })),
      ).then((volumes) => volumes.map((volume) => volume.volid)),

    downloadUrl: (storage: string, options: { content: string; filename: string; url: string }) =>
      runTask("POST", `${nodePath}/storage/${encodeURIComponent(storage)}/download-url`, options, 30 * 60_000),

    uploadIso(storage: string, filename: string, file: Buffer) {
      // Proxmox requires text fields first and the file part last, under the field name "filename".
      const form = new FormData();
      form.append("content", "iso");
      form.append("filename", new Blob([new Uint8Array(file)]), filename);
      return runTask("POST", `${nodePath}/storage/${encodeURIComponent(storage)}/upload`, form, 120_000);
    },

    deleteVolume: (storage: string, volid: string) =>
      runTask("DELETE", `${nodePath}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volid)}`),

    createVm: (config: Record<string, string | number>) => runTask("POST", `${nodePath}/qemu`, config, 30 * 60_000),

    convertToTemplate: (vmid: number) => runTask("POST", `${vmPath(vmid)}/template`, {}),

    cloneVm: (templateVmid: number, newid: number, name: string) =>
      runTask("POST", `${vmPath(templateVmid)}/clone`, { newid, name, full: 0 }),

    configureVm: (vmid: number, config: Record<string, string | number>) =>
      runTask("POST", `${vmPath(vmid)}/config`, config),

    resizeDisk: (vmid: number, disk: string, size: string) =>
      runTask("PUT", `${vmPath(vmid)}/resize`, { disk, size }),

    startVm: (vmid: number) => runTask("POST", `${vmPath(vmid)}/status/start`, {}),
    stopVm: (vmid: number) => runTask("POST", `${vmPath(vmid)}/status/stop`, {}),
    destroyVm: (vmid: number) => runTask("DELETE", `${vmPath(vmid)}?purge=1&destroy-unreferenced-disks=1`),

    async findIpv4(vmid: number) {
      const interfaces = await request("GET", `${vmPath(vmid)}/agent/network-get-interfaces`, interfacesSchema);
      for (const networkInterface of interfaces.result) {
        if (!networkInterface.name.startsWith("e")) continue;
        for (const address of networkInterface["ip-addresses"] ?? []) {
          const ip = address["ip-address"];
          if (address["ip-address-type"] === "ipv4" && !ip.startsWith("127.") && !ip.startsWith("169.254.")) return ip;
        }
      }
      return undefined;
    },

    async execInGuest(vmid: number, command: string[], options: { input?: string; timeoutMs?: number } = {}) {
      const body: Record<string, string | string[]> = { command };
      if (options.input !== undefined) body["input-data"] = options.input;
      const { pid } = await request("POST", `${vmPath(vmid)}/agent/exec`, z.object({ pid: z.number() }), body);
      const deadline = Date.now() + (options.timeoutMs ?? 600_000);
      while (Date.now() < deadline) {
        const status = await request("GET", `${vmPath(vmid)}/agent/exec-status?pid=${pid}`, execStatusSchema);
        if (status.exited) {
          const stderr = status["err-data"] ?? "";
          if (status.exitcode === undefined) {
            const reason = status.signal === undefined ? "ended without an exit code" : `was killed by signal ${status.signal}`;
            return { exitCode: -1, stdout: status["out-data"] ?? "", stderr: `${stderr}\nProcess ${reason}`.trim() };
          }
          return { exitCode: status.exitcode, stdout: status["out-data"] ?? "", stderr } satisfies CommandResult;
        }
        await wait(2000);
      }
      throw new Error(`Command timed out after ${(options.timeoutMs ?? 600_000) / 1000} s`);
    },
  };
}

export type ProxmoxClient = ReturnType<typeof createProxmoxClient>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
