# n8n-nodes-valorbrain

An [n8n](https://n8n.io) community node for [ValorBrain](https://valorbrain.com.br), durable memory
for AI agents. Store memories, write dated documents, prepare context for a prompt, search and
forget, from any workflow or as a tool of the n8n **AI Agent** node.

- Node: **ValorBrain** (resource Memory, five operations), `usableAsTool: true`.
- Credential: **ValorBrain API** (token `vbm_…`, API URL).
- No runtime dependency. Requests go through n8n's own HTTP helper.

## Install

**n8n UI (self-hosted, owner account):** Settings > Community Nodes > Install, enter
`n8n-nodes-valorbrain`, accept the risk prompt. After n8n verifies the package, it also shows in the
nodes panel, n8n Cloud included.

**Manual (self-hosted, Docker or npm):**

```bash
cd ~/.n8n/nodes          # create it if it does not exist
npm install n8n-nodes-valorbrain
# restart n8n
```

## Credential

Create a **ValorBrain API** credential:

| Field | Value |
| --- | --- |
| Token | A `vbm_…` token. Create one in the ValorBrain app (Settings > MCP tokens), or run `npx -y @valorbrain/cli@latest init --agent --agent-caller n8n --json` and use `mcp_token`. A legacy `vb_agent_…` key also works on these REST routes. |
| API URL | `https://valorbrain-api.valor.digital` (default). Change it only for a self-hosted or staging engine. |

The token chooses the tenant. The node never sends a tenant header. **Test** on the credential runs
`GET /documents?pattern=n8n-credential-test`: it reads no content, writes nothing, and answers 401
for a bad token.

## Operations

| Operation | Route | What it does |
| --- | --- | --- |
| Store Memory | `POST /api/v1/memory/store` | A typed memory (`note`, `decision`, `observation`, `problem`, `milestone`, `handoff`, `lesson`) with title (≥ 5 chars), content (≥ 20 chars), tags, collection, confidence. |
| Write Document | `POST /documents` | Create or update a document by `collection` + `path`. **Occurred At** sends `event_at`, the time the fact happened (ISO 8601 with a zone, e.g. `{{ $now.toISO() }}`). Also title, content type, event type, metadata JSON, user ID, run ID. |
| Prepare Context | `POST /api/v1/memory/prepare` | The memory relevant to a message, as `markdown` ready to put in a system prompt, plus `blocks`, `intent`, `tokens_estimate`. Options: collection, recall budget, fast mode, include recall, episode ID. |
| Search | `POST /search` | Hybrid search (BM25 + vectors + rerank). Options: limit, collection(s), mode, profile, order (relevance or event time). |
| Forget | `POST /documents/{docid}/forget` | Deactivate one document by the `docid` the other operations return. It stops showing in search and context. |

Every operation returns the API response as the item JSON. With **Continue On Fail**, an error
becomes `{ "error": "…" }` and the workflow goes on.

Store Memory answers with the numeric document ID in `docid` (for example `319859`); Write Document
and Search answer with the short hash (for example `59b69f`). Forget accepts both.

New writes become searchable after a few seconds (embedding runs in the background).

### As a tool of the AI Agent

Connect the ValorBrain node to the **Tool** input of an AI Agent. Let the model fill only the text
it should choose, with `$fromAI()`, for example the search query:

```
{{ $fromAI('query', 'The words to look up in memory', 'string') }}
```

Set the **User ID**, the collection and anything that decides *whose* memory is read or written
from the trigger or the user record, never from the model. The token already fixes the tenant.

## Examples

- [`examples/ai-agent-with-memory.json`](./examples/ai-agent-with-memory.json): a webhook chat that
  prepares context, gives the agent Search as a tool, and writes the exchange back as a dated
  document.
- [`examples/write-search-forget.json`](./examples/write-search-forget.json): write a dated
  document, wait, search it, forget it. A quick end-to-end check of a credential.

Import them with Workflows > Import from File, then pick your credential on each ValorBrain node.

## What leaves your machine, and when

The node sends a request only when a workflow runs one of its operations (or when you click
**Test** on the credential). Each request goes to the API URL of the credential with
`Authorization: Bearer <token>` and `User-Agent: valorbrain-n8n/<version>`, and carries only the
fields of that operation:

- Store Memory: title, content, and the type, tags, collection and confidence you set.
- Write Document: collection, path, content, and the optional fields you set.
- Prepare Context: the message and the options you set.
- Search: the query and the options you set.
- Forget: the docid in the URL, no body.

The node captures nothing by itself: no conversation, no execution data, no telemetry. Whatever
you map into a field is what is sent. Do not map secrets into content.

## Turn it off

Disable or delete the ValorBrain nodes in your workflows, or delete the credential. To remove the
package: Settings > Community Nodes > Uninstall (or `npm uninstall n8n-nodes-valorbrain` in
`~/.n8n/nodes` and restart n8n). To revoke access, revoke the token in the ValorBrain app.

## Tested with

- n8n 2.43.7 (self-hosted, `n8n execute` of `examples/write-search-forget.json`), Node.js 24.
- `@n8n/node-cli` 0.52.5 (build and strict lint), `n8n-workflow` 2.16.0.
- ValorBrain engine 772df3cc (staging, 17 Oct 2026).

## Development

```bash
npm ci
npm run build
npm run lint          # n8n-node lint, strict mode (the rules of verified community nodes)
npm test              # build + offline tests (fake n8n context, no network)
npm run scan          # the static checks of @n8n/scan-community-package, offline
```

Live test against a staging or throwaway tenant (skipped unless both variables are set; the token
is read from the environment only):

```bash
VB_LIVE_URL=http://127.0.0.1:7439 VB_LIVE_TOKEN=vbm_… npm run test:live
```

It runs the node's operations with real HTTP: store a memory, write a dated document, wait until
search finds both, prepare context, forget both, check that search no longer finds them.

End to end in a real n8n, isolated (throwaway `HOME` and `N8N_USER_FOLDER`, package installed from
`npm pack` into `.n8n/nodes`, headless `n8n execute` of `examples/write-search-forget.json`):

```bash
N8N_BIN=/path/to/node_modules/.bin/n8n VB_LIVE_URL=http://127.0.0.1:7439 VB_LIVE_TOKEN=vbm_… \
  scripts/n8n-smoke.sh
```

Keep `VERSION` in `nodes/ValorBrain/GenericFunctions.ts` equal to `version` in `package.json`; a
test checks it. Publishing steps: [`PUBLISHING.md`](./PUBLISHING.md).

## License

MIT, see [LICENSE](./LICENSE).
