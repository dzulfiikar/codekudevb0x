import type { Request, Response } from "express";
import { z } from "zod";
import { optionalText } from "../../shared/validation.js";
import { settingsService } from "./settings-service.js";

const modelId = z.string().trim().min(1);

const saveSettingsBody = z.object({
  agentProvider: z.enum(["gemini", "claude"]).optional(),
  geminiApiKey: z.string().trim().optional(),
  primaryModel: modelId.optional(),
  fallbackModel: modelId.nullable().optional(),
  claudeCredential: z.string().trim().optional(),
  claudePrimaryModel: modelId.optional(),
  claudeFallbackModel: modelId.nullable().optional(),
  agentPrompt: z.string().nullable().optional(),
});

const testGeminiApiKeyBody = z.object({
  geminiApiKey: optionalText,
});

const testClaudeCredentialBody = z.object({
  claudeCredential: optionalText,
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

  testClaudeCredential = async (request: Request, response: Response) => {
    response.json(
      await settingsService.testClaudeCredential(testClaudeCredentialBody.parse(request.body ?? {}).claudeCredential),
    );
  };
}

export const settingsController = new SettingsController();
