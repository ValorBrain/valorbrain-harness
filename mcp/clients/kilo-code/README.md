# ValorBrain MCP in Kilo Code

[Kilo Code](https://github.com/Kilo-Org/kilocode) 7.x (the VS Code extension and the `kilo` CLI) runs on OpenCode's config engine. It reads the `mcp` key from `~/.config/kilo/kilo.json` (global) or `kilo.json` / `.kilo/kilo.json` (project).

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller kilo-code --json` prints an `mcp_token` (`vbm_…`).
- With an account: create one at [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).

Only `vbm_` tokens work on MCP. A `vb_agent_` key is REST-only and gets `401 wrong_credential_type`. Keep the token in an environment variable, not in the file:

```bash
export VALORBRAIN_MCP_TOKEN=vbm_...   # in your shell profile
```

## Bearer token

Put this in the **global** file, `~/.config/kilo/kilo.json`:

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "mcp": {
    "valorbrain": {
      "type": "remote",
      "url": "https://mcpbrain.valor.digital/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:VALORBRAIN_MCP_TOKEN}",
        "X-Source-Agent": "kilo-code"
      }
    }
  }
}
```

- `type` is `remote`. Kilo tries Streamable HTTP first and falls back to SSE.
- `{env:VAR}` only works in the global config. Kilo drops any **project** MCP entry whose headers contain `{env:…}`.
- Set `"oauth": false` so a static header does not start OAuth detection.

## OAuth

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "mcp": {
    "valorbrain": {
      "type": "remote",
      "url": "https://mcpbrain.valor.digital/mcp",
      "enabled": true,
      "oauth": {
        "scope": "read write"
      },
      "headers": {
        "X-Source-Agent": "kilo-code"
      }
    }
  }
}
```

Kilo registers with DCR and opens the browser. You can also run `kilo mcp auth valorbrain`.

## Legacy format

Older Kilo releases used `.kilocode/mcp.json`. That format (`{"mcpServers": {"valorbrain": {"type": "streamable-http", …}}}`) is still migrated at startup. Use `kilo.json` for new setups.

## Verify and disable

- Verify: `kilo mcp list`.
- Disable: set `"enabled": false`.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

Validated **by schema** on 2026-10-17, against `https://app.kilo.ai/config.json` (`McpRemoteConfig`); see `mcp/scripts/check-upstream-schemas.ts`. Kilo is not installed on the test host. The same format runs for real in OpenCode (see `../opencode`).

## Sources

- https://kilo.ai/docs/automate/mcp/using-in-kilo-code
- https://kilo.ai/docs/automate/mcp/using-in-cli
- https://github.com/Kilo-Org/kilocode/blob/main/packages/core/src/v1/config/mcp.ts
