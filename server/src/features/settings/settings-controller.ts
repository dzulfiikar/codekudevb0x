import type { Request, Response } from "express";
import { z } from "zod";
import { optionalText } from "../../shared/validation.js";
import { settingsService } from "./settings-service.js";

const saveSettingsBody = z.object({
  geminiApiKey: z.string().trim().optional(),
  primaryModel: z.string().trim().min(1),
  fallbackModel: z.string().trim().min(1).nullable(),
});

const testGeminiApiKeyBody = z.object({
  geminiApiKey: optionalText,
});

class SettingsController {
  get = async (_request: Request, response: Response) => {
    response.json(await settingsService.get());
  };

  save = async (request: Request, response: Response) => {
    response.json(await settingsService.save(saveSettingsBody.parse(request.body)));
  };

  testGeminiApiKey = async (request: Request, response: Response) => {
    response.json(await settingsService.testGeminiApiKey(testGeminiApiKeyBody.parse(request.body ?? {}).geminiApiKey));
  };
}

export const settingsController = new SettingsController();
