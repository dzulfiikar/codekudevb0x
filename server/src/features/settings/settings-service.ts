import { decrypt, encrypt } from "../../infrastructure/encryption.js";
import { GeminiClient, type GemmaModel } from "../../integrations/gemini/gemini-client.js";
import { settingsRepository } from "./settings-repository.js";
import { InvalidInputError, toErrorMessage } from "../../shared/errors.js";

type Settings = {
  geminiApiKeySource: "database" | "none";
  geminiApiKeyHint: string | null;
  primaryModel: string;
  fallbackModel: string | null;
  availableModels: GemmaModel[];
};

type GeminiSettings = { apiKey: string | undefined; primaryModel: string; fallbackModel: string | null };

const defaultPrimaryModel = "gemma-4-26b-a4b-it";
const defaultFallbackModel = "gemma-4-31b-it";
const defaultModels: GemmaModel[] = [
  { id: "gemma-4-26b-a4b-it", displayName: "Gemma 4 26B A4B" },
  { id: "gemma-4-31b-it", displayName: "Gemma 4 31B" },
];
const modelListCacheMilliseconds = 5 * 60_000;

class SettingsService {
  private readonly modelListCache = new Map<string, { expiresAt: number; models: GemmaModel[] }>();

  async findGeminiSettings(): Promise<GeminiSettings> {
    const record = await settingsRepository.find();
    return {
      apiKey: record?.geminiApiKey ? decrypt(record.geminiApiKey) : undefined,
      primaryModel: record?.primaryModel ?? defaultPrimaryModel,
      fallbackModel: record ? record.fallbackModel : defaultFallbackModel,
    };
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

  async getSettings(): Promise<Settings> {
    const gemini = await this.findGeminiSettings();
    return {
      geminiApiKeySource: gemini.apiKey ? "database" : "none",
      geminiApiKeyHint: gemini.apiKey ? `…${gemini.apiKey.slice(-4)}` : null,
      primaryModel: gemini.primaryModel,
      fallbackModel: gemini.fallbackModel,
      availableModels: await this.listAvailableModels(gemini.apiKey),
    };
  }

  async saveSettings(input: { geminiApiKey?: string; primaryModel: string; fallbackModel: string | null }) {
    const activeApiKey =
      input.geminiApiKey === undefined ? (await this.findGeminiSettings()).apiKey : input.geminiApiKey || undefined;
    const availableIds = (await this.listAvailableModels(activeApiKey)).map((model) => model.id);
    for (const model of [input.primaryModel, input.fallbackModel]) {
      if (model !== null && !availableIds.includes(model)) {
        throw new InvalidInputError(`Model ${model} is not available. Pick one of: ${availableIds.join(", ")}`);
      }
    }

    const record = await settingsRepository.find();
    let geminiApiKey = record?.geminiApiKey ?? null;
    if (input.geminiApiKey !== undefined) geminiApiKey = input.geminiApiKey ? encrypt(input.geminiApiKey) : null;
    await settingsRepository.save({ geminiApiKey, primaryModel: input.primaryModel, fallbackModel: input.fallbackModel });
    return this.getSettings();
  }

  async testApiKey(apiKey: string | undefined) {
    const keyToTest = apiKey ?? (await this.findGeminiSettings()).apiKey;
    if (!keyToTest) return { ok: false, message: "No Gemini API key is stored. Paste one to test it." } as const;
    try {
      return { ok: true, modelCount: (await new GeminiClient(keyToTest).listGemmaModels()).length } as const;
    } catch (error) {
      return { ok: false, message: toErrorMessage(error) } as const;
    }
  }
}

export const settingsService = new SettingsService();
