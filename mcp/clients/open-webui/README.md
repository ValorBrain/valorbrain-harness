# ValorBrain MCP in Open WebUI

[Open WebUI](https://github.com/open-webui/open-webui) 0.6.31 and later connects to Streamable HTTP MCP servers natively. Older versions, or setups that want an OpenAPI tool server, can go through [mcpo](https://github.com/open-webui/mcpo). Only admins can add MCP servers.

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller open-webui --json` prints an `mcp_token` (`vbm_…`).
- With an account: create one at [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).

Only `vbm_` tokens work on MCP. A `vb_agent_` key is REST-only and gets `401 wrong_credential_type`.

## Native MCP (recommended)

**Admin Settings → Integrations → External Tool Servers → + Add Connection**:

| Field | Value |
|---|---|
| Type | `MCP (Streamable HTTP)` (not `OpenAPI`) |
| URL | `https://mcpbrain.valor.digital/mcp` |
| Auth | `Bearer`, with your `vbm_` token in **Key**; or `OAuth 2.1` (see below) |
| Headers | `{"X-Source-Agent": "open-webui"}` |
| ID / Name | `valorbrain` / `ValorBrain` |

Click **Verify Connection**, then **Save**. With Bearer auth every user shares that token's identity. Use OAuth 2.1 if each person should sign in as themselves.

### Same connection as configuration

To provision it without the UI, set the `TOOL_SERVER_CONNECTIONS` environment variable to this JSON on the first start. That is the same object the **Save** button posts to `/api/v1/configs/tool_servers`.

```json
[
  {
    "type": "mcp",
    "url": "https://mcpbrain.valor.digital/mcp",
    "path": "",
    "auth_type": "bearer",
    "key": "<vbm_token>",
    "headers": {
      "X-Source-Agent": "open-webui"
    },
    "config": {
      "enable": true
    },
    "info": {
      "id": "valorbrain",
      "name": "ValorBrain",
      "description": "Shared company memory for agents"
    }
  }
]
```

Replace `<vbm_token>`. Open WebUI stores it in its database; it does not read it from another variable.

### OAuth 2.1

Choose Auth = `OAuth 2.1`. Open WebUI discovers the authorization server from the protected-resource metadata and registers itself with DCR. Each user authorizes the first time they enable the tool in a chat.

```json
[
  {
    "type": "mcp",
    "url": "https://mcpbrain.valor.digital/mcp",
    "path": "",
    "auth_type": "oauth_2.1",
    "key": "",
    "headers": {
      "X-Source-Agent": "open-webui"
    },
    "config": {
      "enable": true
    },
    "info": {
      "id": "valorbrain",
      "name": "ValorBrain",
      "description": "Shared company memory for agents"
    }
  }
]
```

Set `WEBUI_SECRET_KEY`. Without it, stored OAuth tokens cannot be decrypted after a restart.

## Through mcpo (OpenAPI proxy)

```json
{
  "mcpServers": {
    "valorbrain": {
      "type": "streamable-http",
      "url": "https://mcpbrain.valor.digital/mcp",
      "headers": {
        "Authorization": "Bearer <vbm_token>",
        "X-Source-Agent": "open-webui"
      }
    }
  }
}
```

```bash
uvx --with 'mcp<2' mcpo --port 8000 --api-key "<a-local-secret>" --config mcpo.config.json
```

- Replace `<vbm_token>` and `chmod 600` the file. mcpo does not expand environment variables.
- `type` must be `streamable-http`. Leaving it out falls back to SSE.
- Pin `mcp<2`. mcpo 0.0.20 imports `streamablehttp_client`, which is gone from the `mcp` 2.x SDK, so plain `uvx mcpo` crashes at startup (seen on 2026-10-17).
- In Open WebUI, add `http://<host>:8000/valorbrain` as an **OpenAPI** tool server.

## Verify and disable

- Verify: **Verify Connection** lists the ValorBrain tools. With mcpo, `GET http://<host>:8000/valorbrain/openapi.json` lists them.
- Disable: toggle the connection off, or delete it.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

- **Native MCP, real**, on 2026-10-17 with Open WebUI 0.12.3 (`uv tool run open-webui`, isolated `HOME` and `DATA_DIR`), against the staging engine:
  - `POST /api/v1/configs/tool_servers/verify` with the connection above returned `status: true` and 36 tools. The recording proxy saw `initialize` and `tools/list`, both `200`.
  - `POST /api/v1/configs/tool_servers` saved it.
- **mcpo 0.0.20, real**, on 2026-10-17: it connected and exposed 36 OpenAPI paths. `POST /valorbrain/whoami` returned `agent: open-webui-mcpo`.

## Sources

- https://docs.openwebui.com/features/extensibility/mcp
- https://github.com/open-webui/open-webui/blob/main/backend/open_webui/routers/configs.py
- https://github.com/open-webui/mcpo
