/**
 * Self-contained MCP launcher for Cursor global settings (Windows).
 * Resolves project root from this file — does not rely on MCP "cwd".
 *
 * Global MCP config:
 *   "command": "node",
 *   "args": ["E:\\Projects\\sfl-agent\\scripts\\start-mcp.mjs"]
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

process.chdir(projectRoot);

const tsxApiPath = join(projectRoot, "node_modules", "tsx", "dist", "esm", "api", "index.mjs");
const { register } = await import(pathToFileURL(tsxApiPath).href);
register();

await import(pathToFileURL(join(projectRoot, "src", "mcp", "server.ts")).href);
