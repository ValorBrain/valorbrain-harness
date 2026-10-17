# ValorBrain MCP in Gemini CLI

[Gemini CLI](https://github.com/google-gemini/gemini-cli) reads `mcpServers` from `~/.gemini/settings.json` (user) or `.gemini/settings.json` (project, only in trusted folders).

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller gemini-cli --json` prints an `mcp_token` (`vbm_…`).
- With an account: create one at [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).

Only `vbm_` tokens work on MCP. A `vb_agent_` key is REST-only and gets `401 wrong_credential_type`. Keep the token in an environment variable, not in the file:

```bash
export VALORBRAIN_MCP_TOKEN=vbm_...   # in your shell profile
```

## Bearer token

```json
{
  "mcpServers": {
    "valorbrain": {
      "type": "http",
      "url": "https://mcpbrain.valor.digital/mcp",
      "headers": {
        "Authorization": "Bearer ${VALORBRAIN_MCP_TOKEN}",
        "X-Source-Agent": "gemini-cli"
      }
    }
  }
}
```

- `type: "http"` plus `url` replaces the deprecated `httpUrl` key. Both still work.
- Gemini expands `$VAR` and `${VAR}` anywhere in `settings.json`. An unset variable becomes an empty string.
- `gemini mcp add -t http -H "Authorization: Bearer $VALORBRAIN_MCP_TOKEN" valorbrain <url>` also works, but your shell expands the variable, so the token ends up in the file. It also defaults to **project** scope (`-s user` for global).

## OAuth

```json
{
  "mcpServers": {
    "valorbrain": {
      "type": "http",
      "url": "https://mcpbrain.valor.digital/mcp",
      "headers": {
        "X-Source-Agent": "gemini-cli"
      },
      "oauth": {
        "enabled": true,
        "scopes": [
          "read",
          "write"
        ]
      }
    }
  }
}
```

Without an `Authorization` header, Gemini also detects the `401` and starts discovery, DCR and PKCE on its own. Run `/mcp auth valorbrain` in the TUI to trigger the sign-in. It needs a browser on the same machine.

## Verify and disable

- Verify: `gemini mcp list` should show `✓ valorbrain: … (http) - Connected`.
- Disable: `gemini mcp remove valorbrain`, or delete the entry.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

**Real** on 2026-10-17 with Gemini CLI 0.43.0. With an isolated `HOME` and `settings.json` pointed at the staging engine, `gemini mcp list` reported `Connected`. The run is in `mcp/test/live.test.ts`.

## Sources

- https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
- https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json
