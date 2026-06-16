import { config } from "../config.js";
import { dropIndexTable, getIndexedIds, getRecordCount } from "../db/lancedb.js";
import { checkOllamaHealth } from "../embeddings/ollama.js";
import { ensureRepo } from "../git/repo.js";
import { indexKnowledgeIncremental } from "./chunker.js";

export { ensureRepo } from "../git/repo.js";

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
