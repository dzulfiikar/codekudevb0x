# CodekuDevB0x: build spec

Local web app that turns a Proxmox host into on-demand sandbox VMs for working on GitHub projects.

## Outcome

1. Add a Proxmox host (API token) in the UI.
2. Create a **workspace**: the app clones a VM from an Ubuntu cloud-init template, creates user `dev` with the user's SSH public key, installs the chosen agent CLIs (Claude Code, Antigravity CLI).
3. Add **projects** (GitHub repos) to the workspace. Each is cloned into `/home/dev/projects/<project>`. A Gemma 4 agent (Gemini API) reads the repo and starts its services **in dev mode with hot reload**, on ports no other project in the VM uses.
4. The app checks every reported port and shows `http://<vm-ip>:<port>` links plus `ssh -A dev@<vm-ip>`.
5. The user SSHes in (or opens VS Code Remote-SSH), edits code or runs `claude`/`agy` in a project folder, and the dev server reloads on save. `git push` uses the user's own key through SSH agent forwarding.

## Glossary

| Term | Meaning |
|---|---|
| Host | A Proxmox node: API URL, API token, node name, template VM ID, bridge, VM disk storage, template status |
| Workspace | One VM. Owns the GitHub token (encrypted), SSH public key, VM size, agent CLI choice |
| Project | One GitHub repo inside a workspace VM at `/home/dev/projects/<project>`, with its own services |
| Service | A named port a project exposes, verified reachable by the server |
| Event | A log line for a workspace (VM steps) or a project (agent commands) |

Projects in one workspace are set up **one at a time** (a per-workspace queue) so the agent always knows which ports are taken.

## Stack and layout

- `server/`: Node 22+, TypeScript, Express 5, Zod, Drizzle ORM on PostgreSQL 17 (`pg`, `DATABASE_URL`), `@google/genai`, `undici` (per-host TLS dispatcher). Port `8787`.
- `server/src` is layered: `routes/` (Express, SSE) → `controllers/` (Zod input, no req/res) → `services/` (business rules, background jobs) → `repositories/` (the only database access), plus `integrations/` (Proxmox, Gemini, cloud-init ISO), `infrastructure/` (config, database, encryption, event bus, HTTP app) and `shared/` (API types, errors, helpers). Services throw `NotFoundError`/`ConflictError`/`InvalidInputError`; the HTTP app maps them to 404/409/400 `{ message }`.
- `web/`: Vite, React, TypeScript, Tailwind CSS v4. Dev proxy `/api` to `http://localhost:8787`.
- Two independent npm packages (no npm workspaces). Root `package.json` only has scripts:
  - `typecheck`: `npm --prefix server run typecheck && npm --prefix web run typecheck`
  - `lint`: `oxlint`
  - `e2e`: `npm --prefix server run e2e`
- `Dockerfile` (multi-stage: build web, build server, run server which serves `web/dist`), `docker-compose.yaml`: `db` (`postgres:17-alpine`, user/password/db `codeku`, named volume, `pg_isready` healthcheck, port `127.0.0.1:5433:5432` for local dev) and `app` (build `.`, `env_file: .env`, `DATABASE_URL` pointing at `db`, `HOST: 0.0.0.0`, port `127.0.0.1:8787:8787`, starts after `db` is healthy).
- `.env.example`: `APP_SECRET=` (32+ random bytes, base64), `DATABASE_URL=postgres://codeku:codeku@127.0.0.1:5433/codeku`, `PORT=8787`.

## API contract

```
POST   /api/hosts                    { name, baseUrl, tokenId, tokenSecret, node?, templateVmid=9000, bridge="vmbr0", allowSelfSigned=false }
                                     -> 201 Host. Calls GET /version first; 400 with a readable message if it fails.
                                        node omitted -> first entry of GET /nodes. vmStorage = first active storage on the node
                                        with content "images" (GET /nodes/{node}/storage?content=images&enabled=1).
                                        templateStatus = "ready" if VM templateVmid exists and is a template, else "missing".
GET    /api/hosts                    -> Host[]
DELETE /api/hosts/:id                -> 204 (refuse with 409 if workspaces still use it)
POST   /api/hosts/:id/test           -> { ok: true, version } | { ok: false, message }
POST   /api/hosts/:id/prepare        -> 202. Builds the template through the API (see "Prepare host"). Poll GET /api/hosts.

POST   /api/workspaces               { hostId, name, githubToken?, sshPublicKey, agentClis: ("claude"|"antigravity")[],
                                       cores=2, memoryMb=4096, diskGb=20, firstProjectRepoUrl? } -> 202 Workspace
GET    /api/workspaces               -> Workspace[]
GET    /api/workspaces/:id           -> Workspace
DELETE /api/workspaces/:id           -> 202 (stop + purge VM, then delete rows)
POST   /api/workspaces/:id/projects  { repoUrl, name? } -> 202 Project (status "queued")
GET    /api/workspaces/:id/events    -> text/event-stream. Replays stored events, then streams new ones. Each message: data: <Event JSON>
```

