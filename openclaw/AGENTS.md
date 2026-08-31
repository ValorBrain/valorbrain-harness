# src/openclaw/ + src/openclaw-remote/ — OpenClaw integration

Two modes of connecting ValorBrain to the OpenClaw assistant framework:

## openclaw/ (in-process plugin)

`openclaw.plugin.json` declares the plugin kind (`memory`), capabilities
(`hook`, `tool`), and UI hints (token budget, profile speed/balanced/deep).
Loaded directly by the OpenClaw runtime when it shares a process with
ValorBrain.

## openclaw-remote/ (HTTP client)

When OpenClaw runs as a separate process (the common production setup), it
talks to ValorBrain via HTTP. This directory contains the TypeScript client
library that OpenClaw imports.

### Key files

| File | Responsibility |
|---|---|
| `tools.ts` | `VBConfig` type + `createTools()` factory. The config now includes `sourceAgent`/`sourceSystem` for provenance (E11). |
| `client.ts` | REST client: `buildHeaders()`, fetch wrappers. All requests carry `X-Source-Agent` from config. |
| `queue.ts` | Batched/queued requests for high-volume operations (e.g. processing a conversation backlog). Same header contract as `client.ts`. |
| `user-context.ts` | Resolves OpenClaw user → ValorBrain user_id via inline map or DB lookup. |

### Provenance

Every request from this client carries `X-Source-Agent: ${cfg.sourceAgent ?? 'openclaw-plugin'}`.
Set `cfg.sourceAgent` to the actual agent name (e.g. `'moltgus'`,
`'helena-bot'`) so audit trails are accurate. See
`docs/AGENT_PROVENANCE.md`.

### Pitfalls

- **Token budget** — the plugin respects `cfg.tokenBudget`. Don't request
  more memories than the budget allows; the client truncates.
- **Per-user vs shared** — `cfg.userIdentityMode` controls whether requests
  carry `X-User-ID` (per-user isolation) or are tenant-wide (shared brain).
  Default is `shared`.
