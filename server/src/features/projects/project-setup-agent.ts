import { type Content, createPartFromFunctionResponse, type FunctionCall, type FunctionDeclaration, type Part } from "@google/genai";
import { z } from "zod";
import type { GeminiClient } from "../../integrations/gemini/gemini-client.js";
import {
  type ProjectSetupAgent,
  type ReportedService,
  reportServicesArguments,
  reportServicesDescription,
  runCommandArguments,
  runCommandDescription,
  type SetupContext,
} from "./project-setup-instructions.js";

type SetupAgentOptions = SetupContext & { gemini: GeminiClient };

const maxToolCalls = 25;
const fullOutputTurns = 4;

function shortenOldToolOutputs(contents: Content[]): Content[] {
  const toolTurns = contents.flatMap((content, index) =>
    content.parts?.some((part) => part.functionResponse) ? [index] : [],
  );
  const oldToolTurns = new Set(toolTurns.slice(0, -fullOutputTurns));
  return contents.map((content, index) => {
    const parts = (content.parts ?? []).filter((part) => !(part.thought && !part.functionCall));
    if (!oldToolTurns.has(index)) return { ...content, parts };
    return {
      ...content,
      parts: parts.map((part) => {
        const response = part.functionResponse?.response;
        if (!part.functionResponse || !response) return part;
        const trimmed = Object.fromEntries(
          Object.entries(response).map(([key, value]) => [key, typeof value === "string" ? value.slice(-300) : value]),
        );
        return { ...part, functionResponse: { ...part.functionResponse, response: trimmed } };
      }),
    };
  });
}

const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "run_command",
    description: runCommandDescription,
    parametersJsonSchema: {
      type: "object",
      properties: { command: { type: "string", description: "The bash command to run" } },
      required: ["command"],
    },
  },
  {
    name: "report_services",
    description: reportServicesDescription,
    parametersJsonSchema: {
      type: "object",
      properties: {
        services: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Lowercase service name, e.g. web or api" },
              port: { type: "integer" },
            },
            required: ["name", "port"],
          },
        },
      },
      required: ["services"],
    },
  },
];

export class SetupAgent implements ProjectSetupAgent {
  private readonly contents: Content[] = [];
  private pendingReportParts: Part[] = [];

  constructor(private readonly options: SetupAgentOptions) {}

  private generate() {
    return this.options.gemini.generateContent({
      contents: shortenOldToolOutputs(this.contents),
      systemInstruction: this.options.systemPrompt,
      functionDeclarations,
    });
  }

  private async handleRunCommand(call: FunctionCall) {
    const parsedArguments = runCommandArguments.safeParse(call.args);
    if (!parsedArguments.success) return { error: z.prettifyError(parsedArguments.error) };
    const result = await this.options.runCommand(parsedArguments.data.command);
    return { exitCode: result.exitCode, stdout: result.stdout.slice(-2500), stderr: result.stderr.slice(-1500) };
  }

  async run(message: string): Promise<ReportedService[]> {
    if (this.pendingReportParts.length) {
      const parts = this.pendingReportParts.map((part) =>
        part.functionResponse?.name === "report_services"
          ? createPartFromFunctionResponse(part.functionResponse.id ?? "", "report_services", { error: message })
          : part,
      );
      this.contents.push({ role: "user", parts });
      this.pendingReportParts = [];
    } else {
      this.contents.push({ role: "user", parts: [{ text: message }] });
    }

    let toolCallCount = 0;
    let hasNudged = false;
    while (toolCallCount < maxToolCalls) {
      const response = await this.generate();
      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) this.contents.push({ ...modelContent, role: "model" });

      const text = (modelContent?.parts ?? [])
        .filter((part) => part.text && !part.thought)
        .map((part) => part.text)
        .join("")
        .trim();
      if (text) this.options.onAgentMessage(text);

      const calls = response.functionCalls ?? [];
      if (!calls.length) {
        if (hasNudged) throw new Error("Gemma stopped without calling a tool");
        hasNudged = true;
        this.contents.push({ role: "user", parts: [{ text: "Call a tool." }] });
        continue;
      }

      const responseParts: Part[] = [];
      let reported: ReportedService[] | undefined;
      for (const call of calls) {
        toolCallCount++;
        if (call.name === "report_services") {
          const parsedArguments = reportServicesArguments.safeParse(call.args);
          if (parsedArguments.success) reported = parsedArguments.data.services;
          const result = parsedArguments.success ? { ok: true } : { error: z.prettifyError(parsedArguments.error) };
          responseParts.push(createPartFromFunctionResponse(call.id ?? "", "report_services", result));
          continue;
        }
        const result =
          call.name === "run_command"
            ? await this.handleRunCommand(call)
            : { error: `Unknown tool ${call.name ?? ""}. Use run_command or report_services.` };
        responseParts.push(createPartFromFunctionResponse(call.id ?? "", call.name ?? "", result));
      }
      if (reported) {
        this.pendingReportParts = responseParts;
        return reported;
      }
      this.contents.push({ role: "user", parts: responseParts });
    }
    throw new Error(`Gemma used ${maxToolCalls} tool calls without reporting services`);
  }
}
