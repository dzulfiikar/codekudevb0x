import { type Content, createPartFromFunctionResponse, type FunctionCall, GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import type { CommandResult } from "./proxmox.js";
import { wait } from "./proxmox.js";
import { findGemmaSettings } from "./settings.js";

export type ReportedService = { name: string; port: number };

export type AgentContext = {
  projectName: string;
  projectPath: string;
  usedPorts: number[];
  runCommand: (command: string) => Promise<CommandResult>;
  onAgentMessage: (message: string) => void;
};

const maxToolCalls = 25;
const retryBudgetMs = 180_000;
const fullOutputTurns = 4;

function findErrorCode(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return Number(/"code":\s*(\d{3})/.exec(text)?.[1] ?? 0);
}

// The free tier caps input tokens per minute per model; the API says how long to wait.
function findRetryDelayMs(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const seconds = /retry in ([\d.]+)s/i.exec(text)?.[1] ?? /"retryDelay":\s*"(\d+)s"/.exec(text)?.[1];
  return seconds ? Math.ceil(Number(seconds) * 1000) + 1000 : undefined;
}

function compactHistory(contents: Content[]): Content[] {
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

const runCommandArgs = z.object({ command: z.string().min(1) });
const reportServicesArgs = z.object({
  services: z.array(
    z.object({
      name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
      port: z.coerce.number().int().min(1).max(65535),
    }),
  ),
});

const functionDeclarations = [
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

function systemInstruction(context: AgentContext) {
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

export async function createAgentSession(context: AgentContext) {
  const gemma = await findGemmaSettings();
  if (!gemma.apiKey) throw new Error("No Gemini API key. Add one on the Settings page.");
  const ai = new GoogleGenAI({ apiKey: gemma.apiKey });
  const models = gemma.fallbackModel ? [gemma.primaryModel, gemma.fallbackModel] : [gemma.primaryModel];
  const contents: Content[] = [];
  let pendingReportParts: Part[] = [];

  let modelIndex = 0;

  async function generate() {
    const deadline = Date.now() + retryBudgetMs;
    for (let attempt = 1; ; attempt++) {
      try {
        return await ai.models.generateContent({
          model: models[modelIndex] ?? gemma.primaryModel,
          contents: compactHistory(contents),
          config: { systemInstruction: systemInstruction(context), tools: [{ functionDeclarations }] },
        });
      } catch (error) {
        const code = findErrorCode(error);
        const isRetryable = code === 429 || code >= 500 || code === 0;
        if (!isRetryable || Date.now() > deadline) throw error;
        if (code === 429 || code >= 500) modelIndex = (modelIndex + 1) % models.length;
        await wait(Math.min(findRetryDelayMs(error) ?? attempt * 5000, 30_000));
      }
    }
  }

  async function handleCall(call: FunctionCall) {
    if (call.name === "run_command") {
      const args = runCommandArgs.safeParse(call.args);
      if (!args.success) return { error: z.prettifyError(args.error) };
      const result = await context.runCommand(args.data.command);
      return { exitCode: result.exitCode, stdout: result.stdout.slice(-2500), stderr: result.stderr.slice(-1500) };
    }
    return { error: `Unknown tool ${call.name ?? ""}. Use run_command or report_services.` };
  }

  async function run(message: string): Promise<ReportedService[]> {
    if (pendingReportParts.length) {
      const parts = pendingReportParts.map((part) =>
        part.functionResponse?.name === "report_services"
          ? createPartFromFunctionResponse(part.functionResponse.id ?? "", "report_services", { error: message })
          : part,
      );
      contents.push({ role: "user", parts });
      pendingReportParts = [];
    } else {
      contents.push({ role: "user", parts: [{ text: message }] });
    }

    let toolCalls = 0;
    let nudged = false;
    while (toolCalls < maxToolCalls) {
      const response = await generate();
      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) contents.push({ ...modelContent, role: "model" });

      const text = (modelContent?.parts ?? [])
        .filter((part) => part.text && !part.thought)
        .map((part) => part.text)
        .join("")
        .trim();
      if (text) context.onAgentMessage(text);

      const calls = response.functionCalls ?? [];
      if (!calls.length) {
        if (nudged) throw new Error("Gemma stopped without calling a tool");
        nudged = true;
        contents.push({ role: "user", parts: [{ text: "Call a tool." }] });
        continue;
      }

      const responseParts: Part[] = [];
      let reported: ReportedService[] | undefined;
      for (const call of calls) {
        toolCalls++;
        if (call.name === "report_services") {
          const args = reportServicesArgs.safeParse(call.args);
          if (args.success) reported = args.data.services;
          const result = args.success ? { ok: true } : { error: z.prettifyError(args.error) };
          responseParts.push(createPartFromFunctionResponse(call.id ?? "", "report_services", result));
          continue;
        }
        responseParts.push(createPartFromFunctionResponse(call.id ?? "", call.name ?? "", await handleCall(call)));
      }
      if (reported) {
        pendingReportParts = responseParts;
        return reported;
      }
      contents.push({ role: "user", parts: responseParts });
    }
    throw new Error(`Gemma used ${maxToolCalls} tool calls without reporting services`);
  }

  return { run };
}
