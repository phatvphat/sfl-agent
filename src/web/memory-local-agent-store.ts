import { composeLocalAgentStore, type LocalAgentStore } from "@cursor/sdk";
import type {
  LocalAgentAgentFilter,
  LocalAgentCheckpointFilter,
  LocalAgentDocument,
  LocalAgentListFilter,
  LocalAgentRunDocument,
  LocalAgentRunEventDocument,
  LocalAgentRunEventFilter,
  LocalAgentRunEventListResult,
  LocalAgentRunFilter,
  LocalAgentStoreAgents,
  LocalAgentStoreCheckpoints,
  LocalAgentStoreListResult,
  LocalAgentStoreRunEvents,
  LocalAgentStoreRuns,
} from "@cursor/sdk";

function checkpointKey(agentId: string, blobId: string): string {
  return `${agentId}\0${blobId}`;
}

function runKey(agentId: string, runId: string): string {
  return `${agentId}\0${runId}`;
}

function matchesAgentIds(
  id: string,
  agentIds: readonly string[] | undefined,
): boolean {
  return !agentIds || agentIds.length === 0 || agentIds.includes(id);
}

function pageItems<T>(
  items: readonly T[],
  limit = items.length,
  cursor?: string,
): LocalAgentStoreListResult<T> {
  const start = cursor ? Number.parseInt(cursor, 10) : 0;
  const safeStart = Number.isFinite(start) && start >= 0 ? start : 0;
  const page = items.slice(safeStart, safeStart + limit);
  const nextIndex = safeStart + page.length;
  return {
    items: page,
    nextCursor: nextIndex < items.length ? String(nextIndex) : undefined,
  };
}

function createAgentsStore(agents: Map<string, LocalAgentDocument>): LocalAgentStoreAgents {
  return {
    async get({ agentId }) {
      return agents.get(agentId) ?? null;
    },
    async create({ agent }) {
      agents.set(agent.agentId, agent);
      return agent;
    },
    async update({ agent }) {
      agents.set(agent.agentId, agent);
      return agent;
    },
    async delete({ filter }) {
      for (const [id] of agents) {
        if (matchesAgentFilter(id, filter)) {
          agents.delete(id);
        }
      }
    },
    async list({ filter } = {}) {
      const items = [...agents.values()]
        .filter((agent) => !filter?.cwd || agent.cwd === filter.cwd)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return pageItems(items, filter?.limit, filter?.cursor);
    },
  };
}

function matchesAgentFilter(agentId: string, filter: LocalAgentAgentFilter): boolean {
  return matchesAgentIds(agentId, filter.agentIds);
}

function createCheckpointsStore(
  blobs: Map<string, Uint8Array>,
): LocalAgentStoreCheckpoints {
  return {
    async get({ agentId, blobId }) {
      return blobs.get(checkpointKey(agentId, blobId)) ?? null;
    },
    async create({ agentId, blobId, data }) {
      blobs.set(checkpointKey(agentId, blobId), data);
    },
    async update({ agentId, blobId, data }) {
      blobs.set(checkpointKey(agentId, blobId), data);
    },
    async delete({ filter }) {
      for (const key of blobs.keys()) {
        const [agentId, blobId] = key.split("\0");
        if (!agentId || !blobId) continue;
        if (!matchesCheckpointFilter(agentId, blobId, filter)) continue;
        blobs.delete(key);
      }
    },
    async list({ filter } = {}) {
      const items = [...blobs.keys()]
        .map((key) => {
          const [agentId, blobId] = key.split("\0");
          return agentId && blobId ? { agentId, blobId } : null;
        })
        .filter((entry): entry is { agentId: string; blobId: string } => entry !== null)
        .filter(({ agentId, blobId }) => matchesCheckpointFilter(agentId, blobId, filter))
        .map(({ blobId }) => blobId);
      return pageItems(items, filter?.limit, filter?.cursor);
    },
  };
}

function matchesCheckpointFilter(
  agentId: string,
  blobId: string,
  filter?: LocalAgentCheckpointFilter,
): boolean {
  if (!filter) return true;
  if (filter.agentIds?.length && !filter.agentIds.includes(agentId)) return false;
  if (filter.blobIds?.length && !filter.blobIds.includes(blobId)) return false;
  return true;
}

function createRunsStore(runs: Map<string, LocalAgentRunDocument>): LocalAgentStoreRuns {
  return {
    async get({ agentId, runId }) {
      return runs.get(runKey(agentId, runId)) ?? null;
    },
    async create({ run }) {
      runs.set(runKey(run.agentId, run.runId), run);
      return run;
    },
    async update({ run }) {
      runs.set(runKey(run.agentId, run.runId), run);
      return run;
    },
    async delete({ filter }) {
      for (const [key, run] of runs) {
        if (matchesRunFilter(run, filter)) {
          runs.delete(key);
        }
      }
    },
    async list({ filter } = {}) {
      const items = [...runs.values()]
        .filter((run) => matchesRunFilter(run, filter))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return pageItems(items, filter?.limit, filter?.cursor);
    },
  };
}

function matchesRunFilter(
  run: LocalAgentRunDocument,
  filter?: LocalAgentRunFilter,
): boolean {
  if (!filter) return true;
  if (filter.agentIds?.length && !filter.agentIds.includes(run.agentId)) return false;
  if (filter.runIds?.length && !filter.runIds.includes(run.runId)) return false;
  return true;
}

/** Discard stream events — web chat reads the live stream only. */
function createDiscardingRunEventsStore(): LocalAgentStoreRunEvents {
  let seq = 0;
  return {
    async append(input) {
      seq += 1;
      const doc: LocalAgentRunEventDocument = {
        runId: input.runId,
        seq,
        offset: String(seq),
        eventType: input.eventType,
        payload: input.payload ?? null,
        payloadRef: input.payloadRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: Date.now(),
      };
      return doc;
    },
    async list(): Promise<LocalAgentRunEventListResult> {
      return { items: [] };
    },
    async delete(_input: { readonly filter: LocalAgentRunEventFilter }) {},
  };
}

/**
 * In-process SDK store: keeps one shared agent's conversation in RAM while
 * `pnpm web` runs. Nothing is written under data/cursor-agents/.
 */
export function createMemoryLocalAgentStore(): LocalAgentStore {
  const agents = new Map<string, LocalAgentDocument>();
  const checkpoints = new Map<string, Uint8Array>();
  const runs = new Map<string, LocalAgentRunDocument>();

  return composeLocalAgentStore({
    agents: createAgentsStore(agents),
    checkpoints: createCheckpointsStore(checkpoints),
    runs: createRunsStore(runs),
    runEvents: createDiscardingRunEventsStore(),
  });
}

export async function purgeFinishedRun(
  store: LocalAgentStore,
  agentId: string,
  runId: string,
): Promise<void> {
  await store.runs.delete({
    filter: { agentIds: [agentId], runIds: [runId] },
  });
  await store.runEvents.delete({
    filter: { runIds: [runId] },
  });
}

/** Drop all SDK store rows for an agent (checkpoints hold conversation bytes). */
export async function purgeAgent(
  store: LocalAgentStore,
  agentId: string,
): Promise<void> {
  await store.runs.delete({ filter: { agentIds: [agentId] } });
  await store.runEvents.delete({ filter: {} });
  await store.checkpoints.delete({ filter: { agentIds: [agentId] } });
  await store.agents.delete({ filter: { agentIds: [agentId] } });
}