Types (shared shape; keep server and web copies in sync):

```ts
type Host = { id: string; name: string; baseUrl: string; tokenId: string; node: string; templateVmid: number;
  bridge: string; vmStorage: string; allowSelfSigned: boolean; version: string | null;
  templateStatus: "missing" | "preparing" | "ready" | "failed"; templateMessage: string | null; createdAt: string }

type WorkspaceStatus = "cloning_vm" | "configuring_vm" | "starting" | "installing_tools" | "running" | "failed" | "deleting"
type ProjectStatus = "queued" | "cloning_repo" | "configuring_services" | "verifying" | "ready" | "failed"

type Service = { name: string; port: number; url: string; reachable: boolean }
type Project = { id: string; workspaceId: string; name: string; repoUrl: string; status: ProjectStatus;
  services: Service[]; error: string | null; createdAt: string }
type Workspace = { id: string; hostId: string; name: string; vmid: number | null; ip: string | null;
  status: WorkspaceStatus; agentClis: string[]; cores: number; memoryMb: number; diskGb: number;
  hasGithubToken: boolean; error: string | null; projects: Project[]; createdAt: string }

type Event = { id: number; workspaceId: string; projectId: string | null; at: string } & (
  | { type: "status"; status: WorkspaceStatus | ProjectStatus }
  | { type: "log"; message: string }
  | { type: "agent"; message: string }
  | { type: "command"; command: string; exitCode: number; output: string }
  | { type: "services"; services: Service[] }
  | { type: "error"; message: string })
```

Secrets never leave the server: no `tokenSecret`, `githubToken` or decrypted values in any response or event.

## Network and host access

No scripts run on the Proxmox host; everything goes through the API. The host is reached at its Tailscale HTTPS name (for example `https://your-host.your-tailnet.ts.net`, port 443, valid certificate, API at `/api2/json`). VMs attach to the normal bridge (`vmbr0`) and get IPs from the home router by DHCP. The host already advertises its LAN subnet on Tailscale, so the laptop reaches VM LAN IPs directly.

API token: the user creates it in the Proxmox UI (Datacenter > Permissions > API Tokens, privilege separation off, user with the Administrator role) and pastes it into the Add host form.

## Prepare host (`POST /api/hosts/:id/prepare`, server)

Builds template `templateVmid` from the Ubuntu 24.04 cloud image, API only:

1. `GET /storage/local`; if its `content` lacks `import` or `iso`, `PUT /storage/local` with the content list plus those.
2. If `GET /nodes/{node}/storage/local/content?content=import` has no `noble-server-cloudimg-amd64.qcow2`, `POST /nodes/{node}/storage/local/download-url` `{ content: "import", filename: "noble-server-cloudimg-amd64.qcow2", url: "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img" }` (the .img is qcow2 inside) and poll the task.
3. `POST /nodes/{node}/qemu` `{ vmid, name: "sandbox-ubuntu-2404", ostype: "l26", memory: 2048, cores: 2, scsihw: "virtio-scsi-single", scsi0: "<vmStorage>:0,import-from=local:import/noble-server-cloudimg-amd64.qcow2", net0: "virtio,bridge=<bridge>", agent: "enabled=1", serial0: "socket", vga: "serial0", boot: "order=scsi0" }`, poll the task. No Proxmox cloud-init drive: workspaces bring their own seed ISO.
4. `POST /nodes/{node}/qemu/{vmid}/template`.

Update `templateStatus`/`templateMessage` as it goes ("Downloading Ubuntu 24.04 cloud image", "Creating VM 9000", ...). Check every request format against the Proxmox API viewer; if `download-url` rejects the filename or content type, report Proxmox's exact message in `templateMessage`.

## Workspace pipeline (server)

