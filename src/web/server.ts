import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { config } from "../config.js";
import { getRecordCount } from "../db/lancedb.js";
import { checkOllamaHealth } from "../embeddings/ollama.js";
import { localAgentStore } from "./cursor-setup.js";
import { purgeFinishedRun } from "./memory-local-agent-store.js";
import { closeAllSessions, beginBrowserSession, getWarmupStatus, sendChatMessage, warmupAgent } from "./session.js";
import { checkChatScope } from "./scope.js";

const PUBLIC_DIR = join(config.projectRoot, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function writeSse(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return true;
  }

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

async function handleHealth(res: ServerResponse) {
  const [ollamaOk, recordCount] = await Promise.all([
    checkOllamaHealth(),
    getRecordCount().catch(() => 0),
  ]);

  sendJson(res, 200, {
    ok: Boolean(config.cursor.apiKey),
    cursorApiKey: Boolean(config.cursor.apiKey),
    ollama: ollamaOk,
    indexedRecords: recordCount,
    model: config.cursor.model,
    agent: getWarmupStatus(),
  });
}

async function handleNewSession(res: ServerResponse) {
  const sessionId = await beginBrowserSession();
  sendJson(res, 200, { sessionId });
}

function resolveToolLabelFromEvent(event: {
  name: string;
  args?: unknown;
}): string | null {
  const { name, args } = event;
  if (name.startsWith("sfl_")) return name;

  if (!args || typeof args !== "object") {
    return name === "mcp" ? null : name;
  }

  const record = args as Record<string, unknown>;
  const nested = record.input as Record<string, unknown> | undefined;

  const candidates = [
    record.toolName,
    record.tool,
    record.name,
    record.tool_name,
    nested?.tool,
    nested?.toolName,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return name === "mcp" ? null : name;
}

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  let body: { sessionId?: string; message?: string };
  try {
    body = JSON.parse(await readBody(req)) as { sessionId?: string; message?: string };
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const sessionId = body.sessionId?.trim();
  const message = body.message?.trim();

  if (!sessionId || !message) {
    sendJson(res, 400, { error: "sessionId and message are required" });
    return;
  }

  if (!config.cursor.apiKey) {
    sendJson(res, 500, { error: "CURSOR_API_KEY is not configured in .env" });
    return;
  }

  if (config.web.scopeCheck) {
    const scope = checkChatScope(message);
    if (!scope.allowed && scope.reply) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      writeSse(res, "started", { sessionId });
      writeSse(res, "text", { delta: scope.reply });
      writeSse(res, "done", {
        status: "finished",
        result: scope.reply,
        scopeRejected: true,
      });
      res.end();
      return;
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  writeSse(res, "started", { sessionId });

  const heartbeat = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15_000);

  try {
    const run = await sendChatMessage(sessionId, message);
    writeSse(res, "run", { runId: run.id, agentId: run.agentId });

    let lastAssistantText = "";

    for await (const event of run.stream()) {
      switch (event.type) {
        case "assistant":
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              const full = block.text;
              const delta = full.startsWith(lastAssistantText)
                ? full.slice(lastAssistantText.length)
                : full;
              lastAssistantText = full.startsWith(lastAssistantText)
                ? full
                : lastAssistantText + full;
              if (delta) writeSse(res, "text", { delta });
            }
          }
          break;
        case "thinking":
          if (event.text) {
            writeSse(res, "thinking", { text: event.text });
          }
          break;
        case "tool_call": {
          const label = resolveToolLabelFromEvent(event);
          writeSse(res, "tool", {
            name: event.name,
            label,
            status: event.status,
            callId: event.call_id,
            args: event.args,
          });
          break;
        }
        case "status":
          writeSse(res, "status", { status: event.status, message: event.message });
          break;
        default:
          break;
      }
    }

    const result = await run.wait();
    await purgeFinishedRun(localAgentStore, run.agentId, run.id);
    writeSse(res, "done", {
      status: result.status,
      result: result.result,
      durationMs: result.durationMs,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    writeSse(res, "error", { message: msg });
  } finally {
    clearInterval(heartbeat);
  }

  res.end();
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/health") {
    await handleHealth(res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/session") {
    await handleNewSession(res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/chat") {
    await handleChat(req, res);
    return;
  }

  if (req.method === "GET") {
    const served = await serveStatic(pathname, res);
    if (served) return;
  }

  sendJson(res, 404, { error: "Not found" });
}

export async function startWebServer(): Promise<void> {
  if (!config.cursor.apiKey) {
    console.warn("Warning: CURSOR_API_KEY is not set. Chat API will fail until configured.");
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error("Request error:", error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal server error" });
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(config.web.port, config.web.host, () => resolve());
  });

  const url = `http://${config.web.host}:${config.web.port}`;
  console.log(`SFL Agent web UI: ${url}`);

  if (config.web.warmAgent && config.cursor.apiKey && config.web.persistChatContext) {
    warmupAgent((msg) => console.log(msg)).catch((error) => {
      console.error(
        "Agent warmup failed:",
        error instanceof Error ? error.message : error,
      );
    });
  } else if (!config.cursor.apiKey) {
    console.warn("Skipping agent warmup — CURSOR_API_KEY not set");
  }

  const shutdown = async () => {
    console.log("\nShutting down...");
    await closeAllSessions();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
