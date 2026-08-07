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

async function main() {
  switch (command) {
    case "index": {
      const force = args.includes("--force");
      await indexRepository((msg) => console.log(msg), { force });
      break;
    }
    case "index-nfts":
      await indexNfts((msg) => console.log(msg), { refresh: true });
      break;
    case "search": {
      if (!args[0]) {
        console.error("Usage: pnpm search \"your query\"");
        process.exit(1);
      }
      const results = await searchKnowledge(args.join(" "), { limit: 5 });
      if (results.length === 0) {
        console.log("No results. Run `pnpm index` first.");
        break;
      }
      for (const r of results) {
        console.log(`\n[${r.score.toFixed(4)}] ${r.filePath}:${r.startLine}-${r.endLine}`);
        console.log(r.text.slice(0, 400) + (r.text.length > 400 ? "..." : ""));
      }
      break;
    }
    case "prices": {
      const prices = await getPrices();
      console.log(formatResourcePrices({ prices, resource: args.join(" ") || undefined }));
      break;
    }
    case "exchange": {
      const exchange = await getExchange();
      console.log(formatExchange({ exchange, fetchedAt: exchange.fetchedAt }));
      break;
    }
    case "nfts": {
      const nfts = await getNfts();
      console.log(formatNftPrices({ nfts, name: args.join(" ") || undefined, limit: 50 }));
      break;
    }
    case "status": {
      const ollamaOk = await checkOllamaHealth();
      const count = await getRecordCount();
      console.log(`Ollama: ${ollamaOk ? "OK" : "DOWN"}`);
      console.log(`Indexed records: ${count}`);
      break;
    }
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
