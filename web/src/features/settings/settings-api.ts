import { post, request } from "../../shared/api-client";
import type { GeminiApiKeyTestResult, Settings, SettingsInput } from "../../shared/api-types";

export const settingsApi = {
  get: () => request<Settings>("/settings"),
  save: (settings: SettingsInput) => request<Settings>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
  testGeminiApiKey: (geminiApiKey?: string) =>
    post<GeminiApiKeyTestResult>("/settings/test", geminiApiKey ? { geminiApiKey } : undefined),
};
