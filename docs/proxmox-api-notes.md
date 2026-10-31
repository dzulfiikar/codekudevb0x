# Proxmox VE 9 API notes

Checked on 2026-10-31 against the official API schema (`https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js`, cited as **schema**), the docs chapters, and the source on `git.proxmox.com` (HEAD) where the schema is silent. Source references use `repo:file:line`.

Base: `https://<host>/api2/json`, header `Authorization: PVEAPIToken=<user>@<realm>!<tokenname>=<secret>`. Responses are `{ data }`. Every privilege below is included in the Administrator role. With privilege separation on, a token's effective rights are the intersection of its own ACLs and its user's ACLs, so both need the role (confirmed against PVE 9.2: a token ACL alone gave no permissions).

## Request encoding

- `POST`/`PUT` bodies may be `application/json` or `application/x-www-form-urlencoded`. JSON is decoded with `decode_json`. Query parameters are merged into the body and win on conflicts. (pve-http-server:`src/PVE/APIServer/AnyEvent.pm:927-943`)
- Exception: `upload` must be `multipart/form-data` (see below).
- Calls that start a task return a UPID string. Poll `GET /nodes/{node}/tasks/{upid}/status` until `status` is `"stopped"`; success means `exitstatus === "OK"`. A token can read its own tasks without extra privileges; anything else needs `Sys.Audit` on `/nodes/{node}` (**schema**).

## Prepare host

| # | Call | Parameters | Privilege (**schema**) | Returns |
|---|---|---|---|---|
| 1 | `GET /storage/{storage}` | none | `Datastore.Allocate` on `/storage/{storage}` | object; `content` is a comma-separated string, e.g. `"iso,vztmpl,backup"` |
| 1 | `PUT /storage/{storage}` | `content` (format `pve-storage-content-list`, comma-separated), optional `digest` | `Datastore.Allocate` on `/storage` | object |
| 2 | `GET /nodes/{node}/storage/{storage}/content` | `content=import` (query) | `Datastore.Audit` or `Datastore.AllocateSpace` on `/storage/{storage}` | array of `{ volid, format, size, ... }` |
| 2 | `POST /nodes/{node}/storage/{storage}/download-url` | `content` (enum `iso`, `vztmpl`, `import`), `filename` (max 255), `url` (`https?://.*`), optional `checksum` + `checksum-algorithm`, `verify-certificates` (default 1), `compression` (iso only) | `Datastore.AllocateTemplate` on `/storage/{storage}`, **and** (`Sys.Audit`+`Sys.Modify` on `/`, or `Sys.AccessNetwork` on `/nodes/{node}`) | UPID |
| 3 | `POST /nodes/{node}/qemu` | see answer 2 | `VM.Allocate` on `/vms/{vmid}`; `Datastore.AllocateSpace` on the target storage; `SDN.Use` on the bridge | UPID |
| 4 | `POST /nodes/{node}/qemu/{vmid}/template` | optional `disk` | `VM.Allocate` on `/vms/{vmid}` | **UPID**, so poll it. The spec doesn't poll this call. |

Other checks for `POST /nodes/{node}/qemu`, all from the **schema**:
- `scsihw: "virtio-scsi-single"`, `ostype: "l26"`, `agent: "enabled=1"`, `serial0: "socket"`, `vga: "serial0"` and `boot: "order=scsi0"` are all valid values.
- `vga` takes `[type=]<enum>`, and the enum includes `serial0`.
- `net0: "virtio,bridge=vmbr0"` is valid.

## Workspace pipeline

