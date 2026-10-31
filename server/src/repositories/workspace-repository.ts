import { desc, eq, inArray } from "drizzle-orm";
import { database } from "../infrastructure/database/client.js";
import { workspaces } from "../infrastructure/database/schema.js";
import type { WorkspaceStatus } from "../shared/api-types.js";

export type WorkspaceRecord = typeof workspaces.$inferSelect;

class WorkspaceRepository {
  async findById(workspaceId: string) {
    const [record] = await database.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    return record;
  }

  list() {
    return database.select().from(workspaces).orderBy(desc(workspaces.createdAt));
  }

  listByStatuses(statuses: WorkspaceStatus[]) {
    return database.select().from(workspaces).where(inArray(workspaces.status, statuses));
  }

  async hasWorkspacesOnHost(hostId: string) {
    const [record] = await database.select().from(workspaces).where(eq(workspaces.hostId, hostId)).limit(1);
    return record !== undefined;
  }

  async create(values: typeof workspaces.$inferInsert) {
    const [record] = await database.insert(workspaces).values(values).returning();
    if (!record) throw new Error("Workspace insert returned no row");
    return record;
  }

  async update(workspaceId: string, changes: Partial<typeof workspaces.$inferInsert>) {
    await database.update(workspaces).set(changes).where(eq(workspaces.id, workspaceId));
  }

  async delete(workspaceId: string) {
    await database.delete(workspaces).where(eq(workspaces.id, workspaceId));
  }
}

export const workspaceRepository = new WorkspaceRepository();
