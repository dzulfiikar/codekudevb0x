import { type Content, type FunctionDeclaration, GoogleGenAI } from "@google/genai";
import { sleep } from "../../shared/shell.js";

export type GemmaModel = { id: string; displayName: string };

const retryBudgetMilliseconds = 180_000;

function findHttpStatusCode(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return Number(/"code":\s*(\d{3})/.exec(text)?.[1] ?? 0);
}

// The free tier caps input tokens per minute per model; the API says how long to wait.
function findRetryDelayMilliseconds(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const seconds = /retry in ([\d.]+)s/i.exec(text)?.[1] ?? /"retryDelay":\s*"(\d+)s"/.exec(text)?.[1];
  return seconds ? Math.ceil(Number(seconds) * 1000) + 1000 : undefined;
}

export class GeminiClient {
  private readonly client: GoogleGenAI;
  private currentModelIndex = 0;

  constructor(
    apiKey: string,
    private readonly models: string[] = [],
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async listGemmaModels() {
    const models: GemmaModel[] = [];
    for await (const model of await this.client.models.list({ config: { pageSize: 100 } })) {
      const id = model.name?.replace(/^models\//, "") ?? "";
      if (id.includes("gemma")) models.push({ id, displayName: model.displayName ?? id });
    }
    return models.toSorted((a, b) => a.id.localeCompare(b.id));
  }

  // Each model has its own per-minute quota, so a 429 or 5xx switches to the next model before retrying.
  async generateContent(request: {
    contents: Content[];
    systemInstruction: string;
    functionDeclarations: FunctionDeclaration[];
  }) {
    const deadline = Date.now() + retryBudgetMilliseconds;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.client.models.generateContent({
          model: this.models[this.currentModelIndex] ?? this.models[0] ?? "",
          contents: request.contents,
          config: {
            systemInstruction: request.systemInstruction,
            tools: [{ functionDeclarations: request.functionDeclarations }],
          },
        });
      } catch (error) {
        const statusCode = findHttpStatusCode(error);
        const isQuotaOrServerError = statusCode === 429 || statusCode >= 500;
        const isRetryable = isQuotaOrServerError || statusCode === 0;
        if (!isRetryable || Date.now() > deadline) throw error;
        if (isQuotaOrServerError) this.currentModelIndex = (this.currentModelIndex + 1) % this.models.length;
        await sleep(Math.min(findRetryDelayMilliseconds(error) ?? attempt * 5000, 30_000));
      }
    }
  }
}
