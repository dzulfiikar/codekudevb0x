import { pool } from "./client.js";

export async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      token_id TEXT NOT NULL,
      token_secret TEXT NOT NULL,
      node TEXT NOT NULL,
      template_vmid INTEGER NOT NULL,
      bridge TEXT NOT NULL,
      vm_storage TEXT NOT NULL,
      allow_self_signed BOOLEAN NOT NULL,
      version TEXT,
      template_status TEXT NOT NULL,
      template_message TEXT,
      created_at TEXT NOT NULL
    );
    ALTER TABLE hosts ADD COLUMN IF NOT EXISTS last_check JSONB;
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL REFERENCES hosts(id),
      name TEXT NOT NULL,
      vmid INTEGER,
      ip TEXT,
      status TEXT NOT NULL,
      agent_clis JSONB NOT NULL,
      cores INTEGER NOT NULL,
      memory_mb INTEGER NOT NULL,
      disk_gb INTEGER NOT NULL,
      github_token TEXT,
      ssh_public_key TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    ALTER TABLE workspaces ALTER COLUMN ssh_public_key DROP NOT NULL;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT 'dev';
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS has_password BOOLEAN NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      status TEXT NOT NULL,
      services JSONB NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS instructions TEXT;
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      type TEXT NOT NULL,
      payload JSONB NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_workspace_id ON events (workspace_id, id);
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      gemini_api_key TEXT,
      primary_model TEXT NOT NULL,
      fallback_model TEXT
    );
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS agent_provider TEXT NOT NULL DEFAULT 'gemini';
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS claude_credential TEXT;
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS claude_primary_model TEXT NOT NULL DEFAULT 'opus';
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS claude_fallback_model TEXT DEFAULT 'sonnet';
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS agent_prompt TEXT;
  `);
}
