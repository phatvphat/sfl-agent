import { config } from "../config.js";

type EmbedKind = "document" | "query";

function prefixText(text: string, kind: EmbedKind): string {
  const prefix = kind === "document" ? "search_document: " : "search_query: ";
  return `${prefix}${text}`;
}

export function truncateForEmbedding(text: string, maxChars = config.indexing.maxEmbedChars): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

interface OllamaEmbeddingsResponse {
  embedding: number[];
}

function isContextLengthError(status: number, body: string): boolean {
  return status === 500 && body.toLowerCase().includes("context length");
}

async function embedOne(prompt: string): Promise<number[]> {
  const limits = [
    config.indexing.maxEmbedChars,
    Math.floor(config.indexing.maxEmbedChars / 2),
    Math.floor(config.indexing.maxEmbedChars / 4),
  ];

  let lastError = "unknown error";

  for (const maxChars of limits) {
    const trimmed = truncateForEmbedding(prompt, maxChars);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await fetch(`${config.ollama.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.ollama.model,
          prompt: trimmed,
          // nomic-embed-text is ~2k tokens; large num_ctx wastes CPU/RAM on N100-class hosts
          options: { num_ctx: config.indexing.embedNumCtx },
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        const data = (await response.json()) as OllamaEmbeddingsResponse;
        if (data.embedding?.length) {
          return data.embedding;
        }
        lastError = "response missing embedding vector";
        continue;
      }

      const body = await response.text();
      lastError = body;

      if (!isContextLengthError(response.status, body)) {
        throw new Error(`Ollama embeddings failed (${response.status}): ${body}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Ollama embeddings timed out after 120s");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Ollama embeddings failed (500): ${lastError}`);
}

/**
 * Embed texts with limited concurrency.
 * Default concurrency=1: parallel embeds thrash weak CPUs (e.g. Intel N100) and are slower overall.
 */
export async function embedTexts(
  texts: string[],
  kind: EmbedKind = "document",
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const prompts = texts.map((t) => prefixText(t, kind));
  const concurrency = Math.max(1, config.indexing.embedConcurrency);
  const vectors: number[][] = new Array(prompts.length);

  let next = 0;
  async function worker() {
    while (next < prompts.length) {
      const i = next++;
      vectors[i] = await embedOne(prompts[i]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, prompts.length) }, () => worker()),
  );

  return vectors;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text], "query");
  return vector!;
}

export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${config.ollama.baseUrl}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}
