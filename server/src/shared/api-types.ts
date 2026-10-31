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

export type HostCheckItem = {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix: string | null;
};

export type HostCheck = {
  ready: boolean;
  checkedAt: string;
  version: string | null;
  node: string | null;
  checks: HostCheckItem[];
};

export type TemplateStatus = "missing" | "preparing" | "ready" | "failed";

export type WorkspaceStatus =
  | "cloning_vm"
  | "configuring_vm"
  | "starting"
  | "installing_tools"
  | "running"
  | "failed"
  | "deleting";

export type ProjectStatus = "queued" | "cloning_repo" | "configuring_services" | "verifying" | "ready" | "failed";

export type Service = { name: string; port: number; url: string; reachable: boolean };

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

export type EventBody =
  | { type: "status"; status: WorkspaceStatus | ProjectStatus }
  | { type: "log"; message: string }
  | { type: "agent"; message: string }
  | { type: "command"; command: string; exitCode: number; output: string }
  | { type: "services"; services: Service[] }
  | { type: "error"; message: string };

export type Event = { id: number; workspaceId: string; projectId: string | null; at: string } & EventBody;
