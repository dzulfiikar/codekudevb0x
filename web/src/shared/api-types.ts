export type Host = {
  id: string;
  name: string;
  baseUrl: string;
  tokenId: string;
  node: string;
  templateVmid: number;
  bridge: string;
  vmStorage: string;
  allowSelfSigned: boolean;
  version: string | null;
  templateStatus: TemplateStatus;
  templateMessage: string | null;
  lastCheck: HostCheck | null;
  createdAt: string;
};

export type CheckStatus = "ok" | "warn" | "fail";

export type HostCheck = {
  ready: boolean;
  checkedAt: string;
  version: string | null;
  node: string | null;
  checks: { id: string; label: string; status: CheckStatus; detail: string; fix: string | null }[];
};

type TemplateStatus = "missing" | "preparing" | "ready" | "failed";

export type WorkspaceStatus =
  | "cloning_vm"
  | "configuring_vm"
  | "starting"
  | "installing_tools"
  | "running"
  | "failed"
  | "deleting";
export type ProjectStatus = "queued" | "cloning_repo" | "configuring_services" | "verifying" | "ready" | "failed";

type Service = { name: string; port: number; url: string; reachable: boolean };
export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  status: ProjectStatus;
  services: Service[];
  error: string | null;
  createdAt: string;
};
export type Workspace = {
  id: string;
  hostId: string;
  name: string;
  vmid: number | null;
  ip: string | null;
  status: WorkspaceStatus;
  agentClis: string[];
  cores: number;
  memoryMb: number;
  diskGb: number;
  hasGithubToken: boolean;
  error: string | null;
  projects: Project[];
  createdAt: string;
};

export type Event = { id: number; workspaceId: string; projectId: string | null; at: string } & (
  | { type: "status"; status: WorkspaceStatus | ProjectStatus }
  | { type: "log"; message: string }
  | { type: "agent"; message: string }
  | { type: "command"; command: string; exitCode: number; output: string }
  | { type: "services"; services: Service[] }
  | { type: "error"; message: string }
);

export type AgentCli = "claude" | "antigravity";

export type NewHost = {
  name: string;
  baseUrl: string;
  tokenId: string;
  tokenSecret: string;
  node?: string;
  templateVmid?: number;
  bridge?: string;
  allowSelfSigned: boolean;
};

export type NewWorkspace = {
  hostId: string;
  name: string;
  githubToken?: string;
  sshPublicKey: string;
  agentClis: AgentCli[];
  cores: number;
  memoryMb: number;
  diskGb: number;
  firstProjectRepoUrl?: string;
};

export type HostTestResult = { ok: true; version: string } | { ok: false; message: string };

export type Settings = {
  geminiApiKeySource: "database" | "none";
  geminiApiKeyHint: string | null;
  primaryModel: string;
  fallbackModel: string | null;
  availableModels: { id: string; displayName: string }[];
};

export type SettingsUpdate = { geminiApiKey?: string; primaryModel: string; fallbackModel: string | null };

export type KeyTestResult = { ok: true; modelCount: number } | { ok: false; message: string };
