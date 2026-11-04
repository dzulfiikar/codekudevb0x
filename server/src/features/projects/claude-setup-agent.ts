import { createSdkMcpServer, type Options, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { toErrorMessage } from "../../shared/errors.js";
import {
  type ProjectSetupAgent,
  type ReportedService,
  reportServicesArguments,
  reportServicesDescription,
  runCommandArguments,
  runCommandDescription,
  type SetupContext,
} from "./project-setup-instructions.js";
import { buildIsolatedOptions } from "../../integrations/claude/claude-client.js";

type ClaudeSetupAgentOptions = SetupContext & {
  credential: string;
  primaryModel: string;
  fallbackModel: string | null;
};

const maxTurns = 30;
const allowedTools = ["mcp__setup__run_command", "mcp__setup__report_services"];

const toolText = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError });

export class ClaudeSetupAgent implements ProjectSetupAgent {
  private sessionId: string | undefined;
  private reported: ReportedService[] | undefined;

  constructor(private readonly options: ClaudeSetupAgentOptions) {}

  private createToolServer() {
    return createSdkMcpServer({
      name: "setup",
      version: "1.0.0",
      tools: [
        tool("run_command", runCommandDescription, runCommandArguments.shape, async ({ command }) => {
          const result = await this.options.runCommand(command);
          return toolText(
            JSON.stringify({
              exitCode: result.exitCode,
              stdout: result.stdout.slice(-2500),
              stderr: result.stderr.slice(-1500),
            }),
          );
        }),
        tool("report_services", reportServicesDescription, reportServicesArguments.shape, async (input) => {
          const parsedArguments = reportServicesArguments.safeParse(input);
          if (!parsedArguments.success) return toolText(z.prettifyError(parsedArguments.error), true);
          this.reported = parsedArguments.data.services;
          return toolText(JSON.stringify({ ok: true }));
        }),
      ],
    });
  }

  async run(message: string): Promise<ReportedService[]> {
    this.reported = undefined;
    const abortController = new AbortController();
    const options: Options = {
      ...buildIsolatedOptions(this.options.credential),
      model: this.options.primaryModel,
      fallbackModel: this.options.fallbackModel ?? undefined,
      systemPrompt: this.options.systemPrompt,
      mcpServers: { setup: this.createToolServer() },
      allowedTools,
      permissionMode: "dontAsk",
      maxTurns,
      abortController,
      resume: this.sessionId,
    };

    const session = query({ prompt: message, options });
    try {
      for await (const sdkMessage of session) {
        if (sdkMessage.type === "system" && sdkMessage.subtype === "init") {
          this.sessionId = sdkMessage.session_id;
          const unexpectedTools = sdkMessage.tools.filter((name) => !allowedTools.includes(name));
          if (unexpectedTools.length) {
            abortController.abort();
            throw new Error(`Claude agent exposed unexpected tools: ${unexpectedTools.join(", ")}`);
          }
        } else if (sdkMessage.type === "assistant") {
          for (const block of sdkMessage.message.content) {
            if (block.type === "text" && block.text.trim()) this.options.onAgentMessage(block.text.trim());
          }
        } else if (sdkMessage.type === "result") {
          this.sessionId = sdkMessage.session_id;
          if (this.reported) continue;
          if (sdkMessage.subtype !== "success") {
            throw new Error(`Claude stopped (${sdkMessage.subtype}): ${sdkMessage.errors.join("; ")}`);
          }
          if (sdkMessage.is_error) throw new Error(`Claude failed: ${sdkMessage.result}`);
        }
      }
    } catch (error) {
      if (abortController.signal.aborted || !this.reported) throw new Error(toErrorMessage(error), { cause: error });
    } finally {
      session.close();
    }
    if (!this.reported) throw new Error("Claude stopped without reporting services");
    return this.reported;
  }
}
