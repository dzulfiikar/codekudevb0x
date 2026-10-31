import { ProxmoxClient, type ProxmoxConnection } from "../integrations/proxmox/proxmox-client.js";
import type { HostCheck, HostCheckItem } from "../shared/api-types.js";
import { toErrorMessage } from "../shared/errors.js";
import { isTcpPortOpen } from "../shared/network.js";

export type HostCheckInput = Omit<ProxmoxConnection, "node"> & {
  node?: string;
  templateVmid: number;
  bridge: string;
  vmStorage?: string;
};

// With privilege separation on, a token only gets the rights both it and its user have, so both need these on /.
const requiredPrivileges = [
  "VM.Allocate",
  "VM.Clone",
  "VM.Config.CPU",
  "VM.Config.Memory",
  "VM.Config.Disk",
  "VM.Config.Network",
  "VM.Config.Options",
  "VM.Config.CDROM",
  "VM.PowerMgmt",
  "VM.Audit",
  "VM.GuestAgent.Audit",
  "VM.GuestAgent.Unrestricted",
  "Datastore.Allocate",
  "Datastore.AllocateSpace",
  "Datastore.AllocateTemplate",
  "Datastore.Audit",
  "Sys.Audit",
  "Sys.Modify",
  "SDN.Use",
];

const labels: Record<string, string> = {
  api: "Proxmox API",
  permissions: "Token permissions",
  node: "Node",
  memory: "Free memory",
  "vm-storage": "VM storage",
  "iso-storage": "ISO storage",
  bridge: "Bridge",
  template: "Template",
  "lan-reachable": "LAN from this app",
};

const gigabyte = 1024 ** 3;
const formatGigabytes = (bytes: number) => (bytes / gigabyte).toFixed(1);

type CheckResult = Omit<HostCheckItem, "id" | "label">;

const ok = (detail: string): CheckResult => ({ status: "ok", detail, fix: null });
const warn = (detail: string, fix: string): CheckResult => ({ status: "warn", detail, fix });
const fail = (detail: string, fix: string | null = null): CheckResult => ({ status: "fail", detail, fix });

async function runCheck(id: string, check: () => Promise<CheckResult>): Promise<HostCheckItem> {
  try {
    return { id, label: labels[id] ?? id, ...(await check()) };
  } catch (error) {
    return { id, label: labels[id] ?? id, ...fail(toErrorMessage(error)) };
  }
}

function buildHostCheck(version: string | null, node: string | null, checks: HostCheckItem[]): HostCheck {
  return {
    ready: checks.every((check) => check.status !== "fail"),
    checkedAt: new Date().toISOString(),
    version,
    node,
    checks,
  };
}

async function findCloudInitDriveKey(proxmox: ProxmoxClient, vmid: number) {
  const config = await proxmox.getVmConfig(vmid);
  return Object.entries(config).find(
    ([key, value]) => /^(ide|sata|scsi)\d+$/.test(key) && String(value).includes("cloudinit"),
  )?.[0];
}

