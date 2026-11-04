import { type Content, createPartFromFunctionResponse, type FunctionCall, type FunctionDeclaration, type Part } from "@google/genai";
import { z } from "zod";
import { resourceNamePattern } from "../../shared/patterns.js";
import type { CommandResult } from "../../shared/shell.js";
import type { GeminiClient } from "../../integrations/gemini/gemini-client.js";

export type ReportedService = { name: string; port: number };

type SetupAgentOptions = {
  projectName: string;
  projectPath: string;
  usedPorts: number[];
  gemini: GeminiClient;
  runCommand: (command: string) => Promise<CommandResult>;
  onAgentMessage: (message: string) => void;
};

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

const runCommandArguments = z.object({ command: z.string().min(1) });
const reportServicesArguments = z.object({
  services: z.array(
    z.object({
      name: z.string().regex(resourceNamePattern),
      port: z.coerce.number().int().min(1).max(65535),
    }),
  ),
});

const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "run_command",
    description: "Run a bash command as root inside the project directory. Returns exitCode, stdout and stderr.",
    parametersJsonSchema: {
      type: "object",
      properties: { command: { type: "string", description: "The bash command to run" } },
      required: ["command"],
    },
  },
  {
    name: "report_services",
    description: "Report the services you started and their ports. Call this once at the end.",
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

function buildSystemInstruction(context: SetupAgentOptions) {
  const usedPorts = context.usedPorts.length ? context.usedPorts.join(", ") : "none yet";
  return `You set up a GitHub project for development inside an Ubuntu 24.04 VM.
The project is cloned at ${context.projectPath}. Its owner is the user "dev". Commands run as root in that directory.
Docker, Docker Compose, git, Node.js 22 and npm are installed. Install any other runtime the project needs yourself (apt or the official installer).

Goal: start every service of this project in dev/watch mode with hot reload (npm run dev, nodemon, vite, flask --debug, air, and so on), bound to 0.0.0.0.
- Read the README, package files and compose files before deciding what to run.
- Install dependencies as user dev (sudo -u dev ...), so files in the project stay owned by dev.
- Run each app process as a systemd unit named ${context.projectName}-SERVICE.service with User=dev, WorkingDirectory=${context.projectPath} and Restart=always. Then systemctl daemon-reload and systemctl enable --now the unit.
- Databases and other infrastructure may run with docker compose, published on 0.0.0.0.
- If the repo only has a compose setup, prefer docker compose watch or dev services with bind mounts.
- Ports already used in this VM, never use them: ${usedPorts}. Also check with ss -ltnp before choosing a port. Pick ports through the project's config or environment variables.
- run_command blocks until the command exits (600 s limit). Never run a server in the foreground with it; use systemd units.
- Check that each service is listening (ss -ltnp, curl) before reporting.
- Always finish by calling report_services with the services the user should open in a browser.`;
}

export class SetupAgent {
  private readonly contents: Content[] = [];
  private pendingReportParts: Part[] = [];

  constructor(private readonly options: SetupAgentOptions) {}

  private generate() {
    return this.options.gemini.generateContent({
      contents: shortenOldToolOutputs(this.contents),
      systemInstruction: buildSystemInstruction(this.options),
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
