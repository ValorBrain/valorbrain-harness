# ValorBrain MCP in Roo Code

[Roo Code](https://github.com/RooCodeInc/Roo-Code) reads `.roo/mcp.json` in the project and a global `mcp_settings.json`. Open them from the MCP panel with **Edit Project MCP** or **Edit Global MCP**. The upstream repository was archived on 2026-05-15 (last release v3.54.0); the extension still works.

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller roo-code --json` prints an `mcp_token` (`vbm_…`).
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
      "type": "streamable-http",
      "url": "https://mcpbrain.valor.digital/mcp",
      "headers": {
        "Authorization": "Bearer ${env:VALORBRAIN_MCP_TOKEN}",
        "X-Source-Agent": "roo-code"
      },
      "alwaysAllow": [],
      "disabled": false
    }
  }
}
```

- `type: "streamable-http"` is **required** when `url` is set.
- Roo expands `${env:VAR}` across the whole config. The variable must be set in the environment VS Code runs in.

## OAuth

Roo Code has no MCP OAuth flow. Use the Bearer token.

## Verify and disable

- Verify: the server turns green in the MCP panel. Ask Roo to call `whoami`.
- Disable: set `"disabled": true`.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

Checked **against the source** on 2026-10-17: `mcp/test/recipes.test.ts` asserts the keys and values of the zod schema in `src/services/mcp/McpHub.ts` (v3.54.0). That schema is not published as a package, so it was not run. Roo Code is not installed on the test host.

## Sources

- https://docs.roocode.com/features/mcp/using-mcp-in-roo
- https://github.com/RooCodeInc/Roo-Code/blob/main/src/services/mcp/McpHub.ts
