import { Router } from "express";
import { hostController } from "./host-controller.js";

export const hostRoutes = Router();

hostRoutes.get("/", hostController.list);

hostRoutes.post("/check", hostController.checkUnsavedHost);

hostRoutes.post("/", hostController.create);

hostRoutes.delete("/:id", hostController.delete);

hostRoutes.post("/:id/test", hostController.testConnection);

hostRoutes.post("/:id/check", hostController.checkSavedHost);

hostRoutes.post("/:id/prepare", hostController.startTemplatePreparation);
