import { Router } from "express";
import { projectController } from "../projects/project-controller.js";
import { workspaceController } from "./workspace-controller.js";
import type { Event } from "../../shared/api-types.js";

export const workspaceRoutes = Router();

workspaceRoutes.get("/", async (_request, response) => {
  response.json(await workspaceController.list());
});

workspaceRoutes.get("/:id", async (request, response) => {
  response.json(await workspaceController.get(request.params.id));
});

workspaceRoutes.post("/", async (request, response) => {
  response.status(202).json(await workspaceController.create(request.body));
});

workspaceRoutes.delete("/:id", async (request, response) => {
  await workspaceController.remove(request.params.id);
  response.status(202).end();
});

workspaceRoutes.post("/:id/projects", async (request, response) => {
  response.status(202).json(await projectController.add(request.params.id, request.body));
});

workspaceRoutes.get("/:id/events", async (request, response) => {
  const workspaceId = request.params.id;
  await workspaceController.get(workspaceId);
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  response.flushHeaders();

  let lastSentId = Number(request.header("Last-Event-ID") ?? 0) || 0;
  const send = (event: Event) => {
    if (event.id <= lastSentId) return;
    lastSentId = event.id;
    response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  // Subscribe before the replay query so no event falls between the two; buffered ones go out after the replay.
  let bufferedEvents: Event[] | undefined = [];
  const unsubscribe = workspaceController.subscribeToEvents(workspaceId, (event) =>
    bufferedEvents ? bufferedEvents.push(event) : send(event),
  );
  for (const event of await workspaceController.listEventsAfter(workspaceId, lastSentId)) send(event);
  for (const event of bufferedEvents) send(event);
  bufferedEvents = undefined;
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20_000);
  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
