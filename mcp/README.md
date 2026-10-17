# ValorBrain MCP: recipes for open-source MCP clients

ValorBrain's hosted MCP server is `https://mcpbrain.valor.digital/mcp`. It uses the Streamable HTTP transport and exposes 36 tools: `memory_prepare`, `memory_retrieve`, `memory_store`, `team_handoff`, `whoami` and others. This directory shows how to plug it into popular open-source MCP clients, each in that client's own config format. It also holds the manifest for MCP registries.

Nothing here runs on your machine except the client you already use. A recipe is a config snippet.

## Authentication

The server accepts either:

- **OAuth 2.1**. Discovery uses the [protected-resource metadata](https://mcpbrain.valor.digital/.well-known/oauth-protected-resource) (RFC 9728), registration uses dynamic client registration (RFC 7591), and the code exchange uses PKCE S256. Scopes are `read` and `write`. Your client opens a browser, you sign in to ValorBrain, and the client keeps the token. Use OAuth when the client supports it and a person is at the keyboard.
- **Bearer token** `vbm_…`, sent as `Authorization: Bearer vbm_…`. Use it for headless agents and for clients without MCP OAuth.
  - Without an account: `npx -y @valorbrain/cli@latest init --agent --agent-caller <client> --json` prints `mcp_token`.
  - With an account: create one at [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).
  - A `vb_agent_…` key is REST-only. The MCP server answers it with `401 wrong_credential_type`.

The tenant comes from the token. Never send `X-Tenant-ID`. Each recipe sends `X-Source-Agent: <client>`, so writes are attributed to that client (`whoami` reports it as `agent`). Where the client can read environment variables, recipes reference `VALORBRAIN_MCP_TOKEN` rather than storing the token.

## Clients

"Real" means a run of that client on 2026-10-17, in a throwaway `HOME`, connected to the ValorBrain staging engine (see `test/live.test.ts`). "Schema" means `scripts/check-upstream-schemas.ts` ran the client's published schema (JSON Schema, or the zod schema in its npm package) against the file. "Source" means the parser is not published (a Rust struct, or zod inside an extension), so `test/recipes.test.ts` asserts the shape the source code expects. Neither kind of client was installed on the test host.

| Client | Recipe | Format | OAuth | Bearer via env var | Validated |
|---|---|---|---|---|---|
| [Goose](clients/goose/) | `~/.config/goose/config.yaml` → `extensions` | YAML, `type: streamable_http`, `uri` | yes | `${VAR}` + `env_keys` | source |
| [Continue](clients/continue/) | `.continue/mcpServers/valorbrain.yaml` | YAML block, `type: streamable-http` | no (SSE only) | `${{ secrets.VAR }}` | schema (zod, `@continuedev/config-yaml`) |
| [Cline](clients/cline/) | `~/.cline/data/settings/cline_mcp_settings.json` | JSON, `type: streamableHttp` | yes | `${env:VAR}` in the extension only; the CLI needs the literal token | **real** (CLI 3.0.65) + source (extension zod) |
| [Roo Code](clients/roo-code/) | `.roo/mcp.json` | JSON, `type: streamable-http` | no | `${env:VAR}` | source (zod in `McpHub.ts`) |
| [Kilo Code](clients/kilo-code/) | `~/.config/kilo/kilo.json` → `mcp` | JSON, `type: remote` | yes | `{env:VAR}` (global config only) | schema (`app.kilo.ai/config.json`) |
| [LibreChat](clients/librechat/) | `librechat.yaml` → `mcpServers` | YAML, `type: streamable-http` | yes | `{{VAR}}` per user / `${VAR}` shared | schema (zod, `librechat-data-provider`) |
| [AnythingLLM](clients/anythingllm/) | `storage/plugins/anythingllm_mcp_servers.json` | JSON, `type: streamable` | no | no (literal token) | source (hand-written checks) |
| [Zed](clients/zed/) | `settings.json` → `context_servers` | JSON, `url` (no type) | yes (default) | no (literal token) | source (serde struct) |
| [Open WebUI](clients/open-webui/) | Admin → Integrations → External Tool Servers | UI / `TOOL_SERVER_CONNECTIONS` JSON, type `mcp` | yes | no | **real** (0.12.3 native, and mcpo 0.0.20) |
| [Gemini CLI](clients/gemini-cli/) | `~/.gemini/settings.json` → `mcpServers` | JSON, `type: http` + `url` | yes | `${VAR}` | **real** (0.43.0) |
| [Codex CLI](clients/codex/) | `~/.codex/config.toml` → `[mcp_servers.valorbrain]` | TOML, `url` | yes (`codex mcp login`) | `bearer_token_env_var` | **real** (0.160.0) |
| [OpenCode](clients/opencode/) | `~/.config/opencode/opencode.json` → `mcp` | JSON, `type: remote` | yes | `{env:VAR}` | **real** (1.18.33) |
| [Kiro CLI](clients/kiro-cli/) | `~/.kiro/settings/mcp.json` → `mcpServers` | JSON, `url` (no type) | yes | `${VAR}` | **real** (2.20.1) |

Claude Code, Cursor and VS Code have their own pages at [docs.valorbrain.com.br/docs/integrations](https://docs.valorbrain.com.br/docs/integrations).

## What leaves your machine, and when

Every recipe works the same way:

- At startup the client sends `initialize` and `tools/list`.
- After that, a request goes out only when the model decides to call a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory to store.
- The recipes install no hooks and capture nothing automatically.

All traffic goes to `mcpbrain.valor.digital` over HTTPS. For OAuth, the client also talks to the same host's `/oauth/*` endpoints. To stop, remove or disable the `valorbrain` entry; each client README shows how.

## Registries

- [`server.json`](server.json) is the manifest for the [official MCP Registry](https://registry.modelcontextprotocol.io), in the 2025-12-11 schema. Its name is `br.com.valorbrain/memory`.
- [`registries/`](registries/) has the listing material and publishing steps for the official registry, Smithery, Glama and mcp.so. Nothing has been submitted.

## Tests

```bash
bun test mcp/test/recipes.test.ts      # offline: formats, README sync, no credentials, server.json
bun mcp/scripts/check-upstream-schemas.ts   # network: validates recipes against upstream schemas
# live, staging only (never production):
set -a; . /etc/valorbrain/integracoes-staging.env; set +a
bun test --timeout 1000000 mcp/test/live.test.ts
```

The live test needs `VB_STAGING_MCP_URL` and `VB_STAGING_MCP_TOKEN`. It first runs a store → retrieve → forget control over MCP. Then it runs each installed client (gemini, opencode, codex, plus kiro-cli, the Cline CLI and Open WebUI when opted in; see the header of `live.test.ts`). Each client runs in a throwaway `HOME` against a local recording proxy, and the test asserts that client's `initialize` and `tools/list` succeeded.
