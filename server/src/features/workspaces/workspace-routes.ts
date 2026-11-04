import { Router } from "express";
import { eventController } from "../events/event-controller.js";
import { projectController } from "../projects/project-controller.js";
import { workspaceController } from "./workspace-controller.js";

export const workspaceRoutes = Router();

workspaceRoutes.get("/", workspaceController.list);

workspaceRoutes.get("/:id", workspaceController.get);

workspaceRoutes.post("/", workspaceController.create);

workspaceRoutes.delete("/:id", workspaceController.delete);

workspaceRoutes.post("/:id/projects", projectController.create);

workspaceRoutes.get("/:id/events", eventController.stream);
