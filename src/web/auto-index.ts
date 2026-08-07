import { config } from "../config.js";
import { indexRepository } from "../indexer/index.js";

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function runIndexOnce(reason: string): Promise<void> {
  if (running) {
    console.log(`[auto-index] skip (${reason}): previous run still in progress`);
    return;
  }

  running = true;
  console.log(`[auto-index] start (${reason})`);
  try {
    await indexRepository((msg) => console.log(`[auto-index] ${msg}`));
  } catch (error) {
    console.error(
      "[auto-index] failed:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    running = false;
  }
}

/**
 * Background incremental index while the web server is up.
 * Skips overlapping runs (same role as flock in crontab).
 */
export function startAutoIndex(): void {
  if (!config.web.autoIndex) {
    console.log("[auto-index] disabled (WEB_AUTO_INDEX=false)");
    return;
  }

  const intervalMs = config.web.autoIndexIntervalMs;
  console.log(
    `[auto-index] enabled — first run soon, then every ${Math.round(intervalMs / 60_000)} min`,
  );

  // Don't block listen(); give the HTTP server a moment to come up.
  setTimeout(() => {
    void runIndexOnce("startup");
  }, 3_000);

  timer = setInterval(() => {
    void runIndexOnce("interval");
  }, intervalMs);

  // Allow process to exit on SIGINT even if interval is pending.
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}

export function stopAutoIndex(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
