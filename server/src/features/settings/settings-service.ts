import { decrypt, encrypt } from "../../infrastructure/encryption.js";
import {
  type ClaudeCredentialKind,
  type ClaudeModel,
  getCredentialKind,
  listModels as listClaudeModels,
  testCredential as testClaudeCredential,
} from "../../integrations/claude/claude-client.js";
import { GeminiClient, type GemmaModel } from "../../integrations/gemini/gemini-client.js";
import type { AgentProvider } from "../../shared/api-types.js";
import { InvalidInputError, toErrorMessage } from "../../shared/errors.js";
import { defaultAgentPrompt, findUnknownPlaceholders } from "../projects/project-setup-instructions.js";
import { settingsRepository } from "./settings-repository.js";

type Settings = {
  agentProvider: AgentProvider;
  geminiApiKeySource: "database" | "none";
  geminiApiKeyHint: string | null;
  primaryModel: string;
  fallbackModel: string | null;
  availableModels: GemmaModel[];
  claudeCredentialKind: ClaudeCredentialKind | null;
  claudeCredentialHint: string | null;
  claudePrimaryModel: string;
  claudeFallbackModel: string | null;
  claudeAvailableModels: ClaudeModel[];
  agentPrompt: string;
  defaultAgentPrompt: string;
  isAgentPromptEdited: boolean;
};

type SettingsUpdate = {
  agentProvider?: AgentProvider;
  geminiApiKey?: string;
  primaryModel?: string;
  fallbackModel?: string | null;
  claudeCredential?: string;
  claudePrimaryModel?: string;
  claudeFallbackModel?: string | null;
  agentPrompt?: string | null;
};

type GeminiSettings = { apiKey: string | undefined; primaryModel: string; fallbackModel: string | null };
type ClaudeSettings = { credential: string | undefined; primaryModel: string; fallbackModel: string | null };

const defaultPrimaryModel = "gemma-4-26b-a4b-it";
const defaultFallbackModel = "gemma-4-31b-it";
const defaultModels: GemmaModel[] = [
  { id: "gemma-4-26b-a4b-it", displayName: "Gemma 4 26B A4B" },
  { id: "gemma-4-31b-it", displayName: "Gemma 4 31B" },
];
const defaultClaudePrimaryModel = "opus";
const defaultClaudeFallbackModel = "sonnet";
const defaultClaudeModels: ClaudeModel[] = [
  { id: "opus", displayName: "Opus 5.5", description: "Best for everyday, complex tasks" },
  { id: "sonnet", displayName: "Sonnet 5.5", description: "Efficient for routine tasks" },
  { id: "haiku", displayName: "Haiku 5.5", description: "Fastest for quick answers" },
];
const modelListCacheMilliseconds = 5 * 60_000;
const maxAgentPromptLength = 20_000;

function toSavedAgentPrompt(agentPrompt: string | null) {
  if (agentPrompt === null) return null;
  const template = agentPrompt.trim();
  if (!template) throw new InvalidInputError("The agent prompt cannot be empty. Use Reset to default instead.");
  if (template.length > maxAgentPromptLength) {
    throw new InvalidInputError(`The agent prompt can be at most ${maxAgentPromptLength.toLocaleString("en-US")} characters.`);
  }
  const [unknownPlaceholder] = findUnknownPlaceholders(template);
  if (unknownPlaceholder) {
    throw new InvalidInputError(`Unknown placeholder {${unknownPlaceholder}}. Use {projectName}, {projectPath}, {usedPorts} or {username}.`);
  }
  return template === defaultAgentPrompt ? null : template;
}

function checkModelsAvailable(models: (string | null | undefined)[], availableIds: string[]) {
  for (const model of models) {
    if (model && !availableIds.includes(model)) {
      throw new InvalidInputError(`Model ${model} is not available. Pick one of: ${availableIds.join(", ")}`);
    }
  }
}

class SettingsService {
  private readonly modelListCache = new Map<string, { expiresAt: number; models: GemmaModel[] }>();
  private readonly claudeModelListCache = new Map<string, { expiresAt: number; models: ClaudeModel[] }>();

  async findGeminiSettings(): Promise<GeminiSettings> {
    const record = await settingsRepository.find();
    return {
      apiKey: record?.geminiApiKey ? decrypt(record.geminiApiKey) : undefined,
      primaryModel: record?.primaryModel ?? defaultPrimaryModel,
      fallbackModel: record ? record.fallbackModel : defaultFallbackModel,
    };
  }

  async findClaudeSettings(): Promise<ClaudeSettings> {
    const record = await settingsRepository.find();
    return {
      credential: record?.claudeCredential ? decrypt(record.claudeCredential) : undefined,
      primaryModel: record?.claudePrimaryModel ?? defaultClaudePrimaryModel,
      fallbackModel: record ? record.claudeFallbackModel : defaultClaudeFallbackModel,
    };
  }

  async findAgentProvider(): Promise<AgentProvider> {
    return (await settingsRepository.find())?.agentProvider ?? "gemini";
  }

  async findSavedAgentPrompt() {
    return (await settingsRepository.find())?.agentPrompt ?? null;
  }

  async getAgentPrompt() {
    return (await this.findSavedAgentPrompt()) ?? defaultAgentPrompt;
  }

