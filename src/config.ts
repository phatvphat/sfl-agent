import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

loadEnv();

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

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
    /** Reject off-topic chat server-side before calling Cursor agent */
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
