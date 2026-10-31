# VM template guide

Every CodekuDevB0x workspace is a linked clone of one template VM on the Proxmox host. This guide covers what that template must look like and three ways to create it.

## What a template must be

- **Ubuntu 24.04 cloud image** (`noble-server-cloudimg-amd64`), which ships with cloud-init. The app configures each workspace with a NoCloud seed ISO.
- **No Proxmox cloud-init drive.** The app builds a seed ISO for each workspace (user `dev`, your SSH public key, qemu-guest-agent, Docker, git) and attaches it as `ide2`. If the template also has a Proxmox cloud-init drive (for example on `ide0`), the VM sees two cloud-init sources and cloud-init can pick the wrong one. If it does, your SSH key and the guest agent may never arrive.
- **Nothing else preinstalled.** The guest agent, user `dev`, Docker and git come from the app's seed ISO, and Node.js 22 and the agent CLIs are installed after boot. A plain cloud image is enough.
- **VM ID 9000 by default.** Any free VM ID works if you enter it as the template VM ID in the Add host form.
- **Kept in place.** Workspaces are linked clones (`full: 0`), so the template must stay on the host while any workspace uses it, and the VM disk storage must support linked clones (for example LVM-thin, ZFS, or qcow2 on a directory storage).

The app sets `cpu: host`, cores, memory, `net0` and the seed ISO on each workspace VM when it creates it, and resizes `scsi0` to the disk size you chose.

## Option A: automatic (recommended)

Open **Hosts** and click **Prepare host** on the host card. Through the Proxmox API, the app:

1. Enables the `import` and `iso` content types on storage `local` if they are missing.
2. Downloads `https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img` to `local:import/noble-server-cloudimg-amd64.qcow2`, unless that file already exists. The `.img` file is a qcow2 image, so the name is accurate.
3. Creates VM 9000 named `sandbox-ubuntu-2404`, importing the image as its `scsi0` disk with `import-from`.
4. Converts the VM to a template.

The host card shows each step. This usually takes a few minutes. If VM 9000 already exists and is a template, Prepare host marks the host ready without changing anything. If VM 9000 exists and is not a template, it stops with an error; remove that VM or pick another ID.

## Option B: the host's download is slow or blocked

At the Hack Day, the Proxmox host downloaded from cloud-images.ubuntu.com at about 100 KB/s. Prepare host skips the download if the image is already on storage `local`, so you can put it there yourself.

**Upload from your laptop.** Download the image and its checksum list:

```sh
curl -LO https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
curl -LO https://cloud-images.ubuntu.com/noble/current/SHA256SUMS
grep 'noble-server-cloudimg-amd64.img$' SHA256SUMS | shasum -a 256 -c
```

The last command must print `noble-server-cloudimg-amd64.img: OK`. On Linux, `sha256sum -c` works the same way.

Rename the file to `noble-server-cloudimg-amd64.qcow2`. In the Proxmox UI, select the node, then storage `local`, then **Import**, then **Upload**, and upload the renamed file. The name must be exactly `noble-server-cloudimg-amd64.qcow2`, because Prepare host looks for that name. If **Import** is not listed under `local`, enable the Import content type on that storage under Datacenter > Storage first.

**Or download from a nearer mirror.** On the same **Import** page, use **Download from URL** with a mirror of the Ubuntu cloud images, for example:

```
https://mirrors.tuna.tsinghua.edu.cn/ubuntu-cloud-images/noble/current/noble-server-cloudimg-amd64.img
```

Set the file name to `noble-server-cloudimg-amd64.qcow2`. To check the file against Ubuntu's official checksum, open Advanced, choose SHA-256, and paste the hash for `noble-server-cloudimg-amd64.img` from `https://cloud-images.ubuntu.com/noble/current/SHA256SUMS`.

Then click **Prepare host** in the app. It finds the file, skips the download and creates the template.

## Option C: by hand in the Proxmox shell

Run these in the node's shell (node > Shell in the Proxmox UI). They use the same settings as Prepare host. Replace `local-lvm` with your VM disk storage and `vmbr0` with your bridge if they differ.

```sh
# Put the image in local's import directory (or upload it as in Option B)
mkdir -p /var/lib/vz/import
wget -O /var/lib/vz/import/noble-server-cloudimg-amd64.qcow2 \
  https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img

qm create 9000 --name sandbox-ubuntu-2404 --ostype l26 --memory 2048 --cores 2 --cpu host \
  --scsihw virtio-scsi-single --net0 virtio,bridge=vmbr0 --agent enabled=1 \
  --serial0 socket --vga serial0
qm set 9000 --scsi0 local-lvm:0,import-from=local:import/noble-server-cloudimg-amd64.qcow2
qm set 9000 --boot order=scsi0
qm template 9000
```

Do not add a cloud-init drive (`--ide0 local-lvm:cloudinit` or similar). To check an existing template, run `qm config 9000 | grep cloudinit`; it should print nothing. Remove a cloud-init drive from a template with `qm set 9000 --delete ide0` (use the slot the grep showed).

## Check it

In the app, open **Hosts** and click **Run checks again** on the host card. The "VM template" check should be ok with "VM 9000 is a template". If it warns "does not exist yet", the template VM ID in the app does not match the VM you created. If it fails with "exists but is not a template", run `qm template <vmid>` or click Prepare host after removing that VM.
