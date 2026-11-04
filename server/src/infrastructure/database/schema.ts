import { boolean, integer, jsonb, pgTable, serial, text } from "drizzle-orm/pg-core";
import type { AgentProvider, EventBody, HostCheck, ProjectStatus, Service, TemplateStatus, WorkspaceStatus } from "../../shared/api-types.js";

export const hosts = pgTable("hosts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  tokenId: text("token_id").notNull(),
  tokenSecret: text("token_secret").notNull(),
  node: text("node").notNull(),
  templateVmid: integer("template_vmid").notNull(),
  bridge: text("bridge").notNull(),
  vmStorage: text("vm_storage").notNull(),
  allowSelfSigned: boolean("allow_self_signed").notNull(),
  version: text("version"),
  templateStatus: text("template_status").$type<TemplateStatus>().notNull(),
  templateMessage: text("template_message"),
  lastCheck: jsonb("last_check").$type<HostCheck>(),
  createdAt: text("created_at").notNull(),
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  hostId: text("host_id").notNull(),
  name: text("name").notNull(),
  vmid: integer("vmid"),
  ip: text("ip"),
  status: text("status").$type<WorkspaceStatus>().notNull(),
  agentClis: jsonb("agent_clis").$type<string[]>().notNull(),
  cores: integer("cores").notNull(),
  memoryMb: integer("memory_mb").notNull(),
  diskGb: integer("disk_gb").notNull(),
  githubToken: text("github_token"),
  sshPublicKey: text("ssh_public_key"),
  username: text("username").notNull().default("dev"),
  hasPassword: boolean("has_password").notNull().default(false),
  error: text("error"),
  createdAt: text("created_at").notNull(),
});

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  repoUrl: text("repo_url").notNull(),
  status: text("status").$type<ProjectStatus>().notNull(),
  services: jsonb("services").$type<Service[]>().notNull(),
  error: text("error"),
  instructions: text("instructions"),
  createdAt: text("created_at").notNull(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  projectId: text("project_id"),
  type: text("type").$type<EventBody["type"]>().notNull(),
  payload: jsonb("payload").$type<EventBody>().notNull(),
  at: text("at").notNull(),
});

export const settings = pgTable("settings", {
  id: integer("id").primaryKey(),
  geminiApiKey: text("gemini_api_key"),
  primaryModel: text("primary_model").notNull(),
  fallbackModel: text("fallback_model"),
  agentProvider: text("agent_provider").$type<AgentProvider>().notNull().default("gemini"),
  claudeCredential: text("claude_credential"),
  claudePrimaryModel: text("claude_primary_model").notNull().default("opus"),
  claudeFallbackModel: text("claude_fallback_model").default("sonnet"),
  agentPrompt: text("agent_prompt"),
});
