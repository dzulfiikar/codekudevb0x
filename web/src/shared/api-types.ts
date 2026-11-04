import type { AgentProvider, HostCheckItem } from "../../../server/src/shared/api-types";

export type {
  AgentProvider,
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
  username?: string;
  sshPublicKey?: string;
  password?: string;
  agentClis: AgentCli[];
  cores: number;
  memoryMb: number;
  diskGb: number;
  firstProjectRepoUrl?: string;
};

export type ConnectionTestResult = { ok: true; version: string } | { ok: false; message: string };

export type ClaudeCredentialKind = "plan_token" | "api_key";

export type ClaudeModel = { id: string; displayName: string; description: string };

export type Settings = {
  agentProvider: AgentProvider;
  geminiApiKeySource: "database" | "none";
  geminiApiKeyHint: string | null;
  primaryModel: string;
  fallbackModel: string | null;
  availableModels: { id: string; displayName: string }[];
  claudeCredentialKind: ClaudeCredentialKind | null;
  claudeCredentialHint: string | null;
  claudePrimaryModel: string;
  claudeFallbackModel: string | null;
  claudeAvailableModels: ClaudeModel[];
  agentPrompt: string;
  defaultAgentPrompt: string;
  isAgentPromptEdited: boolean;
};

export type SettingsInput = {
  agentProvider?: AgentProvider;
  geminiApiKey?: string;
  primaryModel?: string;
  fallbackModel?: string | null;
  claudeCredential?: string;
  claudePrimaryModel?: string;
  claudeFallbackModel?: string | null;
  agentPrompt?: string | null;
};

export type GeminiApiKeyTestResult = { ok: true; modelCount: number } | { ok: false; message: string };

export type ClaudeCredentialTestResult =
  | { ok: true; modelCount: number; subscriptionType: string | null; credentialKind: ClaudeCredentialKind }
  | { ok: false; message: string };
