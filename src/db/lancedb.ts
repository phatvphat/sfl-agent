import * as lancedb from "@lancedb/lancedb";
import { config, type KnowledgeRecord } from "../config.js";
import { embedQuery } from "../embeddings/ollama.js";

export interface SearchResult {
  id: string;
  text: string;
  filePath: string;
  startLine: number;
  endLine: number;
  docType: string;
  symbol?: string;
  heading?: string;
  score: number;
}

let dbPromise: Promise<lancedb.Connection> | null = null;

/** LanceDB infers schema from first batch — all rows must share the same fields. */
function normalizeRecord(record: KnowledgeRecord): Record<string, unknown> {
  return {
    id: record.id,
    text: record.text,
    vector: record.vector,
    filePath: record.filePath,
    startLine: record.startLine,
    endLine: record.endLine,
    docType: record.docType,
    symbol: record.symbol ?? "",
    heading: record.heading ?? "",
  };
}

function normalizeRecords(records: KnowledgeRecord[]): Record<string, unknown>[] {
  return records.map(normalizeRecord);
}

async function getDb(): Promise<lancedb.Connection> {
  if (!dbPromise) {
    dbPromise = lancedb.connect(config.lancedb.path);
  }
  return dbPromise;
}

export async function openTable() {
  const db = await getDb();
  const names = await db.tableNames();

  if (!names.includes(config.lancedb.tableName)) {
    return null;
  }

  return db.openTable(config.lancedb.tableName);
}

export async function createOrReplaceTable(records: KnowledgeRecord[]) {
  const db = await getDb();
  const names = await db.tableNames();

  if (names.includes(config.lancedb.tableName)) {
    await db.dropTable(config.lancedb.tableName);
  }

  if (records.length === 0) {
    throw new Error("Cannot create table with zero records");
  }

  return db.createTable(config.lancedb.tableName, normalizeRecords(records));
}

export async function dropIndexTable(): Promise<void> {
  const db = await getDb();
  const names = await db.tableNames();
  if (names.includes(config.lancedb.tableName)) {
    await db.dropTable(config.lancedb.tableName);
  }
  dbPromise = null;
}

export async function getIndexedIds(): Promise<Set<string>> {
  const table = await openTable();
  if (!table) return new Set();

  const rows = await table.query().select(["id"]).toArray();
  return new Set(rows.map((row) => String(row.id)));
}

export async function saveRecordBatch(records: KnowledgeRecord[]): Promise<void> {
  if (records.length === 0) return;

  const table = await openTable();
  if (!table) {
    await createOrReplaceTable(records);
    return;
  }

  await table.add(normalizeRecords(records));
}

export async function searchKnowledge(
  query: string,
  options: { limit?: number; docType?: string; filePath?: string } = {},
): Promise<SearchResult[]> {
  const table = await openTable();

  if (!table) {
    return [];
  }

  const vector = await embedQuery(query);
  const limit = options.limit ?? 8;

  const mapRows = (rows: Record<string, unknown>[]) =>
    rows.map((row) => ({
      id: String(row.id),
      text: String(row.text),
      filePath: String(row.filePath),
      startLine: Number(row.startLine),
      endLine: Number(row.endLine),
      docType: String(row.docType),
      symbol: row.symbol ? String(row.symbol) : undefined,
      heading: row.heading ? String(row.heading) : undefined,
      score: typeof row._distance === "number" ? 1 - row._distance : 0,
    }));

  const applyMemoryFilters = (rows: Record<string, unknown>[]) => {
    let filtered = rows;
    if (options.docType) {
      filtered = filtered.filter((row) => String(row.docType) === options.docType);
    }
    if (options.filePath) {
      const needle = options.filePath.toLowerCase();
      filtered = filtered.filter((row) =>
        String(row.filePath).toLowerCase().includes(needle),
      );
    }
    return filtered.slice(0, limit);
  };

  let search = table.vectorSearch(vector).limit(limit);

  const filters: string[] = [];
  if (options.docType) {
    filters.push(`"docType" = '${options.docType.replace(/'/g, "''")}'`);
  }
  if (options.filePath) {
    const escaped = options.filePath.replace(/'/g, "''");
    filters.push(`"filePath" LIKE '%${escaped}%'`);
  }

  if (filters.length > 0) {
    try {
      const rows = await search.where(filters.join(" AND ")).toArray();
      if (rows.length > 0) {
        return mapRows(rows);
      }
    } catch {
      // Fall through to in-memory filtering below.
    }

    const rows = await table.vectorSearch(vector).limit(Math.max(limit * 4, 32)).toArray();
    return mapRows(applyMemoryFilters(rows));
  }

  const rows = await search.toArray();
  return mapRows(rows);
}

export async function getRecordCount(): Promise<number> {
  const table = await openTable();
  if (!table) return 0;
  return table.countRows();
}

export const NFT_API_FILE_PREFIX = "api/sfl.world/nfts/";

export async function deleteRecordsByFilePathPrefix(prefix: string): Promise<void> {
  const table = await openTable();
  if (!table) return;

  const escaped = prefix.replace(/'/g, "''");
  await table.delete(`"filePath" LIKE '${escaped}%'`);
}
