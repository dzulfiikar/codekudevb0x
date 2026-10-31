import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express, { type ErrorRequestHandler } from "express";
import { hostsRouter } from "./routes/hosts.js";
import { settingsRouter } from "./routes/settings.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { createTables } from "./db/client.js";
import { failInterruptedHostPreparation } from "./hosts.js";
import { failInterruptedPipelines } from "./workspaces.js";

await createTables();
await failInterruptedHostPreparation();
await failInterruptedPipelines();

const app = express();
app.use(express.json());
app.use("/api/hosts", hostsRouter);
app.use("/api/workspaces", workspacesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api", (_request, response) => {
  response.status(404).json({ message: "Not found" });
});

const webDist = resolve(process.cwd(), "../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(resolve(webDist, "index.html"));
  });
}

const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  console.error(error instanceof Error ? error.message : "Unknown error");
  if (response.headersSent) return;
  const isBadJson = error instanceof SyntaxError;
  response
    .status(isBadJson ? 400 : 500)
    .json({ message: isBadJson ? "Request body is not valid JSON" : "Something went wrong on the server" });
};
app.use(handleError);

const port = Number(process.env.PORT ?? 8787);
const listenHost = process.env.HOST ?? "127.0.0.1";
app.listen(port, listenHost, () => {
  console.log(`Server listening on http://${listenHost}:${port}`);
});
