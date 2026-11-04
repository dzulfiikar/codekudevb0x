import type { HostCheckItem } from "../../../server/src/shared/api-types";

export type {
  Event,
  Host,
  HostCheck,
  HostCheckItem,
  Project,
  ProjectStatus,
  Service,
  TemplateStatus,
  Workspace,
  WorkspaceStatus,
} from "../../../server/src/shared/api-types";

export type CheckStatus = HostCheckItem["status"];

export type AgentCli = "claude" | "antigravity";

export type CreateHostInput = {
  name: string;
  baseUrl: string;
  tokenId: string;
  tokenSecret: string;
  node?: string;
  templateVmid?: number;
  bridge?: string;
  allowSelfSigned: boolean;
};

export type CreateWorkspaceInput = {
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

export type ConnectionTestResult = { ok: true; version: string } | { ok: false; message: string };

export type Settings = {
  geminiApiKeySource: "database" | "none";
  geminiApiKeyHint: string | null;
  primaryModel: string;
  fallbackModel: string | null;
  availableModels: { id: string; displayName: string }[];
};

export type SettingsInput = { geminiApiKey?: string; primaryModel: string; fallbackModel: string | null };

export type GeminiApiKeyTestResult = { ok: true; modelCount: number } | { ok: false; message: string };
