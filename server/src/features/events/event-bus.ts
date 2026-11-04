import { EventEmitter } from "node:events";
import type { Event } from "../../shared/api-types.js";

class EventBus {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  publish(workspaceId: string, event: Event) {
    this.emitter.emit(workspaceId, event);
  }

  subscribe(workspaceId: string, listener: (event: Event) => void) {
    this.emitter.on(workspaceId, listener);
    return () => {
      this.emitter.off(workspaceId, listener);
    };
  }
}

export const eventBus = new EventBus();
