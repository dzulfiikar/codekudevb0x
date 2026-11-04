import { z } from "zod";
import { settingsService } from "./settings-service.js";

const saveSettingsBody = z.object({
  geminiApiKey: z.string().trim().optional(),
  primaryModel: z.string().trim().min(1),
  fallbackModel: z.string().trim().min(1).nullable(),
});

const testApiKeyBody = z.object({
  geminiApiKey: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
});

class SettingsController {
  get() {
    return settingsService.getSettings();
  }

  save(body: unknown) {
    return settingsService.saveSettings(saveSettingsBody.parse(body));
  }

  testApiKey(body: unknown) {
    return settingsService.testApiKey(testApiKeyBody.parse(body ?? {}).geminiApiKey);
  }
}

export const settingsController = new SettingsController();
