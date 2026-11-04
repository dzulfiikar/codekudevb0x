import { z } from "zod";

export const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);
