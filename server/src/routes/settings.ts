import { Router } from "express";
import { z } from "zod";
import { errorMessage } from "../hosts.js";
import { findAvailableModels, findGemmaSettings, findSettings, listGemmaModels, saveSettings } from "../settings.js";

const saveSettingsBody = z.object({
  geminiApiKey: z.string().trim().optional(),
  primaryModel: z.string().trim().min(1),
  fallbackModel: z.string().trim().min(1).nullable(),
});

const testSettingsBody = z.object({
  geminiApiKey: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
});

export const settingsRouter = Router();

settingsRouter.get("/", async (_request, response) => {
  response.json(await findSettings());
});

settingsRouter.put("/", async (request, response) => {
  const body = saveSettingsBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ message: z.prettifyError(body.error) });
    return;
  }
  const apiKey =
    body.data.geminiApiKey === undefined
      ? (await findGemmaSettings()).apiKey
      : body.data.geminiApiKey || undefined;
  const availableIds = (await findAvailableModels(apiKey)).map((model) => model.id);
  for (const model of [body.data.primaryModel, body.data.fallbackModel]) {
    if (model !== null && !availableIds.includes(model)) {
      response.status(400).json({ message: `Model ${model} is not available. Pick one of: ${availableIds.join(", ")}` });
      return;
    }
  }
  await saveSettings(body.data);
  response.json(await findSettings());
});

settingsRouter.post("/test", async (request, response) => {
  const body = testSettingsBody.safeParse(request.body ?? {});
  if (!body.success) {
    response.status(400).json({ message: z.prettifyError(body.error) });
    return;
  }
  const apiKey = body.data.geminiApiKey ?? (await findGemmaSettings()).apiKey;
  if (!apiKey) {
    response.json({ ok: false, message: "No Gemini API key is stored. Paste one to test it." });
    return;
  }
  try {
    response.json({ ok: true, modelCount: (await listGemmaModels(apiKey)).length });
  } catch (error) {
    response.json({ ok: false, message: errorMessage(error) });
  }
});
