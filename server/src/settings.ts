import { GoogleGenAI } from "@google/genai";
import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { settings } from "./db/schema.js";
import { decrypt, encrypt } from "./secrets.js";

export type Settings = {
  geminiApiKeySource: "database" | "none";
  geminiApiKeyHint: string | null;
  primaryModel: string;
  fallbackModel: string | null;
  availableModels: { id: string; displayName: string }[];
};

export type GemmaSettings = { apiKey: string | undefined; primaryModel: string; fallbackModel: string | null };

const settingsId = 1;
const defaultPrimaryModel = "gemma-4-26b-a4b-it";
const defaultFallbackModel = "gemma-4-31b-it";
const defaultModels = [
  { id: "gemma-4-26b-a4b-it", displayName: "Gemma 4 26B A4B" },
  { id: "gemma-4-31b-it", displayName: "Gemma 4 31B" },
];
const modelCacheMs = 5 * 60_000;
const modelCache = new Map<string, { expiresAt: number; models: Settings["availableModels"] }>();

async function findSettingsRow() {
  const [row] = await db.select().from(settings).where(eq(settings.id, settingsId));
  return row;
}

export async function findGemmaSettings(): Promise<GemmaSettings> {
  const row = await findSettingsRow();
  return {
    apiKey: row?.geminiApiKey ? decrypt(row.geminiApiKey) : undefined,
    primaryModel: row?.primaryModel ?? defaultPrimaryModel,
    fallbackModel: row ? row.fallbackModel : defaultFallbackModel,
  };
}

export async function listGemmaModels(apiKey: string) {
  const ai = new GoogleGenAI({ apiKey });
  const models: Settings["availableModels"] = [];
  for await (const model of await ai.models.list({ config: { pageSize: 100 } })) {
    const id = model.name?.replace(/^models\//, "") ?? "";
    if (id.includes("gemma")) models.push({ id, displayName: model.displayName ?? id });
  }
  return models.toSorted((a, b) => a.id.localeCompare(b.id));
}

export async function findAvailableModels(apiKey: string | undefined) {
  if (!apiKey) return defaultModels;
  const cached = modelCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) return cached.models;
  try {
    const models = await listGemmaModels(apiKey);
    const available = models.length ? models : defaultModels;
    modelCache.set(apiKey, { expiresAt: Date.now() + modelCacheMs, models: available });
    return available;
  } catch {
    return defaultModels;
  }
}

export async function findSettings(): Promise<Settings> {
  const gemma = await findGemmaSettings();
  return {
    geminiApiKeySource: gemma.apiKey ? "database" : "none",
    geminiApiKeyHint: gemma.apiKey ? `…${gemma.apiKey.slice(-4)}` : null,
    primaryModel: gemma.primaryModel,
    fallbackModel: gemma.fallbackModel,
    availableModels: await findAvailableModels(gemma.apiKey),
  };
}

export async function saveSettings(update: {
  geminiApiKey?: string;
  primaryModel: string;
  fallbackModel: string | null;
}) {
  const row = await findSettingsRow();
  let geminiApiKey = row?.geminiApiKey ?? null;
  if (update.geminiApiKey !== undefined) geminiApiKey = update.geminiApiKey ? encrypt(update.geminiApiKey) : null;
  const values = { geminiApiKey, primaryModel: update.primaryModel, fallbackModel: update.fallbackModel };
  await db
    .insert(settings)
    .values({ id: settingsId, ...values })
    .onConflictDoUpdate({ target: settings.id, set: values });
}
