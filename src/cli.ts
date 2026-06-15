#!/usr/bin/env node
import {
  formatExchange,
  formatNftPrices,
  formatResourcePrices,
  getExchange,
  getNfts,
  getPrices,
} from "./apis/sfl-world.js";
import { getRecordCount, searchKnowledge } from "./db/lancedb.js";
import { checkOllamaHealth } from "./embeddings/ollama.js";
import { indexRepository } from "./indexer/index.js";
import { indexNfts } from "./indexer/nfts.js";

const [, , command, ...args] = process.argv;

function printHelp() {
  console.log(`sfl-agent — Sunflower Land research agent

Usage:
  pnpm index              Clone/update repo and build LanceDB index (resumes if interrupted)
  pnpm index -- --force   Drop index and rebuild from scratch
  pnpm search <query>     Test semantic search from CLI
  pnpm dev status         Show agent status
  pnpm dev prices [name]  Live resource prices (sfl.world)
  pnpm dev nfts [name]    Live NFT floor prices (sfl.world)
  pnpm dev exchange       Live SFL/USD and package rates
  pnpm index-nfts         Optional: cache NFT catalog in LanceDB for sfl_search

MCP (Cursor IDE):
  pnpm mcp                Start MCP server (configure in Cursor settings)
`);
}

async function runStatus() {
  const ollamaOk = await checkOllamaHealth();
  const count = await getRecordCount();
  console.log(`Ollama: ${ollamaOk ? "OK" : "DOWN"}`);
  console.log(`Indexed records: ${count}`);
}


async function runSearch(query: string) {
  const results = await searchKnowledge(query, { limit: 5 });
  if (results.length === 0) {
    console.log("No results. Run `pnpm index` first.");
    return;
  }

  for (const r of results) {
    console.log(`\n[${r.score.toFixed(4)}] ${r.filePath}:${r.startLine}-${r.endLine}`);
    console.log(r.text.slice(0, 400) + (r.text.length > 400 ? "..." : ""));
  }
}

async function runPrices(resource?: string) {
  const prices = await getPrices();
  console.log(formatResourcePrices({ prices, resource }));
}

async function runExchange() {
  const exchange = await getExchange();
  console.log(formatExchange({ exchange, fetchedAt: exchange.fetchedAt }));
}

async function runIndexNfts() {
  await indexNfts((msg) => console.log(msg), { refresh: true });
}

async function runNfts(name?: string) {
  const nfts = await getNfts();
  console.log(formatNftPrices({ nfts, name, limit: 50 }));
}

async function main() {
  switch (command) {
    case "index": {
      const force = args.includes("--force");
      await indexRepository((msg) => console.log(msg), { force });
      break;
    }
    case "index-nfts":
      await runIndexNfts();
      break;
    case "search":
      if (!args[0]) {
        console.error("Usage: pnpm search \"your query\"");
        process.exit(1);
      }
      await runSearch(args.join(" "));
      break;
    case "prices":
      await runPrices(args.join(" ") || undefined);
      break;
    case "exchange":
      await runExchange();
      break;
    case "nfts":
      await runNfts(args.join(" ") || undefined);
      break;
    case "status":
      await runStatus();
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
