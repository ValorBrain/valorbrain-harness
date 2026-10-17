# ValorBrain MCP in Continue

[Continue](https://github.com/continuedev/continue) reads MCP servers from `mcpServers` blocks. Put the block in `.continue/mcpServers/` in your workspace, or list it in `~/.continue/config.yaml`. MCP tools only run in **agent** mode.

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller continue --json` prints an `mcp_token` (`vbm_…`).
- With an account: create one at [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).

Store it as a Continue secret. Put `VALORBRAIN_MCP_TOKEN=vbm_...` in `~/.continue/.env`. Continue looks there first, then in the workspace `.continue/.env` and `.env`, then in the process environment.

## Bearer token

Save as `.continue/mcpServers/valorbrain.yaml`:

```yaml
name: ValorBrain
version: 0.0.1
schema: v1
mcpServers:
  - name: valorbrain
    type: streamable-http
    url: https://mcpbrain.valor.digital/mcp
    requestOptions:
      headers:
        Authorization: "Bearer ${{ secrets.VALORBRAIN_MCP_TOKEN }}"
        X-Source-Agent: continue
```

- `type` is `streamable-http`, with a hyphen.
- Headers go under `requestOptions.headers`.
- A standalone block needs `name`, `version` and `schema: v1`, or it does not load.

## OAuth

Not available. Continue only runs its MCP OAuth flow for `sse` servers, and ValorBrain is Streamable HTTP. Use the Bearer token.

## Verify and disable

- Verify: in agent mode, ask Continue to call the `whoami` tool.
- Disable: delete the file, or remove the entry from `config.yaml`.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

Validated **by schema** on 2026-10-17, against the `mcpServers` block of `configYamlSchema` in `@continuedev/config-yaml` (npm `latest`); see `mcp/scripts/check-upstream-schemas.ts`. Continue is not installed on the test host.

## Sources

- https://docs.continue.dev/customize/deep-dives/mcp
- https://github.com/continuedev/continue/blob/main/packages/config-yaml/src/schemas/mcp/index.ts
