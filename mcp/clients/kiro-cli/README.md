# ValorBrain MCP in Kiro CLI

[Kiro CLI](https://kiro.dev) reads `mcpServers` from `~/.kiro/settings/mcp.json` (user) or `.kiro/settings/mcp.json` (workspace).

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller kiro-cli --json` prints an `mcp_token` (`vbm_…`).
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
      "url": "https://mcpbrain.valor.digital/mcp",
      "headers": {
        "Authorization": "Bearer ${VALORBRAIN_MCP_TOKEN}",
        "X-Source-Agent": "kiro-cli"
      }
    }
  }
}
```

- There is no `type` key. An entry with `url` is a remote server.
- Kiro expands `${VAR}`.
- `kiro-cli mcp add --name valorbrain --url https://mcpbrain.valor.digital/mcp --scope global` creates the entry but has no header flag. Add `headers` by hand.

## OAuth

```json
{
  "mcpServers": {
    "valorbrain": {
      "url": "https://mcpbrain.valor.digital/mcp",
      "headers": {
        "X-Source-Agent": "kiro-cli"
      },
      "oauthScopes": [
        "read",
        "write"
      ]
    }
  }
}
```

Without an `Authorization` header, Kiro opens the browser and registers with DCR. It re-authenticates on its own when the token expires.

## Verify and disable

- Verify: in `kiro-cli chat`, `/mcp` should show `valorbrain ● running` with the tool count.
- Disable: `"disabled": true`, or `kiro-cli mcp remove --name valorbrain`.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

**Real** on 2026-10-17 with kiro-cli 2.20.1. With an isolated `HOME`, XDG directories, `KIRO_HOME` and a copy of the login database, interactive `/mcp` showed `valorbrain ● running 36 tools`. The recording proxy saw `initialize` and `tools/list`, both `200`. Kiro requires a logged-in account even to load MCP servers.

## Sources

- https://kiro.dev/docs/mcp/configuration/
