import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelSelection } from "@cursor/sdk";

loadEnv();

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function buildCursorModelSelection(): ModelSelection {
  const id = process.env.CURSOR_MODEL ?? "composer-2.5";
  const useFast = process.env.CURSOR_MODEL_FAST === "true";

  // composer-2.5 defaults to the "fast" variant unless fast=false is set explicitly.
  if (id === "composer-2.5" && !useFast) {
    return { id, params: [{ id: "fast", value: "false" }] };
  }

  return { id };
}

export const config = {
  projectRoot,
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    model: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
    dimensions: 768,
  },
  lancedb: {
    path: resolve(projectRoot, process.env.LANCEDB_PATH ?? "./data/lancedb"),
    tableName: "sfl_knowledge",
  },
  repo: {
    url: process.env.SFL_REPO_URL ?? "https://github.com/sunflower-land/sunflower-land.git",
    path: resolve(projectRoot, process.env.SFL_REPO_PATH ?? "./data/sunflower-land"),
    branch: process.env.SFL_REPO_BRANCH ?? "main",
    includeGlobs: (process.env.INDEX_INCLUDE_GLOBS ??
      "src/**/*.ts,src/**/*.tsx,docs/**/*.md").split(","),
  },
  indexing: {
    chunkSize: Number(process.env.CHUNK_SIZE ?? 1000),
    chunkOverlap: Number(process.env.CHUNK_OVERLAP ?? 150),
    batchSize: 16,
    /** Max chars sent to Ollama per embed (nomic-embed-text ~2048 tokens default) */
    maxEmbedChars: Number(process.env.MAX_EMBED_CHARS ?? 4000),
  },
  apis: {
    pricesUrl:
      process.env.SFL_PRICES_API_URL ?? "https://sfl.world/api/v1/prices",
    exchangeUrl:
      process.env.SFL_EXCHANGE_API_URL ?? "https://sfl.world/api/v1.1/exchange",
    nftsUrl: process.env.SFL_NFTS_API_URL ?? "https://sfl.world/api/v1/nfts",
  },
  cursor: {
    apiKey: process.env.CURSOR_API_KEY,
    model: process.env.CURSOR_MODEL ?? "composer-2.5",
    modelSelection: buildCursorModelSelection(),
  },
  web: {
    host: process.env.WEB_HOST ?? "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 3847),
    /** Pre-create Cursor agent (+ MCP) when web server starts */
    warmAgent: process.env.WEB_WARM_AGENT !== "false",
    /** Single shared agent for all chat sessions (faster, local single-user) */
    sharedAgent: process.env.WEB_SHARED_AGENT !== "false",
    /** Optional: send a tiny prompt at startup to fully warm MCP (uses API quota) */
    warmMcpPing: process.env.WEB_WARM_MCP_PING === "true",
    /** Soft gate: block clearly off-topic chat before calling Cursor agent (default allow) */
    scopeCheck: process.env.WEB_SCOPE_CHECK !== "false",
    /** Reuse the in-memory shared agent for the lifetime of `pnpm web` */
    reuseAgent: process.env.WEB_REUSE_AGENT !== "false",
    /**
     * Keep chat context across page reloads (localStorage session + same agent).
     * Default false: each reload POST /api/session resets the agent and clears RAM.
     */
    persistChatContext: process.env.WEB_PERSIST_CHAT_CONTEXT === "true",
    /** Optional: resume a specific agent id (same server process / in-memory store only) */
    agentId: process.env.WEB_AGENT_ID?.trim() || undefined,
    /**
     * If the agent ends with a status-only reply (no tools), send one follow-up.
     * Costs a second run — set false to save quota.
     */
    autoFollowUp: process.env.WEB_AUTO_FOLLOWUP !== "false",
  },
  mcp: {
    /** Default / max results for sfl_search (keeps tool payloads small) */
    searchDefaultLimit: Number(process.env.MCP_SEARCH_LIMIT ?? 4),
    searchMaxLimit: Number(process.env.MCP_SEARCH_MAX_LIMIT ?? 8),
    /** Max chars per search snippet in tool output */
    searchSnippetChars: Number(process.env.MCP_SEARCH_SNIPPET_CHARS ?? 600),
    /** Max lines returned by sfl_read_file when range is missing or too wide */
    readMaxLines: Number(process.env.MCP_READ_MAX_LINES ?? 200),
  },
} as const;

export type DocumentType = "source" | "doc" | "api";

export interface KnowledgeRecord {
  id: string;
  text: string;
  vector: number[];
  filePath: string;
  startLine: number;
  endLine: number;
  docType: DocumentType;
  symbol: string;
  heading: string;
}
