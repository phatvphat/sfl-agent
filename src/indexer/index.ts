import { access } from "node:fs/promises";
import { simpleGit } from "simple-git";
import { config } from "../config.js";
import { dropIndexTable, getIndexedIds, getRecordCount } from "../db/lancedb.js";
import { checkOllamaHealth } from "../embeddings/ollama.js";
import { indexKnowledgeIncremental } from "./chunker.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureRepo(onProgress?: (message: string) => void): Promise<string> {
  const repoPath = config.repo.path;

  if (await pathExists(joinGit(repoPath, ".git"))) {
    onProgress?.(`Pulling latest changes in ${repoPath}`);
    const git = simpleGit(repoPath);
    await git.pull("origin", "main", ["--ff-only"]);
    return repoPath;
  }

  onProgress?.(`Cloning ${config.repo.url} -> ${repoPath}`);
  const git = simpleGit();
  await git.clone(config.repo.url, repoPath, ["--depth", "1", "--branch", "main"]);
  return repoPath;
}

function joinGit(base: string, segment: string): string {
  return `${base.replace(/[/\\]+$/, "")}/${segment}`;
}

export async function indexRepository(
  onProgress?: (message: string) => void,
  options: { force?: boolean } = {},
): Promise<{ recordCount: number; repoPath: string; added: number; skipped: number }> {
  const ollamaOk = await checkOllamaHealth();
  if (!ollamaOk) {
    throw new Error(
      `Ollama is not reachable at ${config.ollama.baseUrl}. Start Ollama and run: ollama pull ${config.ollama.model}`,
    );
  }

  const repoPath = await ensureRepo(onProgress);

  if (options.force) {
    onProgress?.("Force rebuild: dropping existing LanceDB table...");
    await dropIndexTable();
  }

  const indexedIds = options.force ? new Set<string>() : await getIndexedIds();
  if (indexedIds.size > 0) {
    onProgress?.(`Resuming index — ${indexedIds.size} chunks already in LanceDB`);
  }

  onProgress?.("Indexing (incremental save after each embed batch)...");
  const { added, skipped } = await indexKnowledgeIncremental(repoPath, {
    indexedIds,
    onProgress,
  });

  const recordCount = await getRecordCount();

  if (recordCount === 0) {
    throw new Error("No records indexed. Check repo path and INDEX_INCLUDE_GLOBS.");
  }

  onProgress?.(
    `Done. ${recordCount} records in DB (+${added} new, ${skipped} skipped).`,
  );

  return { recordCount, repoPath, added, skipped };
}
