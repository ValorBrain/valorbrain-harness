# How the integrations talk to ValorBrain

The [README](../README.md) lists every integration and how to install it. This page is the contract
they share, so a new integration behaves like the others.

## Endpoints and credentials

| Surface | Hosted URL | Notes |
|---|---|---|
| REST | `https://valorbrain-api.valor.digital` | The live spec is `GET /openapi.json`; it wins over any page here |
| MCP (Streamable HTTP) | `https://mcpbrain.valor.digital/mcp` | OAuth with PKCE and dynamic client registration, or `Authorization: Bearer vbm_…` |

- One credential: a `vbm_` token (from `npx -y @valorbrain/cli@latest init --agent`, from the app's
  Settings → MCP tokens, or from OAuth). It works on REST and MCP. Legacy `vb_agent_` keys work on REST only.
- The tenant comes from the token. Never send `X-Tenant-ID`.
- Identify the integration with `User-Agent: valorbrain-<integration>/<version>`.
- Self-hosted or on-prem engines expose the same routes; integrations take the base URL as configuration.

## The calls the integrations use

| Need | Call |
|---|---|
| Context for the next model turn | `POST /api/v1/memory/prepare` `{message}` → `markdown` ready to inject |
| Per-prompt recall from a hook, no LLM | `POST /api/v1/hooks/cue` (the protocol of [`@valorbrain/connect`](https://github.com/ValorBrain/valorbrain-cli/tree/main/packages/connect)) |
| Save a memory | `POST /api/v1/memory/store` `{title, content, type?, tags?, collection?}` |
| Save a document with the time the event happened | `POST /documents` `{collection, path, content, event_at?}` (upsert by path) |
| Search | `POST /search` `{query, limit?, collection?}` |
| Forget | `POST /documents/{docid}/forget` |
| Close the quality loop | `POST /api/v1/memory/used` `{docids, verdict?}` |

Writes become searchable in a few seconds (embedding is asynchronous).

## Rules every integration follows

1. **Fail open.** A slow or failing ValorBrain never blocks or breaks the host: short timeouts, errors
   logged without the token, the turn goes on without memory.
2. **Say what leaves the machine.** The integration's README has a table: what is sent, when, and the
   switch that turns it off.
3. **Redact on the client.** Integrations that capture conversations automatically strip obvious secrets
   (API keys, tokens, `*_SECRET=`/`*_PASSWORD=` assignments, private keys) before sending, and never
   re-ingest the memory block they injected.
4. **The model never picks the identity or the scope.** Collection, user and tenant come from
   configuration set by a person, not from tool arguments the model fills.
5. **No credentials in the repository.** Tests read the engine URL and token from the environment.

## Tests

- Offline tests (no network) run in CI for every integration.
- Live tests run only when an engine URL and a token are set in the environment. They write a memory,
  wait until search finds it, read it back, and forget it.
- "Tested" in the README means a real run of the host software at that version, in an isolated home
  directory, against a ValorBrain engine.
