import { Router } from "express";
import { hostController } from "./host-controller.js";

export const hostRoutes = Router();

hostRoutes.get("/", async (_request, response) => {
  response.json(await hostController.list());
});

hostRoutes.post("/check", async (request, response) => {
  response.json(await hostController.checkUnsavedHost(request.body));
});

hostRoutes.post("/", async (request, response) => {
  response.status(201).json(await hostController.add(request.body));
});

hostRoutes.delete("/:id", async (request, response) => {
  await hostController.remove(request.params.id);
  response.status(204).end();
});

hostRoutes.post("/:id/test", async (request, response) => {
  response.json(await hostController.testConnection(request.params.id));
});

hostRoutes.post("/:id/check", async (request, response) => {
  response.json(await hostController.checkSavedHost(request.params.id));
});

hostRoutes.post("/:id/prepare", async (request, response) => {
  await hostController.startTemplatePreparation(request.params.id);
  response.status(202).end();
});
