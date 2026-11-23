# ValorBrain MCP in LibreChat

[LibreChat](https://github.com/danny-avila/LibreChat) reads MCP servers from `mcpServers` in `librechat.yaml`. Restart LibreChat after you edit the file.

## Per-user Bearer token (recommended for teams)

Each user pastes their own `vbm_` token into **MCP Settings → valorbrain → Configure**. LibreChat substitutes it for `{{VALORBRAIN_MCP_TOKEN}}`.

```yaml
mcpServers:
  valorbrain:
    type: streamable-http
    url: https://mcpbrain.valor.digital/mcp
    title: ValorBrain
    description: Shared company memory for agents (retrieve, store, hand off).
    requiresOAuth: false
    headers:
      Authorization: "Bearer {{VALORBRAIN_MCP_TOKEN}}"
      X-Source-Agent: librechat
    customUserVars:
      VALORBRAIN_MCP_TOKEN:
        title: ValorBrain MCP token
        description: "Your vbm_ token: valorbrain.valor.digital, Settings, MCP tokens."
        sensitive: true
```

- Set `requiresOAuth: false`. Otherwise LibreChat probes the URL without headers, sees ValorBrain's `401 WWW-Authenticate: Bearer`, and assumes OAuth.
- If every user should share one admin token, replace `{{VALORBRAIN_MCP_TOKEN}}` with `${VALORBRAIN_MCP_TOKEN}` (read from LibreChat's `.env`) and remove `customUserVars`. A shared token means every user writes as the same identity.
- Users get a token from [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).

## OAuth

```yaml
mcpServers:
  valorbrain:
    type: streamable-http
    url: https://mcpbrain.valor.digital/mcp
    title: ValorBrain
    description: Shared company memory for agents (retrieve, store, hand off).
    requiresOAuth: true
    oauth:
      scope: read write
    headers:
      X-Source-Agent: librechat
```

LibreChat discovers the authorization server (RFC 9728), registers with DCR and sends each user through the browser sign-in. The callback is `<DOMAIN_SERVER>/api/mcp/valorbrain/oauth/callback`.

## Verify and disable

- Verify: in a chat, pick the `valorbrain` MCP server and ask for `whoami`.
- Disable: remove the block and restart.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

Validated **by schema** on 2026-10-17, against `MCPServersSchema` from `librechat-data-provider` (npm `latest`); see `mcp/scripts/check-upstream-schemas.ts`. LibreChat is not running on the test host.

## Sources

- https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers
- https://www.librechat.ai/docs/features/mcp
- https://github.com/danny-avila/LibreChat/blob/main/packages/data-provider/src/mcp.ts