class HostReadinessService {
  async checkHost(options: HostCheckInput): Promise<HostCheck> {
    const clusterClient = new ProxmoxClient({ ...options, node: "" });
    let version: string | null = null;
    const api = await runCheck("api", async () => {
      version = await clusterClient.getVersion();
      const major = Number.parseInt(version, 10);
      if (major >= 9) return ok(version);
      if (major === 8) return warn(version, "Tested on Proxmox VE 9. Upgrade if something fails.");
      return fail(`${version}, too old`, "Upgrade to Proxmox VE 9.");
    });
    if (api.status === "fail" && version === null) {
      api.fix = "Check the API URL, token ID and secret.";
      const skipped = Object.keys(labels)
        .filter((id) => id !== "api")
        .map((id) => ({ id, label: labels[id] ?? id, ...fail("not checked") }));
      return buildHostCheck(null, options.node ?? null, [api, ...skipped]);
    }

    const nodes = await clusterClient.listNodeStatuses().catch(() => []);
    const nodeName = options.node ?? nodes[0]?.node ?? null;
    const nodeStatus = nodes.find((entry) => entry.node === nodeName);
    const proxmox = new ProxmoxClient({ ...options, node: nodeName ?? "" });
    const storages = proxmox.listStorages();
    const bridge = proxmox.getBridge(options.bridge);
    // Each check awaits these itself; this only stops an unhandled rejection before they do.
    storages.catch(() => undefined);
    bridge.catch(() => undefined);

    const checks = await Promise.all([
      runCheck("permissions", async () => {
        const privileges = await clusterClient.findPermissions("/");
        const missing = requiredPrivileges.filter((privilege) => !privileges[privilege]);
        if (!missing.length) return ok("all required");
        const missingList = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing.join("");
        return fail(
          `${missing.length} missing`,
          `Missing ${missingList}. Grant Administrator on / to the user and the token.`,
        );
      }),
      runCheck("node", async () => {
        if (!nodeStatus) return fail(`${nodeName ?? "node"} not found`, "Leave node empty to auto-detect it.");
        if (nodeStatus.status !== "online") return fail(`${nodeStatus.node} ${nodeStatus.status ?? "offline"}`, "Start the node.");
        return ok(`${nodeStatus.node} online`);
      }),
      runCheck("memory", async () => {
        if (nodeStatus?.mem === undefined || nodeStatus.maxmem === undefined) return fail("unknown");
        const free = nodeStatus.maxmem - nodeStatus.mem;
        const detail = `${formatGigabytes(free)} of ${formatGigabytes(nodeStatus.maxmem)} GB`;
        if (free >= 2 * gigabyte) return ok(detail);
        return warn(detail, "Stop a VM or use smaller workspaces.");
      }),
      runCheck("vm-storage", async () => {
        const candidates = (await storages).filter(
          (storage) => storage.active !== 0 && storage.content?.split(",").includes("images"),
        );
        const storage = candidates.find((entry) => entry.storage === options.vmStorage) ?? candidates[0];
        if (!storage) return fail("none found", "Enable Disk image content on a storage.");
        const detail = `${storage.storage}, ${formatGigabytes(storage.avail ?? 0)} GB free`;
        if ((storage.avail ?? 0) >= 10 * gigabyte) return ok(detail);
        return warn(detail, "Free up space or use smaller disks.");
      }),
      runCheck("iso-storage", async () => {
        const local = (await storages).find((storage) => storage.storage === "local");
        if (!local) return fail("local not found", "Workspaces need the default local storage.");
        const contentTypes = local.content?.split(",") ?? [];
        const missing = ["iso", "import"].filter((type) => !contentTypes.includes(type));
        if (local.active === 0) return warn("local inactive", "Activate storage local.");
        if (missing.length) return warn(`${missing.join(" + ")} off`, "Prepare host turns it on.");
        return ok("local, iso + import");
      }),
      runCheck("bridge", async () => {
        const found = await bridge.catch(() => undefined);
        if (!found) return fail(`${options.bridge} not found`, "Name an existing bridge, e.g. vmbr0.");
        if (found.active !== 1) return fail(`${options.bridge} inactive`, "Activate the bridge on the node.");
        return ok(options.bridge);
      }),
      runCheck("template", async () => {
        const vmType = await proxmox.findVmType(options.templateVmid);
        if (vmType === "template") {
          const driveKey = await findCloudInitDriveKey(proxmox, options.templateVmid);
          if (!driveKey) return ok(String(options.templateVmid));
          return fail(
            `Template ${options.templateVmid} has a Proxmox cloud-init drive on ${driveKey}`,
            "Remove that drive (Hardware, select CloudInit Drive, Remove), or run Prepare host with an unused VM ID. The app attaches its own cloud-init seed ISO, and two cloud-init sources conflict.",
          );
        }
        if (vmType === "missing") return warn(`${options.templateVmid} not found`, "Prepare host builds it.");
        return fail(`${options.templateVmid} is not a template`, "Pick another template VM ID or remove that VM.");
      }),
      runCheck("lan-reachable", async () => {
        const found = await bridge.catch(() => undefined);
        const ip = (found?.cidr ?? found?.address)?.split("/")[0];
        const fix = "Share the host's LAN over Tailscale or run the app on the same LAN.";
        if (!ip) return warn(`${options.bridge} has no IP`, fix);
        if (await isTcpPortOpen(ip, 8006, 3000)) return ok(`${ip} reachable`);
        return warn(`${ip} not reachable`, fix);
      }),
    ]);

    return buildHostCheck(version, nodeName, [api, ...checks]);
  }
}

export const hostReadinessService = new HostReadinessService();