| Call | Parameters | Privilege (**schema**) | Returns |
|---|---|---|---|
| `GET /cluster/nextid` | none | none (`user: all`) | string or int id |
| `POST /nodes/{node}/qemu/{vmid}/clone` | `newid` (int 100-999999999), `name` (`dns-name`), `full` (bool; templates default to a linked clone) | `VM.Clone` on `/vms/{vmid}` and `VM.Allocate` on `/vms/{newid}`; also `Datastore.AllocateSpace` on the storage and `SDN.Use` on the bridge | UPID |
| `POST /nodes/{node}/storage/{storage}/upload` | multipart, see answer 4 | `Datastore.AllocateTemplate` on `/storage/{storage}` | UPID |
| `POST /nodes/{node}/qemu/{vmid}/config` | `cores`, `memory`, `ide2: "local:iso/<file>.iso,media=cdrom"` (`media` enum `cdrom`/`disk`), `net0` | any of `VM.Config.*` on `/vms/{vmid}`. The ISO volume also needs `Datastore.AllocateSpace` or `Datastore.Audit` on its storage (pve-storage:`src/PVE/Storage.pm:632-638`) | optional UPID (async), so poll it if one is returned |
| `PUT /nodes/{node}/qemu/{vmid}/resize` | `disk` (enum, e.g. `scsi0`), `size` (pattern `\+?\d+(\.\d+)?[KMGT]?`; no `+` means absolute; shrinking is rejected) | `VM.Config.Disk` | **UPID**, so poll it |
| `POST .../status/start`, `POST .../status/stop` | none | `VM.PowerMgmt` | UPID |
| `GET .../agent/network-get-interfaces` | none | `VM.GuestAgent.Audit` **or** `VM.GuestAgent.Unrestricted` | `{ result: [...] }`; errors until the agent responds |
| `POST .../agent/exec`, `GET .../agent/exec-status` | see answer 5 | `VM.GuestAgent.Unrestricted` | `{ pid }`, then status object |
| `DELETE /nodes/{node}/qemu/{vmid}` | `purge` (bool), `destroy-unreferenced-disks` (bool, default 0) | `VM.Allocate` on `/vms/{vmid}` | UPID |
| `DELETE /nodes/{node}/storage/{storage}/content/{volume}` | see answer 6; optional `delay` (1-30 s) | `Datastore.Allocate` on the storage (**schema** description) | UPID, or `null` if `delay` is set and the task finished in time |
| `GET /version` | none | none (`user: all`) | `{ version, release, repoid }` |

## Answers

### 1. `download-url` with `content=import`, a `.qcow2` filename and a `.img` URL

