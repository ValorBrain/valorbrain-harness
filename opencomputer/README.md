# ValorBrain as an OpenComputer memory provider

[OpenComputer](https://github.com/diggerhq/opencomputer) lets an agent declare a memory whose storage is an HTTP endpoint you run (`httpMemory`, see [memory providers](https://docs.opencomputer.dev/agents/memory-providers)). This directory has that endpoint, backed by ValorBrain: one file, no dependencies, Node 18 or newer.

`httpMemory` is a **contract preview** in `@opencomputer/agent` 0.9.1: the declaration compiles, and OpenComputer does not call the endpoint yet. So what is tested here is the provider side of the contract, with the request bodies from their docs page. Nothing here has run inside an OpenComputer session.

## What is in here

| File | What it is |
|---|---|
| [`oc-memory-valorbrain.mjs`](oc-memory-valorbrain.mjs) | The endpoint. `POST /oc-memory`, protocol version 1: `recall`, and the tools `remember` (write) and `search` (read). |
| [`memory.declaration.mjs`](memory.declaration.mjs) | The `defineConnection` / `defineMemory` / `httpMemory` declaration from their docs, pointed at this endpoint, with the two tools. |
| [`test/run-contract.mjs`](test/run-contract.mjs) | 13 checks against a running endpoint, printing every request, response and latency. |
| [`test/read-after-write.mjs`](test/read-after-write.mjs) | How soon after `stored` a recall sees the fact, over 8 fresh partitions. |
| [`test/offline.test.mjs`](test/offline.test.mjs) | The same checks against an in-memory stand-in for ValorBrain. Runs in CI. |
| [`runs/2026-11-27/`](runs/2026-11-27/) | Output of the three scripts against the hosted ValorBrain server. |

## Run it

```bash
npx -y @valorbrain/cli@latest init --agent --agent-caller opencomputer --json   # prints mcp_token (vbm_…)

OC_MEMORY_TOKEN=<what OpenComputer will send as bearer> \
VALORBRAIN_MCP_TOKEN=vbm_... \
node oc-memory-valorbrain.mjs          # http://127.0.0.1:8787/oc-memory

# in another shell
OC_MEMORY_TOKEN=<same value> node test/run-contract.mjs
```

`PORT` and `OC_MEMORY_PATH` change where it listens. Serve it over HTTPS at the `origin` and `pathPrefix` of your `defineConnection`, and keep `OC_MEMORY_TOKEN` equal to the secret the connection sends.

To check the declaration against their package: `npm install && npm run declaration`.

## How the contract maps to ValorBrain

| OpenComputer | Here |
|---|---|
| `partition` | One ValorBrain collection per partition: `oc-` plus the first 24 hex characters of its SHA-256. Another partition never sees the facts. |
| `recall` | `memory_retrieve` on that collection with `input.text` as the query. `text` is one line per fact; `sources` are the documents behind them (`id`, `title`, `revision`, `updatedAt`). |
| `maxBytes` | The text is cut on a fact boundary, never inside a fact, and `sources` lists only the facts that fit. |
| `input.text: null` | A keyword search for the partition's facts instead of a failure. |
| `tool` `remember` | `memory_store`. Returns `{ status: "stored", id }`. Refused with 403 on a read-only binding. |
| `tool` `search` | `memory_retrieve` with the model's query. Allowed on a read-only binding. |
| `operationId` | A repeated `(partition, operationId)` replays the first result without writing again. The same id with different arguments gets 409. |
| `deadlineAt` | An expired deadline is refused before storage is touched. The upstream call is aborted 150 ms before the deadline and answered with 504. |
| `cursor` | A hash of the facts returned, so it changes when the recalled set changes. |

## Measured on 2026-11-27

Against `https://mcpbrain.valor.digital/mcp` (server 1.1.0), from a desktop in southern Brazil, with a new free account:

- **Contract:** 13 of 13 checks pass. Full exchange in [`runs/2026-11-27/run-output.txt`](runs/2026-11-27/run-output.txt).
- **Declaration:** `@opencomputer/agent` 0.9.1 accepts it as written. What it returns is in [`declaration-output.json`](runs/2026-11-27/declaration-output.json).
- **Read after write:** in 8 of 8 fresh partitions the first recall sent after `stored` already had the fact, so `stored` is the honest status and `accepted` is not needed.
- **Latency through the endpoint:** recall 131 to 270 ms over 10 warm calls (median 234 ms), `remember` 72 ms median, `search` 465 ms on its one call. This is one machine far from the server, so read it as an order of magnitude.

## Limits

- **Idempotency lives in the process.** The `(partition, operationId)` map is in memory and is swept at `deadlineAt`. A restart between a write and its retry stores the fact twice. A deployment with more than one instance needs that map in shared storage.
- **The partition is not checked against the caller.** The endpoint trusts the bearer and takes the partition from the body, as the contract describes. One token for many owners means the endpoint cannot tell whether a caller may use a given partition.
- **Recall ranks on the current input text only.** A fact that matters to the session and shares no meaning with the last message can be left out. That is what the `search` tool is for.
- **No `forget` tool.** Facts are removed in ValorBrain (dashboard, or the `memory_forget` MCP tool).

## What leaves your machine

| When | What goes to ValorBrain |
|---|---|
| `recall` | The partition's collection name (a hash) and `input.text` as the search query. |
| `remember` | The fact's text, stored in that collection. |
| `search` | The model's query. |

Nothing else is sent, and nothing is captured automatically. To stop, stop the process.

## Tests

```bash
node --test opencomputer/test/offline.test.mjs
```
