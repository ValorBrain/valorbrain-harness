# ValorBrain for Open WebUI

Long-term memory for [Open WebUI](https://github.com/open-webui/open-webui). Two plugins, each a single
Python file with no extra dependencies:

| File | Open WebUI type | What it does |
| --- | --- | --- |
| `valorbrain_memory_filter.py` | Function → Filter | Before each turn, recalls the ValorBrain context that fits the user's message and adds it as a system message. After each turn, saves the question and answer to ValorBrain. |
| `valorbrain_memory_tool.py` | Tool (optional) | Gives the model two tools: `search_memory` and `remember`, for explicit lookups and saves. |

Both talk to the ValorBrain REST API with a bearer token. A ValorBrain error (network, auth, timeout) never
breaks a chat: the filter logs a warning and lets the turn through unchanged; the tool returns a short error
text to the model.

Prefer MCP? Open WebUI can also connect to the ValorBrain MCP server directly (External Tool Servers, or via
mcpo); see [`../mcp/clients/open-webui/`](../mcp/clients/open-webui/). That gives the model the full ValorBrain
tool set but no automatic recall or capture; the filter here adds those.

## Install

You need Open WebUI 0.9 or later and admin rights (Functions are admin-only).

**Filter**

1. Admin Panel → Functions → **Import from URL**, paste
   `https://github.com/ValorBrain/valorbrain-harness/blob/main/open-webui/valorbrain_memory_filter.py`
   (or click **+** and paste the file), read the code, **Save**.
2. Open the function's **Valves** and set `api_token` (see below). Keep `api_url` at
   `https://valorbrain-api.valor.digital` unless you run your own ValorBrain.
3. Turn the function on, then either make it **Global** (all models) or attach it to specific models in
   Admin Panel → Settings → Models → *model* → **Filters**.

**Tool (optional)**

1. Workspace → Tools → **Import from URL** with
   `https://github.com/ValorBrain/valorbrain-harness/blob/main/open-webui/valorbrain_memory_tool.py`, **Save**.
2. Set its Valves, then enable it on the models that should use it (Workspace → Models → *model* → Tools).
   Works best with native function calling.

## Get a token

```bash
npx -y @valorbrain/cli@latest init --agent --agent-caller open-webui --json
```

Use the `mcp_token` (`vbm_...`) from the output; a legacy `vb_agent_...` key also works. The token decides the
tenant and the default collection, so no tenant header is sent.

Each user can also paste a personal token in the plugin's **User Valves** (chat → Controls → Valves). A
personal token wins over the admin one, so one Open WebUI server can serve several ValorBrain users.

> On a multi-user server the admin token is one shared memory: every user without a personal token reads and
> writes the same ValorBrain memory. If users must not see each other's memory, turn on `require_user_token`
> (filter and tool) so the plugins act only for users who set their own token.

## Configure

Filter valves (admin):

| Valve | Default | Meaning |
| --- | --- | --- |
| `api_url` | `https://valorbrain-api.valor.digital` | ValorBrain REST base URL |
| `api_token` | empty | Token; nothing is sent while it is empty |
| `collection` | empty | Collection for recall and capture; empty = the token's agent collection |
| `recall_enabled` / `capture_enabled` | on / on | Turn each half on or off for everyone |
| `recall_budget` | 1200 | Token budget ValorBrain may spend assembling context |
| `max_context_chars` | 6000 | Hard cap on injected characters |
| `fast_mode` | off | Lighter, faster recall |
| `max_capture_chars` | 8000 | Cap per side (question, answer) when saving |
| `min_capture_chars` | 20 | Skip trivial turns |
| `capture_unsaved_chats` | off | Also save temporary and channel chats |
| `timeout_seconds` | 8 | Per-call timeout |
| `show_status` | off | Show "ValorBrain: memory recalled" in the chat |
| `require_user_token` | off | Act only for users who set their own token |

User valves: `recall_enabled`, `capture_enabled`, `api_token`. A user can switch either half off for
themselves; the admin switch still wins.

Tool valves: `api_url`, `api_token`, `collection`, `max_results` (8), `require_user_token`, `timeout_seconds`;
user valve `api_token`.

## What leaves the machine, and when

Everything goes from the Open WebUI server to `api_url` over HTTP(S) with `Authorization: Bearer <token>` and
`User-Agent: valorbrain-openwebui/<version>`. Nothing is sent while no token is set.

| When | Request | What is sent |
| --- | --- | --- |
| A user sends a message (filter `inlet`, recall on) | `POST /api/v1/memory/prepare` | The text of the user's last message (secrets redacted, at most 4000 chars), the recall budget, the collection if set |
| A reply finishes (filter `outlet`, capture on) | `POST /api/v1/memory/store` | That user message and the assistant reply (secrets redacted, injected context removed, each side capped), the model id, tags `open-webui`, `conversation` |
| The model calls `search_memory` | `POST /search` | The query (secrets redacted) |
| The model calls `remember` | `POST /api/v1/memory/store` | The title and content the model chose (secrets redacted), tags `open-webui`, `explicit` |

Not sent: earlier messages of the chat, attached files and images, user name, email or Open WebUI ids, chat
titles. Background tasks (title, tags, follow-up generation) are skipped. Temporary chats and channel threads
are not captured unless `capture_unsaved_chats` is on.

The recalled context is wrapped in `<valorbrain-context source="open-webui">…</valorbrain-context>` and labeled as
reference data, not instructions. Before saving, every such block is stripped, so recalled memory is never
written back as if it were new conversation.

Redaction is client-side and conservative: private keys, GitHub/GitLab/OpenAI/Anthropic/OpenRouter/Slack/
Stripe/AWS/Cloudflare/ValorBrain tokens, JWTs, `Bearer` values, passwords inside URLs and `NAME=value`
assignments whose name says secret/password/token/key. It catches the obvious shapes, not every secret.

## Turn it off

- One user: User Valves → `recall_enabled` / `capture_enabled` off.
- Everyone: Valves → `recall_enabled` / `capture_enabled` off, or switch the function off in Admin Panel →
  Functions. Removing the function removes all calls.
- Forget something already saved: ask the model to find it with `search_memory`, then remove it in ValorBrain
  (`POST /documents/{docid}/forget`, or the `memory_forget` MCP tool).

## Tested with

- Open WebUI **v0.12.3** plugin contract: loader (`backend/open_webui/utils/plugin.py`) and filter dispatcher
  (`backend/open_webui/utils/filter.py`), with inlet/outlet bodies shaped as in `utils/middleware.py`.
- Python 3.11, pydantic 2.
- ValorBrain staging engine (2026-10-17).

## Tests

```bash
cd open-webui
python -m venv .venv && .venv/bin/pip install pydantic
.venv/bin/python -m unittest discover -s tests -v
```

- `tests/test_filter.py`, `tests/test_tool.py`: offline; a local fake ValorBrain server records every request.
  `tests/owui_harness.py` loads each file the way Open WebUI does (frontmatter, `exec`, valves,
  reserved arguments).
- `tests/test_upstream_dispatch.py`: runs the filter through Open WebUI's own `filter.py`. Opt-in:

  ```bash
  gh api 'repos/open-webui/open-webui/contents/backend/open_webui/utils/filter.py?ref=v0.12.3' \
    --jq .content | base64 -d > /tmp/owui-filter.py
  OPEN_WEBUI_FILTER_PY=/tmp/owui-filter.py .venv/bin/python -m unittest tests.test_upstream_dispatch -v
  ```

- `tests/test_live_staging.py`: live round trip (capture → search → recall → tool → forget). Runs only when
  `VB_STAGING_URL` and `VB_STAGING_MCP_TOKEN` are set; point it at a test tenant, never production.

## Limits

- Each turn is saved as its own memory. A regenerated answer is a new message and is saved again; repeated
  outlet calls for the same message are deduplicated only within one server process.
- Recall runs once per user turn (`inlet`), not on every hop of a tool-calling loop.
- HTTP calls run in a worker thread with a timeout; a slow ValorBrain adds up to `timeout_seconds` before the
  model starts answering.

License: MIT (see the repository root).
