import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "../config.js";
import {
  formatApiDateTime,
  formatExchange,
  formatNftPrices,
  formatResourcePrices,
  getExchange,
  getNfts,
  getPrices,
  resourceToUsd,
  type MarketType,
  type NftCollection,
} from "../apis/sfl-world.js";
import { getRecordCount, searchKnowledge } from "../db/lancedb.js";
import { checkOllamaHealth } from "../embeddings/ollama.js";
import { indexRepository } from "../indexer/index.js";
import { indexNfts } from "../indexer/nfts.js";

function formatSearchResults(
  results: Awaited<ReturnType<typeof searchKnowledge>>,
): string {
  if (results.length === 0) {
    return "No results found. Run `pnpm index` first to index the Sunflower Land repository.";
  }

  return results
    .map((r, i) => {
      const location = `${r.filePath}:${r.startLine}-${r.endLine}`;
      const meta = [
        r.symbol ? `symbol=${r.symbol}` : null,
        r.heading ? `heading=${r.heading}` : null,
        `type=${r.docType}`,
        `score=${r.score.toFixed(4)}`,
      ]
        .filter(Boolean)
        .join(", ");

      return `### Result ${i + 1} — ${location}\n${meta}\n\n${r.text}`;
    })
    .join("\n\n---\n\n");
}

async function readSourceFile(filePath: string, startLine?: number, endLine?: number) {
  const absolute = join(config.repo.path, filePath);
  const content = await readFile(absolute, "utf-8");
  const lines = content.split(/\r?\n/);

  const start = Math.max(1, startLine ?? 1);
  const end = Math.min(lines.length, endLine ?? lines.length);

  const slice = lines.slice(start - 1, end).map((line, idx) => {
    const lineNo = start + idx;
    return `${String(lineNo).padStart(5, " ")}| ${line}`;
  });

  return `File: ${filePath} (lines ${start}-${end})\n\n${slice.join("\n")}`;
}

const server = new McpServer({
  name: "sfl-agent",
  version: "0.1.0",
});

server.tool(
  "sfl_search",
  "Semantic search across indexed Sunflower Land source code and docs. Use for game mechanics, items, recipes, constants, UI logic, etc.",
  {
    query: z.string().describe("Natural language or keyword query about Sunflower Land"),
    limit: z.number().int().min(1).max(20).optional().describe("Max results (default 8)"),
    docType: z
      .enum(["source", "doc", "api"])
      .optional()
      .describe("Filter by document type"),
    filePath: z
      .string()
      .optional()
      .describe("Filter by file path substring, e.g. 'features/crops'"),
  },
  async ({ query, limit, docType, filePath }) => {
    const results = await searchKnowledge(query, { limit, docType, filePath });
    return {
      content: [{ type: "text", text: formatSearchResults(results) }],
    };
  },
);

