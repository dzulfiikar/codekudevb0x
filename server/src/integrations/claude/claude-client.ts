import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ModelInfo, type Options, query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { InvalidInputError, toErrorMessage } from "../../shared/errors.js";

export type ClaudeCredentialKind = "plan_token" | "api_key";

export type ClaudeModel = { id: string; displayName: string; description: string };

export type ClaudeTestResult =
  | { ok: true; modelCount: number; subscriptionType: string | null; credentialKind: ClaudeCredentialKind }
  | { ok: false; message: string };

export const claudeConfigDirectory = join(tmpdir(), "codekudevb0x-claude");

export function getCredentialKind(credential: string): ClaudeCredentialKind {
  if (credential.startsWith("sk-ant-oat")) return "plan_token";
  if (credential.startsWith("sk-ant-api")) return "api_key";
  throw new InvalidInputError(
    "Not a Claude credential. Paste a token from `claude setup-token` (sk-ant-oat…) or an Anthropic API key (sk-ant-api…).",
  );
}

// ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN outrank CLAUDE_CODE_OAUTH_TOKEN, so any host value must go.
export function buildClaudeEnvironment(credential: string): NonNullable<Options["env"]> {
  const environment = { ...process.env };
  delete environment.ANTHROPIC_API_KEY;
  delete environment.ANTHROPIC_AUTH_TOKEN;
  delete environment.CLAUDE_CODE_OAUTH_TOKEN;
  if (getCredentialKind(credential) === "plan_token") environment.CLAUDE_CODE_OAUTH_TOKEN = credential;
  else environment.ANTHROPIC_API_KEY = credential;
  environment.CLAUDE_CONFIG_DIR = claudeConfigDirectory;
  return environment;
}

export function buildIsolatedOptions(credential: string): Options {
  return {
    tools: [],
    settingSources: [],
    cwd: tmpdir(),
    env: buildClaudeEnvironment(credential),
  };
}

const neverEndingPrompt: AsyncIterable<SDKUserMessage> = {
  [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
};

const toClaudeModel = (model: ModelInfo): ClaudeModel => ({
  id: model.value,
  displayName: model.displayName,
  description: model.description,
});

export async function listModels(credential: string) {
  const abortController = new AbortController();
  const session = query({
    prompt: neverEndingPrompt,
    options: { ...buildIsolatedOptions(credential), abortController, persistSession: false },
  });
  try {
    const [models, account] = await Promise.all([session.supportedModels(), session.accountInfo()]);
    return { models: models.map(toClaudeModel), subscriptionType: account.subscriptionType ?? null };
  } finally {
    abortController.abort();
    session.close();
  }
}

export async function testCredential(credential: string): Promise<ClaudeTestResult> {
  try {
    const credentialKind = getCredentialKind(credential);
    const session = query({
      prompt: "Reply with OK",
      options: { ...buildIsolatedOptions(credential), model: "haiku", maxTurns: 1, persistSession: false },
    });
    try {
      const [models, account] = await Promise.all([session.supportedModels(), session.accountInfo()]);
      for await (const message of session) {
        if (message.type === "result" && (message.subtype !== "success" || message.is_error)) {
          const detail = message.subtype === "success" ? message.result : message.errors.join("; ");
          return { ok: false, message: detail || `Claude query failed (${message.subtype})` };
        }
      }
      return { ok: true, modelCount: models.length, subscriptionType: account.subscriptionType ?? null, credentialKind };
    } finally {
      session.close();
    }
  } catch (error) {
    return { ok: false, message: toErrorMessage(error) };
  }
}
