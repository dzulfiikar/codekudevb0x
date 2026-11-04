import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import { hostRoutes } from "../features/hosts/host-routes.js";
import { settingsRoutes } from "../features/settings/settings-routes.js";
import { workspaceRoutes } from "../features/workspaces/workspace-routes.js";
import { ConflictError, HostNotReadyError, InvalidInputError, NotFoundError } from "../shared/errors.js";

const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (response.headersSent) return;
  if (error instanceof HostNotReadyError) {
    response.status(400).json({ message: error.message, check: error.check });
  } else if (error instanceof InvalidInputError) {
    response.status(400).json({ message: error.message });
  } else if (error instanceof z.ZodError) {
    response.status(400).json({ message: z.prettifyError(error) });
  } else if (error instanceof SyntaxError) {
    response.status(400).json({ message: "Request body is not valid JSON" });
  } else if (error instanceof NotFoundError) {
    response.status(404).json({ message: error.message });
  } else if (error instanceof ConflictError) {
    response.status(409).json({ message: error.message });
  } else {
    console.error(error instanceof Error ? error.message : "Unknown error");
    response.status(500).json({ message: "Something went wrong on the server" });
  }
};

export function createHttpApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/hosts", hostRoutes);
  app.use("/api/workspaces", workspaceRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api", (_request, response) => {
    response.status(404).json({ message: "Not found" });
  });

  const webDistPath = resolve(process.cwd(), "../web/dist");
  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get("/{*path}", (_request, response) => {
      response.sendFile(resolve(webDistPath, "index.html"));
    });
  }

  app.use(handleError);
  return app;
}