1. `cloning_vm`: `GET /cluster/nextid`, `POST /nodes/{node}/qemu/{templateVmid}/clone` `{ newid, name, full: 0 }`, poll `GET /nodes/{node}/tasks/{upid}/status` until `status=stopped`; fail unless `exitstatus=OK`.
2. `configuring_vm`: build a cloud-init NoCloud seed ISO (volume label `cidata`) with `user-data`, `meta-data` (`instance-id: workspace-<id>`, `local-hostname: <name>`) and `network-config` (v2, DHCP on every `e*` interface). Build it with `genisoimage -output seed.iso -volid cidata -joliet -rock user-data meta-data network-config` (install `genisoimage` in the Docker image); on macOS fall back to `hdiutil makehybrid -iso -joliet -default-volume-name cidata -o seed.iso <dir>`. Upload with `POST /nodes/{node}/storage/local/upload` (multipart: `content=iso`, `filename` = `workspace-<vmid>-seed.iso`). Then `POST /nodes/{node}/qemu/{vmid}/config` with `cores`, `memory`, `ide2=local:iso/workspace-<vmid>-seed.iso,media=cdrom`, `net0=virtio,bridge=<bridge>`, and `PUT .../resize` `{ disk: "scsi0", size: "<diskGb>G" }`.
   user-data (`#cloud-config`): user `dev` (shell bash, `sudo: ALL=(ALL) NOPASSWD:ALL`, `ssh_authorized_keys: [<sshPublicKey>]`), `package_update: true`, `packages: [qemu-guest-agent, git, docker.io, docker-compose-v2, curl, ca-certificates]`, `runcmd: [systemctl enable --now qemu-guest-agent]`.
