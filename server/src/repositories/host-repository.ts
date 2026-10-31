import { asc, eq } from "drizzle-orm";
import { database } from "../infrastructure/database/client.js";
import { hosts } from "../infrastructure/database/schema.js";

export type HostRecord = typeof hosts.$inferSelect;

class HostRepository {
  async findById(hostId: string) {
    const [record] = await database.select().from(hosts).where(eq(hosts.id, hostId));
    return record;
  }

  list() {
    return database.select().from(hosts).orderBy(asc(hosts.createdAt));
  }

  async create(values: typeof hosts.$inferInsert) {
    const [record] = await database.insert(hosts).values(values).returning();
    if (!record) throw new Error("Host insert returned no row");
    return record;
  }

  async update(hostId: string, changes: Partial<typeof hosts.$inferInsert>) {
    await database.update(hosts).set(changes).where(eq(hosts.id, hostId));
  }

  async delete(hostId: string) {
    await database.delete(hosts).where(eq(hosts.id, hostId));
  }

  async failPreparingTemplates(message: string) {
    await database
      .update(hosts)
      .set({ templateStatus: "failed", templateMessage: message })
      .where(eq(hosts.templateStatus, "preparing"));
  }
}

export const hostRepository = new HostRepository();
