import { Router } from "express";
import { settingsController } from "./settings-controller.js";

export const settingsRoutes = Router();

settingsRoutes.get("/", settingsController.get);

settingsRoutes.put("/", settingsController.save);

settingsRoutes.post("/test", settingsController.testGeminiApiKey);

settingsRoutes.post("/test-claude", settingsController.testClaudeCredential);
