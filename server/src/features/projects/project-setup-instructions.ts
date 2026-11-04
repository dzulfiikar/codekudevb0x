import { z } from "zod";
import { resourceNamePattern } from "../../shared/patterns.js";
import type { CommandResult } from "../../shared/shell.js";

export type ReportedService = { name: string; port: number };

export type ProjectSetupAgent = { run(message: string): Promise<ReportedService[]> };

export type SetupContext = {
  systemPrompt: string;
  runCommand: (command: string) => Promise<CommandResult>;
  onAgentMessage: (message: string) => void;
};

export const runCommandDescription =
  "Run a bash command as root inside the project directory. Returns exitCode, stdout and stderr.";
export const reportServicesDescription =
  "Report the services you started and their ports. Call this once at the end.";

export const runCommandArguments = z.object({ command: z.string().min(1) });
export const reportServicesArguments = z.object({
  services: z.array(
    z.object({
      name: z.string().regex(resourceNamePattern),
      port: z.coerce.number().int().min(1).max(65535),
    }),
  ),
});

type PromptContext = { projectName: string; projectPath: string; usedPorts: number[]; username: string };

const placeholderPattern = /(?<!\$)\{([a-z][A-Za-z]*)\}/g;
const placeholderNames = ["projectName", "projectPath", "usedPorts", "username"];

export const defaultAgentPrompt = `You set up a GitHub project for development inside an Ubuntu 24.04 VM.
The project is cloned at {projectPath}. Its owner is the user "{username}". Commands run as root in that directory.
Docker, Docker Compose, git, Node.js 22 and npm are installed. Install any other runtime the project needs yourself (apt or the official installer).

Goal: start every service of this project in dev/watch mode with hot reload (npm run dev, nodemon, vite, flask --debug, air, and so on), bound to 0.0.0.0.
- Read the README, package files and compose files before deciding what to run.
- Install dependencies as user {username} (sudo -u {username} ...), so files in the project stay owned by {username}.
- Run each app process as a systemd unit named {projectName}-SERVICE.service with User={username}, WorkingDirectory={projectPath} and Restart=always. Then systemctl daemon-reload and systemctl enable --now the unit.
- Databases and other infrastructure may run with docker compose, published on 0.0.0.0.
- If the repo only has a compose setup, prefer docker compose watch or dev services with bind mounts.
- Ports already used in this VM, never use them: {usedPorts}. Also check with ss -ltnp before choosing a port. Pick ports through the project's config or environment variables.
- run_command blocks until the command exits (600 s limit). Never run a server in the foreground with it; use systemd units.
- Check that each service is listening (ss -ltnp, curl) before reporting.
- Always finish by calling report_services with the services the user should open in a browser.`;

export function findUnknownPlaceholders(template: string) {
  return [...template.matchAll(placeholderPattern)]
    .map((match) => match[1] ?? "")
    .filter((name) => !placeholderNames.includes(name));
}

export function renderAgentPrompt(template: string, context: PromptContext) {
  const values: Record<string, string> = {
    projectName: context.projectName,
    projectPath: context.projectPath,
    usedPorts: context.usedPorts.length ? context.usedPorts.join(", ") : "none yet",
    username: context.username,
  };
  return template.replace(placeholderPattern, (placeholder, name: string) => values[name] ?? placeholder);
}

export function buildSystemInstruction({
  template,
  instructions,
  ...context
}: PromptContext & { template: string; instructions: string | null }) {
  const prompt = renderAgentPrompt(template, context);
  return instructions ? `${prompt}\n\nInstructions for this project from the user:\n${instructions}` : prompt;
}
