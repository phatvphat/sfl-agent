import { Cursor } from "@cursor/sdk";
import { createMemoryLocalAgentStore } from "./memory-local-agent-store.js";

export const localAgentStore = createMemoryLocalAgentStore();

Cursor.configure({
  local: {
    store: localAgentStore,
  },
});