**Yes.** Only `filename` is checked; the URL's extension is never looked at.
- `filename` is first normalized: everything up to the last `/` or `\` is dropped, and characters outside `[a-zA-Z0-9_.-]` become `_` (pve-storage:`src/PVE/Storage.pm:2478-2486`).
- It must then match `[a-zA-Z0-9\-.+=_]+\.(ova|qcow2|raw|vmdk)$`, otherwise the request fails with `filename: invalid filename or wrong extension` (pve-storage:`src/PVE/API2/Storage/Status.pm:847-852`, regexes at `src/PVE/Storage.pm:124-126`).
- After the download, the file is checked as an untrusted image of the format the extension names (`file_size_info($tmp, 10, 'qcow2', 1)`, `Status.pm:884-893`). Ubuntu's `noble-server-cloudimg-amd64.img` is qcow2, so `.qcow2` is the right extension.
- Using `.raw` for that file would fail this check.

Allowed extensions:
- `download-url` and `upload`, `content=import`: `ova`, `qcow2`, `raw`, `vmdk`.
- Files already in `import/` that are listed and used as volumes: also `ovf` (`IMPORT_EXT_RE_1`, `Storage.pm:122`).
- For comparison, `content=iso` allows `.iso` and `.img` (`Storage.pm:116`).

The storage must have the `import` content type enabled. The **storage chapter** lists `import` ("OVAs and VM disk images that can be imported from this storage") under the `import/` directory for directory storage. Spec step 1 already handles this.

### 2. `import-from` syntax and non-root tokens

**Syntax.** Pass the disk as `<targetStorage>:0,import-from=<source>`.
- Example: `scsi0: "local-lvm:0,import-from=local:import/noble-server-cloudimg-amd64.qcow2"`.
- Any size other than `0`, or a missing storage, fails with `'import-from' requires special syntax - use <storage ID>:0,import-from=<source>` (qemu-server:`src/PVE/API2/Qemu.pm:124-130`).
- **schema** (`scsi[n]` format): "Create a new disk, importing from this source (volume ID or absolute path)", with format `pve-volume-id-or-absolute-path`.
- The target storage must allow `images` content (`Qemu.pm:195-197`).

**Non-root tokens: allowed with a volume ID, not with a path.**
- The source volume type must be `images` or `import` (`Qemu.pm:207-218`). It is then checked with `check_volume_access` (`Qemu.pm:248-253`, pve-storage:`src/PVE/Storage.pm:619-663`):
  - `Datastore.Allocate` on `/storage/<sourceStorage>` is enough (Administrator has it).
  - For `import`, `iso` or `vztmpl` volumes, `Datastore.AllocateSpace` or `Datastore.Audit` is enough.
- **Absolute paths are rejected for anyone except `root@pam`**: "Only root can pass arbitrary filesystem paths." (`Storage.pm:657-659`). API tokens never count as `root@pam`, so always use the volume ID form `local:import/<file>.qcow2`.
- Separately, `Datastore.AllocateSpace` on the target storage is needed (**schema**, `POST /nodes/{node}/qemu`).

### 3. `PUT /storage/{storage}` `content`

**It replaces the list.** Each parameter you send overwrites the stored value (`$scfg->{$k} = $opts->{$k}`, pve-storage:`src/PVE/API2/Storage/Config.pm:389-391`). To add types, send the current list plus the new ones, e.g. `content=iso,vztmpl,backup,import`.
- Pass the `digest` from the `GET` to reject the update if the config changed in between.

### 4. Multipart fields for `POST /nodes/{node}/storage/{storage}/upload`

The HTTP server parses the stream itself (pve-http-server:`src/PVE/APIServer/AnyEvent.pm:1316-1330`). The GUI sends the same shape (pve-manager:`www/manager6/window/UploadToStorage.js:61-86`).
- Text fields come first. Only `content`, `checksum-algorithm` and `checksum` are read, in that order.
- The file part comes **last**, with field name **`filename`**. Its multipart `filename="..."` attribute becomes the stored file name.
- Any other file field name fails with `wrong field name '<x>' for file upload, expected 'filename'`.
- There is **no separate text field for the name**. In Node, use `form.append("content", "iso"); form.append("filename", new Blob([iso]), "workspace-123-seed.iso")`.
- The file part's headers must start with `Content-Disposition: form-data; name="filename"; filename="..."`. Node's `FormData` writes them in that order.
- The name is normalized like in answer 1. With `content=iso` it must end in `.iso` or `.img`, otherwise the upload fails with `filename: wrong file extension` (pve-storage:`src/PVE/API2/Storage/Status.pm:590-603`).
- The upload returns a UPID; poll it.

### 5. `agent/exec` body and `exec-status` response

**Request:** `POST /nodes/{node}/qemu/{vmid}/agent/exec`.
- `command`: array of strings, program then arguments (**schema**).
- `input-data`: optional string, max 65536 chars. Pass it as plain text; Proxmox base64-encodes it for the agent (qemu-server:`src/PVE/QemuServer/Agent.pm:125-135`).
- Send JSON: `{"command":["bash","-lc","..."],"input-data":"..."}`.
- With form encoding the array would be repeated keys (`command=bash&command=-lc&...`). That follows from the generic parser and isn't documented, so prefer JSON.
- Response: `{ pid: number }`.

**Status:** `GET .../agent/exec-status?pid=<pid>` returns (**schema**):
- `exited` (bool, always present)
- `exitcode` (int, only when the process ended normally)
- `signal` (int, when it ended abnormally)
- `out-data`, `err-data` (strings, already base64-decoded by Proxmox, `Agent.pm:153-170`)
- `out-truncated`, `err-truncated` (bool)

Missing fields are left out, not set to `null`.

### 6. `DELETE` path for a volume

`DELETE /nodes/{node}/storage/{storage}/content/{volume}`.
- `{volume}` may be the full volume ID (`local:iso/workspace-123-seed.iso`) or the part after the colon (`iso/workspace-123-seed.iso`). In the full form, the storage prefix must match `{storage}`, otherwise the call fails with `storage ID mismatch` (pve-storage:`src/PVE/API2/Storage/Content.pm:278-298`).
- The slash may be sent as is, because this route takes the rest of the URI as `{volume}` (`fragmentDelimiter => ''`, pve-storage:`src/PVE/API2/Storage/Status.pm:34-38`). The server URL-decodes the path before routing (`AnyEvent.pm:1452`), so `encodeURIComponent(volid)` also works.
- The call returns a UPID.

### 7. Guest agent exec privilege on PVE 9

**`VM.GuestAgent.Unrestricted`** on `/vms/{vmid}`, for both `agent/exec` and `agent/exec-status` (**schema**; registered in qemu-server:`src/PVE/API2/Qemu/Agent.pm:263`).
- `VM.Monitor` no longer appears in the privilege list in the **pveum chapter**.
- The read-only agent calls (`network-get-interfaces` and similar) accept `VM.GuestAgent.Audit` or `VM.GuestAgent.Unrestricted`.

## Not settled by the docs

- **Template endpoint.** `POST .../template` returns a UPID; the spec should poll it. `resize` also returns a UPID, and `config` POST may return one.
- **Multipart format.** Answer 4 comes from source code, not from the schema or docs. The schema only lists `content`, `filename`, `checksum`, `checksum-algorithm` and `tmpfilename`, and says nothing about multipart. Field order matters: text fields must come before the file part.
- **Content list format.** In answer 3, the `pve-storage-content-list` string is assumed to be comma-separated. The `GET` output and the docs examples use commas, but the schema doesn't define the separator.
- **Non-root tokens.** Answer 2 is read from source. I haven't tested it with an Administrator token. Both conditions it needs, a volume ID and `Datastore.Allocate` on the source storage, are met.
