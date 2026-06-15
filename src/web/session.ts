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

const sessions = new Map<string, SessionEntry>();

let sharedAgent: SDKAgent | null = null;
let sharedAgentResumed = false;
let warmupPromise: Promise<void> | null = null;
let warmedAt: number | null = null;

function mcpServerConfig() {
  const mcpScript = join(config.projectRoot, "scripts", "start-mcp.mjs");
  return {
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
  };
}

function agentOptions(): AgentOptions {
  if (!config.cursor.apiKey) {
    throw new Error("CURSOR_API_KEY is not set in .env");
  }

  return {
    apiKey: config.cursor.apiKey,
    model: { id: config.cursor.model },
    local: {
      cwd: config.projectRoot,
      settingSources: [],
    },
    mcpServers: mcpServerConfig(),
  };
}

async function createAgent(): Promise<SDKAgent> {
  return Agent.create(agentOptions());
}

async function disposeAgent(agent: SDKAgent): Promise<void> {
  try {
    await agent[Symbol.asyncDispose]();
  } catch {
    agent.close();
  }
}

async function resetSharedAgent(log?: (message: string) => void): Promise<void> {
  if (sharedAgent) {
    const agentId = sharedAgent.agentId;
    log?.(`Disposing Cursor agent ${agentId}`);
    await disposeAgent(sharedAgent);
    await purgeAgent(localAgentStore, agentId);
    sharedAgent = null;
    warmedAt = null;
    sharedAgentResumed = false;
  }
  sessions.clear();
}

async function acquireSharedAgent(log?: (message: string) => void): Promise<SDKAgent> {
  if (sharedAgent) {
    log?.(`Reusing in-memory Cursor agent ${sharedAgent.agentId}`);
    sharedAgentResumed = true;
    return sharedAgent;
  }

  if (config.web.agentId) {
    try {
      log?.(`Resuming Cursor agent ${config.web.agentId}...`);
      const agent = await Agent.resume(config.web.agentId, agentOptions());
      sharedAgentResumed = true;
      return agent;
    } catch {
      log?.(`Could not resume ${config.web.agentId}; creating a new agent...`);
    }
  }

  if (!config.web.reuseAgent) {
    log?.("Creating new Cursor agent (WEB_REUSE_AGENT=false)...");
  } else {
    log?.("Creating Cursor agent...");
  }

  sharedAgentResumed = false;
  return createAgent();
}

export function getWarmupStatus() {
  return {
    warmed: Boolean(sharedAgent),
    warmedAt,
    sharedAgent: config.web.sharedAgent,
    warmAgent: config.web.warmAgent,
    reuseAgent: config.web.reuseAgent,
    persistChatContext: config.web.persistChatContext,
    agentResumed: sharedAgentResumed,
    agentId: sharedAgent?.agentId ?? null,
    sessionCount: sessions.size,
  };
}

/**
 * Start a browser visit. When persistChatContext is off (default), disposes the
 * previous agent so conversation bytes leave RAM before the next chat.
 */
export async function beginBrowserSession(
  log?: (message: string) => void,
): Promise<string> {
  const sessionId = randomUUID();

  if (!config.web.persistChatContext) {
    await resetSharedAgent(log);
    if (config.web.sharedAgent && config.web.warmAgent && config.cursor.apiKey) {
      await warmupAgent(log);
    }
  }

  return sessionId;
}

/**
 * Pre-start Cursor agent (and MCP child process) so first chat is faster.
 */
export async function warmupAgent(log?: (message: string) => void): Promise<void> {
  if (!config.cursor.apiKey || !config.web.warmAgent) return;
  if (sharedAgent) return;

  if (warmupPromise) {
    await warmupPromise;
    return;
  }

  warmupPromise = (async () => {
    log?.("Starting Cursor agent + MCP sfl-agent...");
    sharedAgent = await acquireSharedAgent(log);
    warmedAt = Date.now();
    log?.(`Agent ready (${sharedAgent.agentId})`);

    if (config.web.warmMcpPing) {
      log?.("Pinging MCP via sfl_status...");
      const run = await sharedAgent.send(
        wrapUserMessage("Call sfl_status only. Reply with exactly one word: ready"),
      );
      await run.wait();
      log?.("MCP ping complete");
    }
  })();

  try {
    await warmupPromise;
  } finally {
    warmupPromise = null;
  }
}

export async function getOrCreateSession(sessionId: string): Promise<SessionEntry> {
  if (config.web.sharedAgent) {
    await warmupAgent();
    if (!sharedAgent) {
      throw new Error("Shared agent is not available");
    }

    const entry: SessionEntry = {
      agent: sharedAgent,
      agentId: sharedAgent.agentId,
      createdAt: warmedAt ?? Date.now(),
      lastUsedAt: Date.now(),
    };
    sessions.set(sessionId, entry);
    return entry;
  }

  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing;
  }

  const agent = await createAgent();
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
  return agent.send(wrapUserMessage(message));
}

export function listSessions(): Array<{ sessionId: string; agentId: string; lastUsedAt: number }> {
  return [...sessions.entries()].map(([sessionId, entry]) => ({
    sessionId,
    agentId: entry.agentId,
    lastUsedAt: entry.lastUsedAt,
  }));
}

export async function closeAllSessions(): Promise<void> {
  if (config.web.sharedAgent) {
    await resetSharedAgent();
    return;
  }

  const seen = new Set<SDKAgent>();
  const closers = [...sessions.values()]
    .filter((entry) => {
      if (seen.has(entry.agent)) return false;
      seen.add(entry.agent);
      return true;
    })
    .map(async (entry) => {
      await disposeAgent(entry.agent);
      await purgeAgent(localAgentStore, entry.agentId);
    });

  await Promise.all(closers);
  sessions.clear();
}
