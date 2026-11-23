# ValorBrain for Dify

ValorBrain is persistent memory for AI agents. This tool plugin gives Dify Workflow, Chatflow and
Agent apps four tools that call the [ValorBrain REST API](https://docs.valorbrain.com.br):

| Tool | API call | What it does |
| --- | --- | --- |
| **Store memory** | `POST /api/v1/memory/store` | Saves one typed memory (note, decision, observation, problem, lesson, milestone, handoff). Searchable in about 4 seconds. |
| **Prepare context** | `POST /api/v1/memory/prepare` | Returns Markdown context for a message, ready to put in an LLM prompt. |
| **Search memory** | `POST /search` | Hybrid search (keyword + vector + rerank). Each result starts with its document ID, for example `[#3b60cf]`. |
| **Forget memory** | `POST /documents/{id}/forget` | Permanently removes one document. |

- Website: https://valorbrain.com.br
- Docs: https://docs.valorbrain.com.br
- Source code: https://github.com/ValorBrain/valorbrain-harness/tree/main/dify
- Tested with: Dify plugin SDK `dify_plugin` 0.9.1 and the Dify plugin CLI (dify-plugin-daemon)
  0.6.11, against ValorBrain engine 0.2.0 (`772df3cc`), on 2026-10-17.

## Before you start

You need a ValorBrain token. It starts with `vbm_` and decides the tenant: everything the plugin
reads or writes belongs to the tenant of that token. To create one for an agent without a browser:

```bash
npx -y @valorbrain/cli@latest init --agent --agent-caller dify --json
```

Use the `mcp_token` field of the answer. The legacy `vb_agent_` keys also work, since the plugin
only calls the REST API. Use a credential made for Dify, not a personal one: Store and
Forget act with the permissions of that token.

## Set up the plugin

1. Install **ValorBrain** from the Dify Marketplace, or upload the `.difypkg` file
   (**Plugins > Install plugin > Local package file**).
2. Open **Tools**, find **ValorBrain** and click **To authorize**.
3. In **Token**, paste the `vbm_` token.
4. Keep **API URL** at `https://valorbrain-api.valor.digital` unless you run your own ValorBrain
   engine. HTTPS is required; plain HTTP is accepted only for `localhost`, private-network
   addresses and single-label hosts such as a Docker Compose service name.
5. Click **Save**. Dify checks the token with `GET /api/v1/memory/health`, which reads only.

## Scope: the app builder sets it, not the model

Every tool has two builder settings (`form` parameters). The model never sees them and cannot
change them:

- **Scope**
  - **Token default**: writes go to the token's own collection; reads cover everything the token
    can see in its tenant.
  - **Collection field**: reads and writes use only **Collection**. In a Workflow or a Chatflow you
    can insert a variable there.
  - **Dify end user**: each person who runs the app gets a separate collection named
    `<Collection or dify-user>-<Dify user ID>`. This is the easy choice for a public Agent app:
    one user cannot read or forget another user's memory through the plugin.
- **Collection**: the collection name, or the prefix for the per-user collections.

With a **Collection field** or **Dify end user** scope, **Forget memory** first reads the document
and refuses to forget it when it belongs to another collection.

The model fills only the content of a call: title, content and type for Store; the message for
Prepare; the query for Search; the document ID for Forget.

## Use the tools

### Store memory

| Setting | Set by | Notes |
| --- | --- | --- |
| Title | model or workflow | Required, at least 5 characters. |
| Content | model or workflow | Required, at least 20 characters. |
| Type | model or workflow | `note` (default), `decision`, `observation`, `problem`, `lesson`, `milestone`, `handoff`. |
| Scope, Collection | builder | See above. |
| Tags | builder | Comma-separated. The plugin always adds `dify`. |
| Confidence | builder | Optional, 0 to 1. |
| Redact secrets | builder | On by default: obvious keys and tokens become `[redacted]` before sending. |
| Continue when ValorBrain is down | builder | On by default: a network error, timeout, 429 or 5xx returns "did not store" instead of failing the run. |

Output: a text message with the `docid` and the collection, and the JSON answer.

### Prepare context

| Setting | Set by | Notes |
| --- | --- | --- |
| Message | model or workflow | Required. In a Chatflow, insert `{{#sys.query#}}`. |
| Scope, Collection | builder | See above. |
| Recall budget | builder | Tokens for recalled memory, 64 to 2000. Default 600. |
| Fast mode | builder | On by default (about 0.2 s instead of 2 to 3 s on staging). |
| Continue when ValorBrain is down | builder | On by default: returns empty context instead of failing the run. |

Output: the Markdown context as text (put it in the LLM node prompt), and JSON with `markdown`,
`blocks`, `intent`, `recall_used`, `tokens_estimate` and `elapsed_ms`.

A typical Chatflow: **Start → ValorBrain Prepare context (Message = `{{#sys.query#}}`, Scope = Dify
end user) → LLM (context in the system prompt) → Answer**, with **Store memory** added to an Agent
node, or after the answer for the facts you want to keep.

### Search memory

| Setting | Set by | Notes |
| --- | --- | --- |
| Query | model or workflow | Required. |
| Scope, Collection | builder | See above. |
| Limit | builder | 1 to 50. Default 5. |
| Mode | builder | `auto` (default), `hybrid`, `keyword`, `semantic`. |

Output: a text list (`[#docid] title (type, date)` and a snippet per result) and the JSON answer.

### Forget memory

| Setting | Set by | Notes |
| --- | --- | --- |
| Document ID | model or workflow | `#3b60cf` (from Search) or `319816` (from Store). |
| Scope, Collection | builder | Limits which documents can be forgotten. |

## What leaves the machine, and when

Only when a tool runs or when you save the credentials. Nothing runs in the background.

| When | Sent to the API URL |
| --- | --- |
| Saving credentials | `GET /api/v1/memory/health` with the token. Nothing is written. |
| Store memory | Title, content (after redaction), type, tags, confidence, collection. |
| Prepare context | Message, collection, recall budget, fast mode. |
| Search memory | Query, collection, limit, mode. |
| Forget memory | The document ID (plus a `GET /documents/{id}` first with a collection scope). |

Every request carries `Authorization: Bearer <token>` and `User-Agent: valorbrain-dify/0.1.0`. No
tenant header, no telemetry, no logs of inputs or outputs. Redirects are not followed. Timeouts:
60 s per request, 10 s to connect; a 429 or 503 is retried at most twice, only when `Retry-After`
is 10 s or less. See [PRIVACY.md](PRIVACY.md).

## Turn it off

Remove a tool from the app, or delete the credentials under **Tools > ValorBrain**, or uninstall
the plugin under **Plugins**. To revoke access entirely, revoke the token in ValorBrain.

## Develop and test

The live checks read `VB_STAGING_URL` (for example `http://127.0.0.1:7439`) and
`VB_STAGING_MCP_TOKEN` (a `vbm_` credential of a disposable test tenant) from the environment.
Keep them in a file only you can read (`chmod 600 staging.env`) and load it in the same command.

```bash
uv venv -p 3.12 /tmp/vb-dify/venv && . /tmp/vb-dify/venv/bin/activate
uv pip install -r requirements.txt pytest pyyaml
python -m pytest -q                       # offline: fake HTTP transport, no network
(set -a; . ./staging.env; set +a; python -m pytest -q tests/test_live.py)  # store, wait, search, prepare, forget
```

The live test refuses production hosts and cleans up what it creates.

Package and run the plugin in the official Dify plugin runtime, without a full Dify install
(Dify plugin CLI from https://github.com/langgenius/dify-plugin-daemon/releases):

```bash
dify plugin package ./dify -o valorbrain-0.1.0.difypkg
(set -a; . ./staging.env; set +a; \
  python dify/scripts/daemon_check.py --cli "$(command -v dify)" --package valorbrain-0.1.0.difypkg)
```

For remote debugging against a Dify workspace, copy `.env.example` to `.env`, fill it in from
**Plugins > Debug**, and run `python -m main`.

## License

MIT. See [LICENSE](LICENSE).
