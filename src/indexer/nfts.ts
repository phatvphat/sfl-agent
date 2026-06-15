import { createHash } from "node:crypto";
import { config, type KnowledgeRecord } from "../config.js";
import {
  flattenNfts,
  formatNftRecordText,
  getNfts,
  nftFilePath,
  type NftItem,
} from "../apis/sfl-world.js";
import {
  deleteRecordsByFilePathPrefix,
  NFT_API_FILE_PREFIX,
  saveRecordBatch,
} from "../db/lancedb.js";
import { embedTexts, truncateForEmbedding } from "../embeddings/ollama.js";

function makeNftRecordId(item: NftItem): string {
  return createHash("sha256")
    .update(`nft:${item.collection}:${item.id}`)
    .digest("hex")
    .slice(0, 24);
}

export interface IndexNftsResult {
  added: number;
  removed: boolean;
  total: number;
  boostCount: number;
}

export async function indexNfts(
  onProgress?: (message: string) => void,
  options: { refresh?: boolean } = {},
): Promise<IndexNftsResult> {
  const { refresh = true } = options;
  const { batchSize } = config.indexing;

  onProgress?.("Fetching NFT prices from sfl.world...");
  const nfts = await getNfts(true);
  const items = flattenNfts(nfts);
  const boostCount = items.filter((item) => Boolean(item.have_boost)).length;

  if (refresh) {
    onProgress?.("Removing previous NFT records from LanceDB...");
    await deleteRecordsByFilePathPrefix(NFT_API_FILE_PREFIX);
  }

  let added = 0;
  let pending: NftItem[] = [];

  const flushBatch = async () => {
    if (pending.length === 0) return;

    const texts = pending.map((item) =>
      truncateForEmbedding(formatNftRecordText(item, nfts.updatedAt)),
    );
    const vectors = await embedTexts(texts, "document");
    const batch: KnowledgeRecord[] = [];

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]!;
      const filePath = nftFilePath(item);
      batch.push({
        id: makeNftRecordId(item),
        text: texts[i]!,
        vector: vectors[i]!,
        filePath,
        startLine: 1,
        endLine: 1,
        docType: "api",
        symbol: item.have_boost ? "nft_boost" : "nft",
        heading: item.name,
      });
    }

    await saveRecordBatch(batch);
    added += batch.length;
    onProgress?.(`Saved NFT batch of ${batch.length} → ${added}/${items.length}`);
    pending = [];
  };

  for (const item of items) {
    pending.push(item);
    if (pending.length >= batchSize) {
      onProgress?.(`Embedding NFT batch of ${batchSize}...`);
      await flushBatch();
    }
  }

  if (pending.length > 0) {
    onProgress?.(`Embedding final NFT batch of ${pending.length}...`);
    await flushBatch();
  }

  onProgress?.(
    `NFT index complete: ${added} records (${boostCount} with have_boost buff).`,
  );

  return {
    added,
    removed: refresh,
    total: items.length,
    boostCount,
  };
}