  async listAvailableModels(apiKey: string | undefined) {
    if (!apiKey) return defaultModels;
    const cached = this.modelListCache.get(apiKey);
    if (cached && cached.expiresAt > Date.now()) return cached.models;
    try {
      const models = await new GeminiClient(apiKey).listGemmaModels();
      const available = models.length ? models : defaultModels;
      this.modelListCache.set(apiKey, { expiresAt: Date.now() + modelListCacheMilliseconds, models: available });
      return available;
    } catch {
      return defaultModels;
    }
  }

  // Without a stored credential the SDK would fall back to the host's own Claude login, so never call it then.
  async listAvailableClaudeModels(credential: string | undefined) {
    if (!credential) return defaultClaudeModels;
    const cached = this.claudeModelListCache.get(credential);
    if (cached && cached.expiresAt > Date.now()) return cached.models;
    try {
      const { models } = await listClaudeModels(credential);
      const available = models.length ? models : defaultClaudeModels;
      this.claudeModelListCache.set(credential, { expiresAt: Date.now() + modelListCacheMilliseconds, models: available });
      return available;
    } catch {
      return defaultClaudeModels;
    }
  }

  async get(): Promise<Settings> {
    const [agentProvider, gemini, claude, savedAgentPrompt] = await Promise.all([
      this.findAgentProvider(),
      this.findGeminiSettings(),
      this.findClaudeSettings(),
      this.findSavedAgentPrompt(),
    ]);
    const [availableModels, claudeAvailableModels] = await Promise.all([
      this.listAvailableModels(gemini.apiKey),
      this.listAvailableClaudeModels(claude.credential),
    ]);
    return {
      agentProvider,
      geminiApiKeySource: gemini.apiKey ? "database" : "none",
      geminiApiKeyHint: gemini.apiKey ? `…${gemini.apiKey.slice(-4)}` : null,
      primaryModel: gemini.primaryModel,
      fallbackModel: gemini.fallbackModel,
      availableModels,
      claudeCredentialKind: claude.credential ? getCredentialKind(claude.credential) : null,
      claudeCredentialHint: claude.credential ? `…${claude.credential.slice(-4)}` : null,
      claudePrimaryModel: claude.primaryModel,
      claudeFallbackModel: claude.fallbackModel,
      claudeAvailableModels,
      agentPrompt: savedAgentPrompt ?? defaultAgentPrompt,
      defaultAgentPrompt,
      isAgentPromptEdited: savedAgentPrompt !== null,
    };
  }

  async save(update: SettingsUpdate) {
    if (update.claudeCredential) getCredentialKind(update.claudeCredential);
    const agentPrompt = update.agentPrompt === undefined ? undefined : toSavedAgentPrompt(update.agentPrompt);
    const [agentProvider, gemini, claude, savedAgentPrompt] = await Promise.all([
      this.findAgentProvider(),
      this.findGeminiSettings(),
      this.findClaudeSettings(),
      this.findSavedAgentPrompt(),
    ]);
    const geminiApiKey = update.geminiApiKey === undefined ? gemini.apiKey : update.geminiApiKey || undefined;
    const claudeCredential =
      update.claudeCredential === undefined ? claude.credential : update.claudeCredential || undefined;

    if (update.primaryModel !== undefined || update.fallbackModel) {
      const availableIds = (await this.listAvailableModels(geminiApiKey)).map((model) => model.id);
      checkModelsAvailable([update.primaryModel, update.fallbackModel], availableIds);
    }
    if (update.claudePrimaryModel !== undefined || update.claudeFallbackModel) {
      const availableIds = (await this.listAvailableClaudeModels(claudeCredential)).map((model) => model.id);
      checkModelsAvailable([update.claudePrimaryModel, update.claudeFallbackModel], availableIds);
    }
    const claudePrimaryModel = update.claudePrimaryModel ?? claude.primaryModel;
    const claudeFallbackModel =
      update.claudeFallbackModel === undefined ? claude.fallbackModel : update.claudeFallbackModel;
    if (claudePrimaryModel === claudeFallbackModel) {
      throw new InvalidInputError("The Claude fallback model must differ from the primary model.");
    }

    await settingsRepository.save({
      agentProvider: update.agentProvider ?? agentProvider,
      geminiApiKey: geminiApiKey ? encrypt(geminiApiKey) : null,
      primaryModel: update.primaryModel ?? gemini.primaryModel,
      fallbackModel: update.fallbackModel === undefined ? gemini.fallbackModel : update.fallbackModel,
      claudeCredential: claudeCredential ? encrypt(claudeCredential) : null,
      claudePrimaryModel,
      claudeFallbackModel,
      agentPrompt: agentPrompt === undefined ? savedAgentPrompt : agentPrompt,
    });
    return this.get();
  }

  async testGeminiApiKey(apiKey: string | undefined) {
    const keyToTest = apiKey ?? (await this.findGeminiSettings()).apiKey;
    if (!keyToTest) return { ok: false, message: "No Gemini API key is stored. Paste one to test it." } as const;
    try {
      return { ok: true, modelCount: (await new GeminiClient(keyToTest).listGemmaModels()).length } as const;
    } catch (error) {
      return { ok: false, message: toErrorMessage(error) } as const;
    }
  }

  async testClaudeCredential(credential: string | undefined) {
    const credentialToTest = credential ?? (await this.findClaudeSettings()).credential;
    if (!credentialToTest) return { ok: false, message: "No Claude credential is stored. Paste one to test it." } as const;
    return testClaudeCredential(credentialToTest);
  }
}

export const settingsService = new SettingsService();
