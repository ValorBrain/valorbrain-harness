# ValorBrain MCP in AnythingLLM

[AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) (Desktop, or self-hosted Docker) reads `plugins/anythingllm_mcp_servers.json` inside its storage directory:

| Install | File |
|---|---|
| Desktop, Linux | `~/.config/anythingllm-desktop/storage/plugins/anythingllm_mcp_servers.json` |
| Desktop, macOS | `~/Library/Application Support/anythingllm-desktop/storage/plugins/anythingllm_mcp_servers.json` |
| Desktop, Windows | `%APPDATA%\anythingllm-desktop\storage\plugins\anythingllm_mcp_servers.json` |
| Docker | `$STORAGE_DIR/plugins/anythingllm_mcp_servers.json` (`/app/server/storage/...` in the container) |

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller anythingllm --json` prints an `mcp_token` (`vbm_…`).
- With an account: create one at [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).

Only `vbm_` tokens work on MCP. A `vb_agent_` key is REST-only and gets `401 wrong_credential_type`.

## Bearer token

```json
{
  "mcpServers": {
    "valorbrain": {
      "type": "streamable",
      "url": "https://mcpbrain.valor.digital/mcp",
      "headers": {
        "Authorization": "Bearer <vbm_token>",
        "X-Source-Agent": "anythingllm"
      }
    }
  }
}
```

- Replace `<vbm_token>` with your token. AnythingLLM does not expand environment variables in `headers`, so the token sits in this file in plain text. Keep the file private (`chmod 600`).
- `type` must be `streamable` (or `http`). `streamable-http` is rejected, and leaving `type` out falls back to SSE.
- After editing, click **Refresh** on the Agent Skills page. The servers start when you open Agent Skills or invoke `@agent`.

## OAuth

AnythingLLM has no MCP OAuth flow. Use the Bearer token.

## Verify and disable

- Verify: Agent Skills lists `valorbrain` with its tools. `@agent call whoami` should answer.
- Disable: toggle the server off in Agent Skills, or remove the block.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

Checked **against the source** on 2026-10-17 (`mcp/test/recipes.test.ts`), following the checks in `server/utils/MCP/hypervisor/index.js` (`#parseServerType`, `#validateServerDefinitionByType`). There is no formal schema upstream, and AnythingLLM is not running on the test host.

## Sources

- https://docs.anythingllm.com/mcp-compatibility/overview
- https://docs.anythingllm.com/mcp-compatibility/desktop
- https://github.com/Mintplex-Labs/anything-llm/blob/master/server/utils/MCP/hypervisor/index.js
