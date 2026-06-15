import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { config, type DocumentType, type KnowledgeRecord } from "../config.js";
import { saveRecordBatch } from "../db/lancedb.js";
import { embedTexts, truncateForEmbedding } from "../embeddings/ollama.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".md"]);

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<DOUBLESTAR>>>")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/<<<DOUBLESTAR>>>/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesAnyGlob(relativePath: string, globs: string[]): boolean {
  const normalized = relativePath.split(sep).join("/");
  return globs.some((glob) => globToRegex(glob.trim()).test(normalized));
}

async function walkFiles(dir: string, root: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git", "build", "coverage"].includes(entry.name)) {
        continue;
      }
      files.push(...(await walkFiles(fullPath, root)));
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = entry.name.slice(entry.name.lastIndexOf("."));
    if (!SOURCE_EXTENSIONS.has(ext)) continue;

    const rel = relative(root, fullPath);
    if (!matchesAnyGlob(rel, config.repo.includeGlobs)) continue;

    files.push(fullPath);
  }

  return files;
}

function detectDocType(filePath: string): DocumentType {
  if (filePath.includes(`${sep}docs${sep}`) || filePath.endsWith(".md")) {
    return "doc";
  }
  return "source";
}

function extractSymbol(lines: string[], startIndex: number): string | undefined {
  for (let i = startIndex; i >= Math.max(0, startIndex - 5); i--) {
    const match = lines[i]?.match(
      /^(?:export\s+)?(?:async\s+)?(?:function|class|const|type|interface|enum)\s+(\w+)/,
    );
    if (match) return match[1];
  }
  return undefined;
}

export interface TextChunk {
  text: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  heading?: string;
}

export function chunkText(content: string, filePath: string): TextChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: TextChunk[] = [];
  const { chunkSize, chunkOverlap } = config.indexing;

  let buffer: string[] = [];
  let bufferStart = 1;

  const flush = (endLine: number) => {
    if (buffer.length === 0) return;

    const text = buffer.join("\n").trim();
    if (text.length < 40) {
      buffer = [];
      return;
    }

    chunks.push({
      text: truncateForEmbedding(text, chunkSize),
      startLine: bufferStart,
      endLine,
      symbol: extractSymbol(lines, bufferStart - 1),
      heading: text.match(/^#\s+(.+)/m)?.[1],
    });
    buffer = [];
  };

  const pushSegment = (segment: string, lineNo: number) => {
    if (buffer.length === 0) bufferStart = lineNo;
    buffer.push(segment);

    const currentLength = buffer.join("\n").length;
    if (currentLength >= chunkSize) {
      const savedBuffer = [...buffer];
      flush(lineNo);

      const overlapLines: string[] = [];
      let overlapLength = 0;
      for (let j = savedBuffer.length - 1; j >= 0 && overlapLength < chunkOverlap; j--) {
        const overlapLine = savedBuffer[j] ?? "";
        overlapLines.unshift(overlapLine);
        overlapLength += overlapLine.length + 1;
      }

      buffer = overlapLines;
      bufferStart = lineNo + 1 - overlapLines.length;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;

    if (line.length <= chunkSize) {
      pushSegment(line, lineNo);
      continue;
    }

    for (let offset = 0; offset < line.length; offset += chunkSize) {
      pushSegment(line.slice(offset, offset + chunkSize), lineNo);
    }
  }

  flush(lines.length);

  if (chunks.length === 0 && content.trim().length > 0) {
    chunks.push({
      text: truncateForEmbedding(content.trim(), chunkSize),
      startLine: 1,
      endLine: lines.length,
      symbol: extractSymbol(lines, 0),
    });
  }

  void filePath;
  return chunks;
}

function makeRecordId(filePath: string, startLine: number, endLine: number): string {
  return createHash("sha256")
    .update(`${filePath}:${startLine}:${endLine}`)
    .digest("hex")
    .slice(0, 24);
}

export interface IncrementalIndexOptions {
  indexedIds: Set<string>;
  onProgress?: (message: string) => void;
}

export interface IncrementalIndexResult {
  added: number;
  skipped: number;
}

/**
 * Index repo incrementally: embed in batches and persist each batch to LanceDB.
 * On resume, chunks whose id already exists in LanceDB are skipped (no duplicates).
 */
export async function indexKnowledgeIncremental(
  repoPath: string,
  options: IncrementalIndexOptions,
): Promise<IncrementalIndexResult> {
  const { indexedIds, onProgress } = options;
  const { batchSize } = config.indexing;
  const files = await walkFiles(repoPath, repoPath);

  let added = 0;
  let skipped = 0;

  let pending: Array<{
    filePath: string;
    docType: DocumentType;
    chunk: TextChunk;
    id: string;
  }> = [];

  const flushBatch = async () => {
    if (pending.length === 0) return;

    const texts = pending.map((item) => {
      const header = `File: ${item.filePath} (L${item.chunk.startLine}-L${item.chunk.endLine})`;
      return truncateForEmbedding(`${header}\n\n${item.chunk.text}`);
    });

    const vectors = await embedTexts(texts, "document");
    const batch: KnowledgeRecord[] = [];

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]!;
      batch.push({
        id: item.id,
        text: texts[i]!,
        vector: vectors[i]!,
        filePath: item.filePath,
        startLine: item.chunk.startLine,
        endLine: item.chunk.endLine,
        docType: item.docType,
        symbol: item.chunk.symbol ?? "",
        heading: item.chunk.heading ?? "",
      });
      indexedIds.add(item.id);
    }

    await saveRecordBatch(batch);
    added += batch.length;
    onProgress?.(`Saved batch of ${batch.length} → ${indexedIds.size} total in DB`);
    pending = [];
  };

  for (const absolutePath of files) {
    const fileStat = await stat(absolutePath);
    if (fileStat.size > 500_000) continue;

    const content = await readFile(absolutePath, "utf-8");
    const relPath = relative(repoPath, absolutePath).split(sep).join("/");
    const chunks = chunkText(content, relPath);
    if (chunks.length === 0) continue;

    const docType = detectDocType(relPath);
    let fileSkipped = 0;

    for (const chunk of chunks) {
      const id = makeRecordId(relPath, chunk.startLine, chunk.endLine);
      if (indexedIds.has(id)) {
        skipped++;
        fileSkipped++;
        continue;
      }

      pending.push({ filePath: relPath, docType, chunk, id });

      if (pending.length >= batchSize) {
        onProgress?.(`Embedding batch of ${batchSize}...`);
        await flushBatch();
      }
    }

    const newChunks = chunks.length - fileSkipped;
    if (newChunks > 0 || fileSkipped < chunks.length) {
      onProgress?.(
        `Chunked ${relPath} (${chunks.length} chunks, ${fileSkipped} skipped, ${newChunks} new)`,
      );
    }
  }

  if (pending.length > 0) {
    onProgress?.(`Embedding final batch of ${pending.length}...`);
    await flushBatch();
  }

  return { added, skipped };
}
