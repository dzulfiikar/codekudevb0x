import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCredentialKind } from "../src/integrations/claude/claude-client.js";
import { ClaudeSetupAgent } from "../src/features/projects/claude-setup-agent.js";
import { buildSystemInstruction, type ReportedService } from "../src/features/projects/project-setup-instructions.js";
import { settingsService } from "../src/features/settings/settings-service.js";
import { toErrorMessage } from "../src/shared/errors.js";
import type { CommandResult } from "../src/shared/shell.js";

const claudeSettings = await settingsService.findClaudeSettings();
if (!claudeSettings.credential) {
  console.error("No Claude credential stored. Add one on the Settings page first.");
  process.exit(1);
}

const projectName = "demo";
const username = "dev";
const projectPath = `/home/${username}/projects/${projectName}`;
const packageJson = JSON.stringify(
  {
    name: projectName,
    private: true,
    type: "module",
    scripts: { dev: "vite", build: "vite build" },
    devDependencies: { vite: "^7.0.0" },
  },
  null,
  2,
);
const readme = "# demo\n\nA tiny Vite app.\n\n```\nnpm install\nnpm run dev\n```\n";
const listeningLine = 'LISTEN 0 511 0.0.0.0:5173 0.0.0.0:* users:(("node",pid=4242,fd=20))';

type Round = {
  message: string;
  commands: string[];
  agentMessages: string[];
  reportedServices: ReportedService[] | null;
  durationMilliseconds: number;
  error: string | null;
};

let isServiceStarted = false;
let currentRound: Round | undefined;

const ok = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });

// Canned answers only: nothing in this script runs on the host.
function answer(command: string): CommandResult {
  if (/systemctl\s+(.*\s)?(enable|start|restart)\b/.test(command)) isServiceStarted = true;
  if (/^\s*ls\b/.test(command)) return ok("README.md\nindex.html\npackage.json\nsrc\n");
  if (/cat\s+\S*README\.md/.test(command)) return ok(readme);
  if (/cat\s+\S*package\.json/.test(command)) return ok(packageJson);
  if (/\bss\s+-\w*l/.test(command)) {
    const header = "State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n";
    return ok(isServiceStarted ? `${header}${listeningLine}\n` : header);
  }
  if (/\bcurl\b/.test(command)) {
    return isServiceStarted
      ? ok("200")
      : { exitCode: 7, stdout: "000", stderr: "curl: (7) Failed to connect to localhost port 5173" };
  }
  return ok();
}

async function runRound(agent: ClaudeSetupAgent, message: string) {
  const round: Round = {
    message,
    commands: [],
    agentMessages: [],
    reportedServices: null,
    durationMilliseconds: 0,
    error: null,
  };
  currentRound = round;
  const startedAt = Date.now();
  try {
    round.reportedServices = await agent.run(message);
  } catch (error) {
    round.error = toErrorMessage(error);
  }
  round.durationMilliseconds = Date.now() - startedAt;
  return round;
}

const agent = new ClaudeSetupAgent({
  systemPrompt: buildSystemInstruction({
    template: await settingsService.getAgentPrompt(),
    instructions: null,
    projectName,
    projectPath,
    usedPorts: [],
    username,
  }),
  credential: claudeSettings.credential,
  primaryModel: claudeSettings.primaryModel,
  fallbackModel: claudeSettings.fallbackModel,
  runCommand: async (command) => {
    currentRound?.commands.push(command);
    console.log(`$ ${command}`);
    return answer(command);
  },
  onAgentMessage: (message) => {
    currentRound?.agentMessages.push(message);
    console.log(`agent: ${message}`);
  },
});

const startedAt = Date.now();
const rounds: Round[] = [];
rounds.push(await runRound(agent, `Set up the project "${projectName}" at ${projectPath} and start its services.`));
if (!rounds[0]?.error) {
  rounds.push(
    await runRound(
      agent,
      `These services are not reachable from outside the VM after 60 s: web on port 5173. Check that they run and listen on 0.0.0.0, fix them, then call report_services again.`,
    ),
  );
}

const failedRound = rounds.find((round) => round.error || !round.reportedServices?.length);
const isOk = rounds.length === 2 && !failedRound;
const evidence = {
  ok: isOk,
  error: failedRound ? (failedRound.error ?? "No services reported") : null,
  model: claudeSettings.primaryModel,
  fallbackModel: claudeSettings.fallbackModel,
  credentialKind: getCredentialKind(claudeSettings.credential),
  startedAt: new Date(startedAt).toISOString(),
  totalDurationMilliseconds: Date.now() - startedAt,
  rounds,
};

const evidenceDirectory = join(import.meta.dirname, "../../docs/evidence");
mkdirSync(evidenceDirectory, { recursive: true });
const evidencePath = join(evidenceDirectory, `smoke-claude-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`${isOk ? "ok" : "failed"}: evidence written to ${evidencePath}`);
process.exit(isOk ? 0 : 1);
