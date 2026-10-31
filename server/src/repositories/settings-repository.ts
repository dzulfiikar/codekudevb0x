import { eq } from "drizzle-orm";
import { database } from "../infrastructure/database/client.js";
import { settings } from "../infrastructure/database/schema.js";

const settingsRowId = 1;

type SettingsValues = { geminiApiKey: string | null; primaryModel: string; fallbackModel: string | null };

class SettingsRepository {
  async find() {
    const [record] = await database.select().from(settings).where(eq(settings.id, settingsRowId));
    return record;
  }

  async save(values: SettingsValues) {
    await database
      .insert(settings)
      .values({ id: settingsRowId, ...values })
      .onConflictDoUpdate({ target: settings.id, set: values });
  }
}

export const settingsRepository = new SettingsRepository();
