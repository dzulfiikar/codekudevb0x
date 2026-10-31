import { and, asc, eq, gt } from "drizzle-orm";
import { database } from "../infrastructure/database/client.js";
import { events } from "../infrastructure/database/schema.js";
import type { Event, EventBody } from "../shared/api-types.js";

class EventRepository {
  async create(workspaceId: string, projectId: string | null, body: EventBody): Promise<Event> {
    const at = new Date().toISOString();
    const [record] = await database
      .insert(events)
      .values({ workspaceId, projectId, type: body.type, payload: body, at })
      .returning({ id: events.id });
    if (!record) throw new Error("Event insert returned no row");
    return { ...body, id: record.id, workspaceId, projectId, at };
  }

  async listAfter(workspaceId: string, afterId: number): Promise<Event[]> {
    const records = await database
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, workspaceId), gt(events.id, afterId)))
      .orderBy(asc(events.id));
    return records.map((record) => ({
      ...record.payload,
      id: record.id,
      workspaceId: record.workspaceId,
      projectId: record.projectId,
      at: record.at,
    }));
  }

  async deleteByWorkspace(workspaceId: string) {
    await database.delete(events).where(eq(events.workspaceId, workspaceId));
  }
}

export const eventRepository = new EventRepository();
