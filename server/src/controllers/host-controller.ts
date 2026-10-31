import { z } from "zod";
import { hostService } from "../services/host-service.js";

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const newHostBody = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.url({ protocol: /^https?$/ }),
  tokenId: z.string().trim().regex(/^[^@\s]+@[^!\s]+![^\s]+$/, "Token ID looks like user@realm!tokenname"),
  tokenSecret: z.string().trim().min(1),
  node: optionalText,
  templateVmid: z.coerce.number().int().min(100).default(9000),
  bridge: z.string().trim().min(1).default("vmbr0"),
  allowSelfSigned: z.boolean().default(false),
});

const hostCheckBody = newHostBody.omit({ name: true });

class HostController {
  list() {
    return hostService.list();
  }

  add(body: unknown) {
    return hostService.add(newHostBody.parse(body));
  }

  checkUnsavedHost(body: unknown) {
    return hostService.checkUnsavedHost(hostCheckBody.parse(body));
  }

  remove(hostId: string) {
    return hostService.remove(hostId);
  }

  testConnection(hostId: string) {
    return hostService.testConnection(hostId);
  }

  checkSavedHost(hostId: string) {
    return hostService.checkSavedHost(hostId);
  }

  startTemplatePreparation(hostId: string) {
    return hostService.startTemplatePreparation(hostId);
  }
}

export const hostController = new HostController();
