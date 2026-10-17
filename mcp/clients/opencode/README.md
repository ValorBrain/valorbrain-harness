# ValorBrain MCP in OpenCode

[OpenCode](https://github.com/sst/opencode) reads the `mcp` key from `~/.config/opencode/opencode.json` (global) or `opencode.json` at the project root.

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller opencode --json` prints an `mcp_token` (`vbm_…`).
- With an account: create one at [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).

Only `vbm_` tokens work on MCP. A `vb_agent_` key is REST-only and gets `401 wrong_credential_type`. Keep the token in an environment variable, not in the file:

```bash
export VALORBRAIN_MCP_TOKEN=vbm_...   # in your shell profile
```

## Bearer token

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "valorbrain": {
      "type": "remote",
      "url": "https://mcpbrain.valor.digital/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:VALORBRAIN_MCP_TOKEN}",
        "X-Source-Agent": "opencode"
      }
    }
  }
}
```

- `type: "remote"` is required. `{env:VAR}` is OpenCode's variable syntax.
- `"oauth": false` stops OpenCode from starting OAuth when it sees the `401` challenge.

## OAuth

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "valorbrain": {
      "type": "remote",
      "url": "https://mcpbrain.valor.digital/mcp",
      "enabled": true,
      "oauth": {
        "scope": "read write"
      },
      "headers": {
        "X-Source-Agent": "opencode"
      }
    }
  }
}
```

```bash
opencode mcp auth valorbrain
```

OpenCode registers with DCR, opens the browser and stores tokens in `~/.local/share/opencode/mcp-auth.json`. `scope` is one space-separated string.

## Verify and disable

- Verify: `opencode mcp list` should show `✓ valorbrain connected`.
- Disable: `"enabled": false`.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

**Real** on 2026-10-17 with OpenCode 1.18.33. With an isolated `HOME` and XDG directories and the config pointed at the staging engine, `opencode mcp list` reported `connected`. The run is in `mcp/test/live.test.ts`.

## Sources

- https://opencode.ai/docs/mcp-servers
- https://opencode.ai/config.json
