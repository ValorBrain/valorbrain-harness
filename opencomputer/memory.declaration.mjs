// The declaration from docs.opencomputer.dev/agents/memory-providers, pointed at the
// ValorBrain-backed endpoint, plus one read tool. Evaluated with the published
// @opencomputer/agent package to confirm it is accepted as written.
import { bearer, defineConnection, defineMemory, httpMemory, useSecret } from "@opencomputer/agent";

const connection = defineConnection({
  id: "memory-service",
  origin: "https://oc-memory.example.com", // wherever oc-memory-valorbrain.mjs is served
  methods: ["POST"],
  pathPrefix: "/oc-memory",
  headers: {
    Authorization: bearer(useSecret("MEMORY_TOKEN")),
  },
});

export const knowledge = defineMemory({
  id: "knowledge",
  description: "Verified facts needed in later sessions. Shared by every session bound to the same namespace.",
  provider: httpMemory({
    connection,
    path: "/oc-memory",
    maxBytes: 8_192,
    tools: [
      {
        name: "remember",
        description: "Save a verified fact. Visible to the next model request of any session bound to this namespace.",
        access: "write",
        idempotent: false,
        input: {
          type: "object",
          properties: { fact: { type: "string", maxLength: 2_000 } },
          required: ["fact"],
          additionalProperties: false,
        },
      },
      {
        name: "search",
        description: "Search the saved facts for something the recalled text did not include.",
        access: "read",
        input: {
          type: "object",
          properties: { query: { type: "string", maxLength: 500 } },
          required: ["query"],
          additionalProperties: false,
        },
      },
    ],
  }),
});

console.log(JSON.stringify(knowledge, null, 2));