server.tool(
  "sfl_read_file",
  "Read a specific file from the cloned Sunflower Land repo with optional line range.",
  {
    filePath: z
      .string()
      .describe("Relative path in repo, e.g. src/features/game/types/game.ts"),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  },
  async ({ filePath, startLine, endLine }) => {
    try {
      const text = await readSourceFile(filePath, startLine, endLine);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to read file: ${message}. Ensure repo is cloned via sfl_index.`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "sfl_index",
  "Clone/update sunflower-land repo and rebuild the LanceDB vector index. Run when source changes or index is empty.",
  {
    force: z.boolean().optional().describe("Re-index even if data exists"),
  },
  async ({ force }) => {
    try {
      const logs: string[] = [];
      const result = await indexRepository((msg) => logs.push(msg), { force });

      return {
        content: [
          {
            type: "text",
            text: [
              `Indexed ${result.recordCount} records from ${result.repoPath}`,
              `(+${result.added} new, ${result.skipped} skipped)`,
              "",
              ...logs,
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Indexing failed: ${message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "sfl_status",
  "Check sfl-agent health: Ollama, LanceDB record count, repo path.",
  {},
  async () => {
    const [ollamaOk, recordCount] = await Promise.all([
      checkOllamaHealth(),
      getRecordCount(),
    ]);

    const text = [
      "## SFL Agent Status",
      `- Ollama (${config.ollama.baseUrl}, model=${config.ollama.model}): ${ollamaOk ? "OK" : "UNREACHABLE"}`,
      `- LanceDB (${config.lancedb.path}): ${recordCount} records`,
      `- Repo path: ${config.repo.path}`,
      `- Prices API: ${config.apis.pricesUrl}`,
      `- Exchange API: ${config.apis.exchangeUrl}`,
      `- NFTs API: ${config.apis.nftsUrl}`,
      "",
      recordCount === 0
        ? "Tip: run tool `sfl_index` or `pnpm index` to build the knowledge base."
        : "Ready for semantic search via `sfl_search`.",
    ].join("\n");

    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "sfl_resource_prices",
  "Fetch P2P/marketplace resource prices from sfl.world. Prices are in in-game units (typically priced relative to SFL).",
  {
    resource: z
      .string()
      .optional()
      .describe("Resource name, e.g. Sunflower, Iron, Obsidian. Partial match supported."),
    market: z
      .enum(["p2p", "seq", "ge"])
      .optional()
      .describe("Market type (default: p2p)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max resources when listing without filter (default 30)"),
    includeUsd: z
      .boolean()
      .optional()
      .describe("Also show estimated USD value using current SFL/USD rate"),
  },
  async ({ resource, market = "p2p", limit, includeUsd }) => {
    try {
      const [prices, exchange] = await Promise.all([getPrices(), getExchange()]);
      let text = formatResourcePrices({ prices, resource, market, limit });

      if (includeUsd && resource) {
        const priceData = prices.data[market];
        const needle = resource.trim().toLowerCase();
        const entry = Object.entries(priceData).find(
          ([name]) => name.toLowerCase() === needle || name.toLowerCase().includes(needle),
        );
        if (entry) {
          const usd = resourceToUsd(entry[1], exchange);
          text += `\n\n**USD estimate** (@ $${exchange.sfl.usd}/SFL, rate fetched ${formatApiDateTime(exchange.fetchedAt)}): ~$${usd.toFixed(6)} per unit`;
        }
      }

      return { content: [{ type: "text", text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to fetch prices: ${message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "sfl_exchange",
  "Fetch SFL/USD exchange rate, POL, gems and coins package pricing from sfl.world.",
  {
    section: z
      .enum(["all", "sfl", "pol", "gems", "coins"])
      .optional()
      .describe("Which section to return (default: all)"),
    sflAmount: z
      .number()
      .positive()
      .optional()
      .describe("Convert this SFL amount to USD"),
  },
  async ({ section = "all", sflAmount }) => {
    try {
      const exchange = await getExchange();
      let text = formatExchange({ exchange, fetchedAt: exchange.fetchedAt, section });

      if (sflAmount !== undefined) {
        const usd = sflAmount * exchange.sfl.usd;
        text += `\n\n## Conversion\n${sflAmount} SFL ≈ $${usd.toFixed(4)} USD (@ $${exchange.sfl.usd}/SFL)`;
      }

      return { content: [{ type: "text", text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to fetch exchange: ${message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "sfl_nft_prices",
  "Fetch NFT floor prices from sfl.world. Floor is in SFL. Items with have_boost=1 provide in-game buffs (see boost_text).",
  {
    name: z
      .string()
      .optional()
      .describe("NFT name filter, e.g. Walrus Onesie, Construction Bear"),
    collection: z
      .enum(["all", "collectibles", "wearables"])
      .optional()
      .describe("NFT collection (default: all)"),
    boostOnly: z
      .boolean()
      .optional()
      .describe("Only return NFTs with have_boost buff"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max NFTs to list (default 30)"),
    includeUsd: z
      .boolean()
      .optional()
      .describe("Also show estimated USD floor using current SFL/USD rate"),
  },
  async ({ name, collection = "all", boostOnly, limit, includeUsd }) => {
    try {
      const nfts = await getNfts();
      const exchange = includeUsd ? await getExchange() : undefined;
      const text = formatNftPrices({
        nfts,
        name,
        collection: collection as NftCollection | "all",
        boostOnly,
        limit,
        includeUsd,
        exchange,
      });
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to fetch NFT prices: ${message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "sfl_index_nfts",
  "Refresh NFT floor price records in LanceDB from sfl.world API (replaces previous NFT index).",
  {},
  async () => {
    try {
      const result = await indexNfts((msg) => console.error(msg), { refresh: true });
      const text = [
        "## NFT index refreshed",
        `- Records indexed: ${result.added}`,
        `- Total NFTs in API: ${result.total}`,
        `- With have_boost buff: ${result.boostCount}`,
        `- Source: ${config.apis.nftsUrl}`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `NFT indexing failed: ${message}` }],
        isError: true,
      };
    }
  },
);

// Backward-compatible aliases
server.tool(
  "sfl_marketplace_price",
  "Alias for sfl_resource_prices — fetch marketplace resource prices from sfl.world.",
  {
    resource: z.string().optional(),
    query: z.string().optional().describe("Alias for resource name"),
    market: z.enum(["p2p", "seq", "ge"]).optional(),
  },
  async ({ resource, query, market }) => {
    const name = resource ?? query;
    const prices = await getPrices();
    const text = formatResourcePrices({
      prices,
      resource: name,
      market: (market ?? "p2p") as MarketType,
    });
    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "sfl_usd_rate",
  "Alias for sfl_exchange — fetch current SFL/USD rate from sfl.world.",
  {},
  async () => {
    const exchange = await getExchange();
    const text = formatExchange({
      exchange,
      fetchedAt: exchange.fetchedAt,
      section: "sfl",
    });
    return { content: [{ type: "text", text }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("sfl-agent MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal MCP error:", error);
  process.exit(1);
});
