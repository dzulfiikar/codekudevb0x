import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SeedOptions = { instanceId: string; hostname: string; sshPublicKey: string };

// JSON strings are valid YAML scalars, so JSON.stringify quotes user values safely.
function userData(sshPublicKey: string) {
  return `#cloud-config
users:
  - name: dev
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    groups: [sudo]
    ssh_authorized_keys:
      - ${JSON.stringify(sshPublicKey.trim())}
package_update: true
packages:
  - qemu-guest-agent
  - git
  - docker.io
  - docker-compose-v2
  - curl
  - ca-certificates
runcmd:
  - [systemctl, enable, --now, qemu-guest-agent]
`;
}

const networkConfig = `version: 2
ethernets:
  all:
    match:
      name: "e*"
    dhcp4: true
`;

export async function buildSeedIso(options: SeedOptions) {
  const directory = await mkdtemp(join(tmpdir(), "seed-"));
  const contentDirectory = join(directory, "content");
  const isoPath = join(directory, "seed.iso");
  try {
    await mkdir(contentDirectory);
    await writeFile(join(contentDirectory, "user-data"), userData(options.sshPublicKey));
    await writeFile(
      join(contentDirectory, "meta-data"),
      `instance-id: ${JSON.stringify(options.instanceId)}\nlocal-hostname: ${JSON.stringify(options.hostname)}\n`,
    );
    await writeFile(join(contentDirectory, "network-config"), networkConfig);
    if (process.platform === "darwin") {
      await execFileAsync("hdiutil", [
        "makehybrid",
        "-iso",
        "-joliet",
        "-default-volume-name",
        "cidata",
        "-o",
        isoPath,
        contentDirectory,
      ]);
    } else {
      await execFileAsync(
        "genisoimage",
        ["-output", isoPath, "-volid", "cidata", "-joliet", "-rock", "user-data", "meta-data", "network-config"],
        { cwd: contentDirectory },
      );
    }
    return await readFile(isoPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
