import { z } from "zod";

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().min(1).default("127.0.0.1"),
  DATABASE_URL: z.string().min(1).default("postgres://codeku:codeku@127.0.0.1:5433/codeku"),
  APP_SECRET: z
    .string({ error: "APP_SECRET must be at least 32 random bytes, base64 encoded" })
    .refine((value) => Buffer.from(value, "base64").length >= 32, "APP_SECRET must be at least 32 random bytes, base64 encoded"),
});

const environment = environmentSchema.safeParse(process.env);
if (!environment.success) throw new Error(z.prettifyError(environment.error));

export const config = {
  port: environment.data.PORT,
  host: environment.data.HOST,
  databaseUrl: environment.data.DATABASE_URL,
  appSecret: Buffer.from(environment.data.APP_SECRET, "base64"),
};
