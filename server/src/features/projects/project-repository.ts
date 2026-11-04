import { and, asc, eq, inArray } from "drizzle-orm";
import { database } from "../../infrastructure/database/client.js";
import { projects } from "../../infrastructure/database/schema.js";
import type { ProjectStatus } from "../../shared/api-types.js";

export type ProjectRecord = typeof projects.$inferSelect;

class ProjectRepository {
  async findById(projectId: string) {
    const [record] = await database.select().from(projects).where(eq(projects.id, projectId));
    return record;
  }

  async findByName(workspaceId: string, name: string) {
    const [record] = await database
      .select()
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.name, name)));
    return record;
  }

  listByWorkspace(workspaceId: string) {
    return database.select().from(projects).where(eq(projects.workspaceId, workspaceId)).orderBy(asc(projects.createdAt));
  }

  listByStatuses(statuses: ProjectStatus[]) {
    return database.select().from(projects).where(inArray(projects.status, statuses));
  }

  async create(values: typeof projects.$inferInsert) {
    const [record] = await database.insert(projects).values(values).returning();
    if (!record) throw new Error("Project insert returned no row");
    return record;
  }

  async update(projectId: string, changes: Partial<typeof projects.$inferInsert>) {
    await database.update(projects).set(changes).where(eq(projects.id, projectId));
  }

  async deleteByWorkspace(workspaceId: string) {
    await database.delete(projects).where(eq(projects.workspaceId, workspaceId));
  }
}

export const projectRepository = new ProjectRepository();
