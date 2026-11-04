import type { Request, Response } from "express";
import type { Event } from "../../shared/api-types.js";
import { workspaceService } from "../workspaces/workspace-service.js";
import { eventService } from "./event-service.js";

class EventController {
  stream = async (request: Request<{ id: string }>, response: Response) => {
    const workspaceId = request.params.id;
    await workspaceService.get(workspaceId);
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
    const unsubscribe = eventService.subscribe(workspaceId, (event) =>
      bufferedEvents ? bufferedEvents.push(event) : send(event),
    );
    for (const event of await eventService.listAfter(workspaceId, lastSentId)) send(event);
    for (const event of bufferedEvents) send(event);
    bufferedEvents = undefined;
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20_000);
    request.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };
}

export const eventController = new EventController();
