# ValorBrain MCP in Cline

The [Cline](https://github.com/cline/cline) VS Code extension and the Cline CLI share one file: `~/.cline/data/settings/cline_mcp_settings.json`. You can override its location with `CLINE_MCP_SETTINGS_PATH` or `CLINE_DATA_DIR`.

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller cline --json` prints an `mcp_token` (`vbm_…`).
- With an account: create one at [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).

Only `vbm_` tokens work on MCP. A `vb_agent_` key is REST-only and gets `401 wrong_credential_type`. Keep the token in an environment variable, not in the file:

```bash
export VALORBRAIN_MCP_TOKEN=vbm_...   # in your shell profile
```

## Bearer token: VS Code extension

The extension expands `${env:VAR}` in URLs and headers. The variable must be set in the environment VS Code runs in.

```json
{
  "mcpServers": {
    "valorbrain": {
      "type": "streamableHttp",
      "url": "https://mcpbrain.valor.digital/mcp",
      "headers": {
        "Authorization": "Bearer ${env:VALORBRAIN_MCP_TOKEN}",
        "X-Source-Agent": "cline"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

- `type` is `streamableHttp` (camelCase). Without `type`, a URL entry falls back to the legacy SSE transport.

## Bearer token: Cline CLI

The CLI (3.x) does **not** expand `${env:VAR}`. It sends the text literally and gets `401` (seen on 2026-10-17). Let your shell expand the variable when you add the server:

```bash
cline mcp add valorbrain https://mcpbrain.valor.digital/mcp --transport http \
  --header "Authorization: Bearer $VALORBRAIN_MCP_TOKEN" --header "X-Source-Agent: cline" --yes
chmod 600 ~/.cline/data/settings/cline_mcp_settings.json
```

This stores the token in the file, so keep the file private (`chmod 600`). The CLI writes the nested form (`"transport": {"type", "url", "headers"}`); the extension reads it too.

## OAuth

Leave out the `Authorization` header, then click **Authorize OAuth** in the MCP Servers panel (extension) or in the `cline mcp` wizard (CLI). Cline uses DCR and a local callback on `127.0.0.1:1456`.

```json
{
  "mcpServers": {
    "valorbrain": {
      "type": "streamableHttp",
      "url": "https://mcpbrain.valor.digital/mcp",
      "headers": {
        "X-Source-Agent": "cline"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## Verify and disable

- Verify: ask Cline to call `whoami`.
- Disable: set `"disabled": true`, or run `cline mcp remove valorbrain`.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

- Cline CLI 3.0.65, **real**, on 2026-10-17, with an isolated `HOME`:
  - `cline mcp add … --yes` wrote the config.
  - A task with an OpenRouter model called `valorbrain__whoami` against the staging engine, which answered `agent: cline`.
  - The `${env:…}` form got `401` from the CLI, as described above.
- Extension JSON: checked **against the source**. `mcp/test/recipes.test.ts` asserts the shape of the zod schema in `apps/vscode/src/services/mcp/schemas.ts`, which is not published as a package.

## Sources

- https://docs.cline.bot/mcp/mcp-overview
- https://github.com/cline/cline/blob/main/apps/vscode/src/services/mcp/schemas.ts
