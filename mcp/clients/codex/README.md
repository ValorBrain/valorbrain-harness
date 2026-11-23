# ValorBrain MCP in Codex CLI

[Codex CLI](https://github.com/openai/codex) reads `[mcp_servers.<name>]` from `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`).

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller codex --json` prints an `mcp_token` (`vbm_…`).
- With an account: create one at [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).

Only `vbm_` tokens work on MCP. A `vb_agent_` key is REST-only and gets `401 wrong_credential_type`. Keep the token in an environment variable, not in the file:

```bash
export VALORBRAIN_MCP_TOKEN=vbm_...   # in your shell profile
```

## Bearer token

```toml
[mcp_servers.valorbrain]
url = "https://mcpbrain.valor.digital/mcp"
bearer_token_env_var = "VALORBRAIN_MCP_TOKEN"
http_headers = { "X-Source-Agent" = "codex" }
```

Or with one command:

```bash
codex mcp add valorbrain --url https://mcpbrain.valor.digital/mcp --bearer-token-env-var VALORBRAIN_MCP_TOKEN
```

- Codex reads the token from the variable each session, so it never sits in the file. An inline `bearer_token` is rejected.
- There is no `type` key. `url` means Streamable HTTP.

## OAuth

```toml
[mcp_servers.valorbrain]
url = "https://mcpbrain.valor.digital/mcp"
scopes = ["read", "write"]
http_headers = { "X-Source-Agent" = "codex" }
```

```bash
codex mcp login valorbrain --scopes read,write
```

Codex discovers the authorization server, registers with DCR and opens the browser. Add `--no-browser` on a headless machine.

## Verify and disable

- Verify: `codex mcp list` shows `Bearer token` (or `OAuth`). Inside a session, `/mcp` lists the ValorBrain tools.
- Disable: `codex mcp remove valorbrain`, or `enabled = false`.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

**Real** on 2026-10-17 with codex-cli 0.160.0, `HOME` and `CODEX_HOME` isolated, against the staging engine:
- `codex exec` started the server and sent `initialize` and `tools/list` (both `200`, seen through a recording proxy). The model provider was a dead local port, so no model ran.
- In a separate run with an OpenRouter model, `codex exec` called `valorbrain/whoami`, which returned `agent: codex`.

## Sources

- https://developers.openai.com/codex/mcp
- https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs
