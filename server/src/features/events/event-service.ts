import { eventBus } from "./event-bus.js";
import { eventRepository } from "./event-repository.js";
import type { Event, EventBody } from "../../shared/api-types.js";
import type { CommandResult } from "../../shared/shell.js";

class WorkspaceEventService {
  async record(workspaceId: string, projectId: string | null, body: EventBody) {
    const event = await eventRepository.create(workspaceId, projectId, body);
    eventBus.publish(workspaceId, event);
    return event;
  }

  recordCommand(
    workspaceId: string,
    projectId: string | null,
    command: string,
    result: CommandResult,
  ) {
    return this.record(workspaceId, projectId, {
      type: "command",
      command,
      exitCode: result.exitCode,
      output: `${result.stdout}${result.stderr}`.slice(-4000),
    });
  }

  listAfter(workspaceId: string, afterId: number) {
    return eventRepository.listAfter(workspaceId, afterId);
  }

  subscribe(workspaceId: string, listener: (event: Event) => void) {
    return eventBus.subscribe(workspaceId, listener);
  }

  deleteForWorkspace(workspaceId: string) {
    return eventRepository.deleteByWorkspace(workspaceId);
  }
}

export const workspaceEventService = new WorkspaceEventService();