3. `starting`: `POST .../status/start`, poll `GET .../agent/network-get-interfaces` every 5 s (it errors until cloud-init has installed the guest agent) until a non-loopback IPv4 appears. Timeout 300 s, error: "No IP after 5 min. Check the VM console in Proxmox for cloud-init errors."
4. `installing_tools` (guest exec, as root): `cloud-init status --wait`, `usermod -aG docker dev`, `install -d -o dev -g dev /home/dev/projects`, `ssh-keyscan github.com >> /home/dev/.ssh/known_hosts` (owned by dev), then for each chosen CLI as `dev`:
   - claude: `sudo -iu dev bash -lc 'curl -fsSL https://claude.ai/install.sh | bash'`
   - antigravity: `sudo -iu dev bash -lc 'curl -fsSL https://antigravity.google/cli/install.sh | bash'` (binary `agy`; confirm the URL on Google's page before relying on it)
   - ensure `~/.local/bin` is on `dev`'s PATH in `.bashrc`.
   A failed CLI install logs an error event but does not fail the workspace.
5. `running`. If `firstProjectRepoUrl` was given, enqueue it.

Delete: `POST .../status/stop` (ignore if already stopped), poll task, `DELETE /nodes/{node}/qemu/{vmid}?purge=1&destroy-unreferenced-disks=1`, then `DELETE /nodes/{node}/storage/local/content/local:iso/workspace-<vmid>-seed.iso`.

## Project pipeline (server, one at a time per workspace)

1. `cloning_repo`: validate `repoUrl` against `^https://github\.com/([\w.-]+)/([\w.-]+?)(\.git)?/?$`; project name from repo unless given, must match `^[a-z0-9][a-z0-9-]{0,39}$` and be unique in the workspace. Guest exec as root with the token on **stdin** (`input-data`), never in argv:
   `read -r TOKEN; sudo -u dev git clone "https://x-access-token:${TOKEN}@github.com/OWNER/REPO.git" /home/dev/projects/NAME && sudo -u dev git -C /home/dev/projects/NAME remote set-url origin git@github.com:OWNER/REPO.git`
   With no token, clone the plain https URL. Shell-quote every interpolated value.
2. `configuring_services`: the Gemma agent loop (below).
3. `verifying`: for each reported service, TCP connect to `ip:port` from the server, retry every 5 s for 60 s. If any fail, give the agent one more round with the failure, then verify again.
4. `ready` with services, or `failed` with an error message.

## Agent loop (`server/src/integrations/gemini/setup-agent.ts`, `gemini-client.ts`)

- `@google/genai`: `new GoogleGenAI({ apiKey })` with the key and models read from settings when the session starts, `ai.models.generateContent({ model, contents, config: { systemInstruction, tools: [{ functionDeclarations }] } })`, read `response.functionCalls`, append the model turn and a `functionResponse` part per call, loop.
- Tools:
  - `run_command({ command })`: guest exec `["bash", "-lc", command]` as root with cwd set via `cd /home/dev/projects/NAME &&`. Returns `{ exitCode, stdout, stderr }`, each truncated to the last 4000 chars. Per-command timeout 600 s (poll `agent/exec-status`).
  - `report_services({ services: [{ name, port }] })`: ends the loop.
- Cap 25 tool calls. Emit an `agent` event for model text, a `command` event per run_command.
- System instruction must state: Ubuntu 24.04, user `dev`, project path, Docker + Compose + git available, other runtimes must be installed by the agent (apt or official installers); run app processes **in dev/watch mode** (`npm run dev`, nodemon, vite, flask --debug, air, etc.) bound to `0.0.0.0`, as systemd units named `NAME-SERVICE.service` with `User=dev`, `WorkingDirectory=` the project path, `Restart=always`; databases and infrastructure may run with `docker compose` (publish to `0.0.0.0`); if the repo is compose-only, prefer `docker compose watch` or bind-mounted dev services; the list of ports already used in this VM (never use them); always end with `report_services`.
- If Gemma returns no function calls, nudge once ("Call a tool."), then fail.
- `scripts/smoke-gemma.ts`: reads the key and primary model from the settings table (`DATABASE_URL`), makes one call with one function declaration, prints `functionCalls`. If it is empty, switch the loop to JSON output parsed with Zod.

## Proxmox client (`server/src/integrations/proxmox/proxmox-client.ts`)

- Base `https://HOST:8006/api2/json`, header `Authorization: PVEAPIToken=<tokenId>=<secret>`.
- `allowSelfSigned` -> `new undici.Agent({ connect: { rejectUnauthorized: false } })` as `dispatcher` for that host only. Never set `NODE_TLS_REJECT_UNAUTHORIZED`.
- Response body is `{ data }`; throw an error with Proxmox's message on non-2xx.
- Guest exec: `POST /nodes/{node}/qemu/{vmid}/agent/exec` `{ command: string[], "input-data"?: string }` -> `{ pid }`; `GET .../agent/exec-status?pid=` -> `{ exited, exitcode, "out-data", "err-data" }`. Check the request encoding against the Proxmox API viewer; send JSON.

## Data (`server/src/infrastructure/database/schema.ts`)

`hosts` (token secret encrypted), `workspaces` (GitHub token encrypted, ssh public key, agent CLIs JSON), `projects` (services JSON), `events` (serial id, workspaceId, projectId nullable, type, payload JSON, at), `settings` (single row id 1: Gemini key encrypted, primary model, fallback model). JSON columns are `jsonb`. Tables are created at startup with `CREATE TABLE IF NOT EXISTS`. `infrastructure/encryption.ts`: AES-256-GCM with `APP_SECRET`, random 12-byte IV, stored as `iv.tag.ciphertext` base64.

## UI (variant B, see `design/b/*.png`)

Screens: Workspaces list (+ empty state), New workspace, Workspace detail (project cards, live agent log via SSE, Connect box with copyable `ssh -A dev@IP` and a VS Code link `vscode://vscode-remote/ssh-remote+dev@IP/home/dev/projects`), Add project dialog (Escape closes, focus returns to the trigger), Hosts (list + add form with connection error). Each host card shows its template status: "Template 9000 ready", or "Template 9000 missing" with a **Prepare host** button (POST /api/hosts/:id/prepare, then poll GET /api/hosts every 3 s while `preparing`, showing `templateMessage`), or the failure message with a Retry button. New workspace disables hosts whose template is not ready, with a hint to prepare them. The Add host form: name, API URL (placeholder `https://your-host.your-tailnet.ts.net`), token ID (`user@realm!token`), secret, node (optional, auto-detected), template VM ID (9000), bridge (vmbr0), and the self-signed checkbox (unchecked by default).

Tokens: bg `#141619`, surface `#1B1E22`, line `#2E3238` (inputs `#3A3F46`), text `#E7E4DD`, muted `#A0A6AD`, accent/up `#8FD694` (button text `#141619`), danger `#F08A7E`. Fonts: Atkinson Hyperlegible (UI), Source Code Pro (commands, ports, IDs). Radius 6 on panels and buttons, 4 on small controls.

Every data view has loading, empty and error states that name the cause and next action. Visible focus ring on every interactive element. No dead controls.

## Rules for contributors

- npm only. No `any`. Full-word names (`response`, not `res`). `find*` may return undefined, `get*` throws. Minimal comments.
- Do not run dev servers or builds. Run `npm run typecheck` and `npm run lint`.
- No unit tests. The only test is `npm run e2e` against a real host, which writes `e2e-report.json`.
- Never log or return secrets.

## Settings (config page)

Gemma settings live only in the database; nothing is read from `.env`. Until settings are saved, the models default to primary `gemma-4-26b-a4b-it` and fallback `gemma-4-31b-it`, and there is no key. With no stored key, a project's agent fails with "No Gemini API key. Add one on the Settings page."

```
GET  /api/settings          -> Settings
PUT  /api/settings          { geminiApiKey?: string, primaryModel: string, fallbackModel: string | null } -> Settings
                               geminiApiKey omitted = keep the stored key; "" = remove it (the agent then has no key).
                               Validates the models against the available list; 400 with a readable message otherwise.
POST /api/settings/test     { geminiApiKey?: string } -> { ok: true, modelCount: number } | { ok: false, message: string }
                               Tests the given key (or the stored one) by listing models.

Settings = {
  geminiApiKeySource: "database" | "none",
  geminiApiKeyHint: string | null,          // last 4 characters only, e.g. "…x7Qa"
  primaryModel: string,
  fallbackModel: string | null,
  availableModels: { id: string; displayName: string }[]
}
```

- `availableModels`: Gemini API `models.list` with the active key, filtered to ids containing `gemma`, sorted, cached 5 minutes. If there is no key or the call fails, return the two Gemma 4 ids (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`).
- The key is stored encrypted (same AES-256-GCM helper as tokens) and never returned.
- The agent reads settings when a project's agent session starts, so a change applies to the next project without a restart.

UI: a third nav item **Settings** at `/settings`. Sections: "Gemini API key" (password input, current source and hint, Test key button with result, Save, Remove stored key), "Models" (primary select and fallback select, fallback has a "None" option, both filled from `availableModels`), Save button with saved/error feedback. Loading, error and empty states as elsewhere.

## Host readiness check

Runs when a host is added and on demand. It answers "can this host run workspaces right now, and if not, what do I fix?".

```
POST /api/hosts/check        { baseUrl, tokenId, tokenSecret, node?, templateVmid?, bridge?, allowSelfSigned? } -> HostCheck
                               (nothing is saved; used by the Add host form before saving)
POST /api/hosts/:id/check    -> HostCheck (also stored on the host as lastCheck)
POST /api/hosts              runs the same check first. Any "fail" -> 400 { message, check: HostCheck }. Otherwise saves
                               the host with lastCheck.

HostCheck = {
  ready: boolean,               // true when no check is "fail"
  checkedAt: string,
  version: string | null,
  node: string | null,
  checks: { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; fix: string | null }[]
}
Host gains: lastCheck: HostCheck | null
```

Checks, in this order (each one is independent; a failure in one does not stop the others unless the API is unreachable):

| id | label | ok | warn | fail |
|---|---|---|---|---|
| `api` | Proxmox API reachable | `GET /version`, major 9 | major 8 | unreachable or 401 (fix: check URL, token ID and secret) |
| `permissions` | Token permissions | every privilege the app needs is present in `GET /access/permissions` on `/` (VM.Allocate, VM.Clone, VM.Config.CPU, VM.Config.Memory, VM.Config.Disk, VM.Config.Network, VM.Config.Options, VM.Config.CDROM, VM.PowerMgmt, VM.Audit, VM.GuestAgent.Audit, VM.GuestAgent.Unrestricted, Datastore.Allocate, Datastore.AllocateSpace, Datastore.AllocateTemplate, Datastore.Audit, Sys.Audit, Sys.Modify, SDN.Use) | | any missing: list them. Fix: "Give both the user and the token the Administrator role on / (with privilege separation on, the token only gets rights both have)." |
| `node` | Node online | node found and `status=online` | | not found / offline |
| `memory` | Free memory | free RAM >= 2 GB (show free / total) | < 2 GB (fix: stop a VM or use smaller workspaces) | |
| `vm-storage` | Storage for VM disks | a storage with `images` content, free >= 10 GB | < 10 GB free | none found |
| `iso-storage` | Storage `local` for images and seed ISOs | `local` active with `iso` and `import` content | `local` exists but lacks `iso`/`import` (fix: Prepare host enables them) | `local` missing |
| `bridge` | Network bridge | bridge exists on the node and is active (show its CIDR) | | missing (fix: name an existing bridge) |
| `template` | VM template | template VM exists and is a template | missing (fix: run Prepare host) | the VM ID exists but is not a template |
| `lan-reachable` | VM network reachable from this app | TCP connect from the app to the bridge's own IP on port 8006 within 3 s (the same path VM ports and SSH take) | not reachable (fix: "Share the host's LAN over Tailscale (subnet route) and turn on 'Use Tailscale subnets' on this machine, or run the app on the same LAN.") | |

UI (Hosts page): the Add host form gets a **Check host** button (secondary) next to the primary **Check and save host**. Results show as a checklist: one row per check with a status marker, label, detail and the fix when not ok. Saving with any fail is blocked, and the failing rows explain why. Each host card shows a one-line summary of its lastCheck ("Ready, checked 2 min ago" or "2 warnings") that expands to the checklist, plus a **Run checks again** button (POST /api/hosts/:id/check).
