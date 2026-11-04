import type { Settings } from "../../shared/api-types";

export function hasSetupAgentCredential(settings: Settings): boolean {
  return settings.agentProvider === "claude" ? settings.claudeCredentialKind !== null : settings.geminiApiKeySource === "database";
}
