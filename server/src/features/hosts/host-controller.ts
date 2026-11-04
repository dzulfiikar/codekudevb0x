import type { Request, Response } from "express";
import { z } from "zod";
import { optionalText } from "../../shared/validation.js";
import { hostService } from "./host-service.js";

const createHostBody = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.url({ protocol: /^https?$/ }),
  tokenId: z.string().trim().regex(/^[^@\s]+@[^!\s]+![^\s]+$/, "Token ID looks like user@realm!tokenname"),
  tokenSecret: z.string().trim().min(1),
  node: optionalText,
  templateVmid: z.coerce.number().int().min(100).default(9000),
  bridge: z.string().trim().min(1).default("vmbr0"),
  allowSelfSigned: z.boolean().default(false),
});

const checkHostBody = createHostBody.omit({ name: true });

class HostController {
  list = async (_request: Request, response: Response) => {
    response.json(await hostService.list());
  };

  create = async (request: Request, response: Response) => {
    response.status(201).json(await hostService.create(createHostBody.parse(request.body)));
  };

  checkUnsavedHost = async (request: Request, response: Response) => {
    response.json(await hostService.checkUnsavedHost(checkHostBody.parse(request.body)));
  };

  delete = async (request: Request<{ id: string }>, response: Response) => {
    await hostService.delete(request.params.id);
    response.status(204).end();
  };

  testConnection = async (request: Request<{ id: string }>, response: Response) => {
    response.json(await hostService.testConnection(request.params.id));
  };

  checkSavedHost = async (request: Request<{ id: string }>, response: Response) => {
    response.json(await hostService.checkSavedHost(request.params.id));
  };

  startTemplatePreparation = async (request: Request<{ id: string }>, response: Response) => {
    await hostService.startTemplatePreparation(request.params.id);
    response.status(202).end();
  };
}

export const hostController = new HostController();
