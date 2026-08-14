import "./cursor-setup.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Agent, type AgentOptions, type SDKAgent } from "@cursor/sdk";
import { config } from "../config.js";
import { localAgentStore } from "./cursor-setup.js";
import { purgeAgent } from "./memory-local-agent-store.js";
import { wrapUserMessage } from "./prompt.js";

interface SessionEntry {
  agent: SDKAgent;
  agentId: string;
  createdAt: number;
  lastUsedAt: number;
}

/** One Cursor agent per browser tab/session — tabs do not share chat context. */
const sessions = new Map<string, SessionEntry>();

/** Drop idle agents so reload/tabs don't leak MCP child processes until restart. */
const SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 6;

/** Agent ids that already received SFL_SYSTEM_INSTRUCTIONS in this process. */
const primedAgentIds = new Set<string>();

function agentOptions(): AgentOptions {
  if (!config.cursor.apiKey) {
    throw new Error("CURSOR_API_KEY is not set in .env");
  }

  const mcpScript = join(config.projectRoot, "scripts", "start-mcp.mjs");

  return {
    apiKey: config.cursor.apiKey,
    model: config.cursor.modelSelection,
    // MCP only — block built-in read/grep/glob/shell/semSearch so the agent
    // cannot browse data/sunflower-land and must use sfl_search (LanceDB).
    tools: ["mcp"],
    local: {
      cwd: config.projectRoot,
      settingSources: [],
    },
    mcpServers: {
      "sfl-agent": {
        type: "stdio" as const,
        command: "node",
        args: [mcpScript],
        env: {
          OLLAMA_BASE_URL: config.ollama.baseUrl,
          OLLAMA_EMBED_MODEL: config.ollama.model,
          LANCEDB_PATH: config.lancedb.path,
          SFL_REPO_PATH: config.repo.path,
        },
      },
    },
  };
}

async function disposeAgent(agent: SDKAgent): Promise<void> {
  primedAgentIds.delete(agent.agentId);
  try {
    await agent[Symbol.asyncDispose]();
  } catch {
    agent.close();
  }
}

async function dropSession(sessionId: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  sessions.delete(sessionId);
  await disposeAgent(entry.agent);
  await purgeAgent(localAgentStore, entry.agentId);
}

async function gcSessions(keepId?: string): Promise<void> {
  const now = Date.now();
  const idle = [...sessions.entries()].filter(
    ([id, entry]) => id !== keepId && now - entry.lastUsedAt > SESSION_IDLE_MS,
  );
  for (const [id] of idle) {
    await dropSession(id);
  }

  if (sessions.size < MAX_SESSIONS) return;

  const oldest = [...sessions.entries()]
    .filter(([id]) => id !== keepId)
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

  while (sessions.size >= MAX_SESSIONS && oldest.length > 0) {
    const next = oldest.shift();
    if (!next) break;
    await dropSession(next[0]);
  }
}

/** System instructions only on the first message per agent (saves tokens later). */
function formatOutboundMessage(agentId: string, message: string): string {
  if (primedAgentIds.has(agentId)) {
    return message;
  }
  primedAgentIds.add(agentId);
  return wrapUserMessage(message);
}

export function getWarmupStatus() {
  return {
    sessionCount: sessions.size,
    agentIds: [...sessions.values()].map((s) => s.agentId),
  };
}

/** New tab/reload → new session id. Does not touch other tabs' agents. */
export async function beginBrowserSession(): Promise<string> {
  await gcSessions();
  return randomUUID();
}

async function getOrCreateSession(sessionId: string): Promise<SessionEntry> {
  await gcSessions(sessionId);

  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing;
  }

  const agent = await Agent.create(agentOptions());
  const entry: SessionEntry = {
    agent,
    agentId: agent.agentId,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
  sessions.set(sessionId, entry);
  return entry;
}

export async function sendChatMessage(sessionId: string, message: string) {
  const { agent } = await getOrCreateSession(sessionId);
  return agent.send(formatOutboundMessage(agent.agentId, message));
}

export async function closeAllSessions(): Promise<void> {
  const closers = [...sessions.values()].map(async (entry) => {
    await disposeAgent(entry.agent);
    await purgeAgent(localAgentStore, entry.agentId);
  });
  await Promise.all(closers);
  sessions.clear();
}
