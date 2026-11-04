import { Router } from "express";
import { settingsController } from "./settings-controller.js";

export const settingsRoutes = Router();

settingsRoutes.get("/", async (_request, response) => {
  response.json(await settingsController.get());
});

settingsRoutes.put("/", async (request, response) => {
  response.json(await settingsController.save(request.body));
});

settingsRoutes.post("/test", async (request, response) => {
  response.json(await settingsController.testApiKey(request.body));
});
