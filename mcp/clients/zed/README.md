# ValorBrain MCP in Zed

[Zed](https://github.com/zed-industries/zed) reads remote MCP servers from `context_servers` in `~/.config/zed/settings.json` (or `.zed/settings.json` in a project). In the UI: **Settings → AI → MCP Servers → Add Server → Add Remote Server**.

## OAuth (recommended)

With no `Authorization` header, Zed handles ValorBrain's `401` itself. It reads the protected-resource metadata, registers with DCR, opens the browser and keeps the session in the system keychain.

```json
{
  "context_servers": {
    "valorbrain": {
      "url": "https://mcpbrain.valor.digital/mcp",
      "headers": {
        "X-Source-Agent": "zed"
      }
    }
  }
}
```

- There is no `type` key. An entry with `url` is Streamable HTTP.

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller zed --json` prints an `mcp_token` (`vbm_…`).
- With an account: create one at [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).

Only `vbm_` tokens work on MCP. A `vb_agent_` key is REST-only and gets `401 wrong_credential_type`.

## Bearer token

```json
{
  "context_servers": {
    "valorbrain": {
      "url": "https://mcpbrain.valor.digital/mcp",
      "headers": {
        "Authorization": "Bearer <vbm_token>",
        "X-Source-Agent": "zed"
      }
    }
  }
}
```

- Zed does not expand environment variables in `headers`, so the token sits in `settings.json` in plain text.
- Any `Authorization` header turns OAuth off.

## Verify and disable

- Verify: the server's dot turns green under **Settings → AI → MCP Servers**. Ask the agent panel to call `whoami`.
- Disable: `"enabled": false`, or remove the entry.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

Checked **against the source** on 2026-10-17: `mcp/test/recipes.test.ts` asserts the shape of the `Http` variant of the untagged `ContextServerSettingsContent` serde enum in `crates/settings_content/src/project.rs`. The enum itself was not run. Zed is not installed on the test host.

## Sources

- https://zed.dev/docs/ai/mcp
- https://github.com/zed-industries/zed/blob/main/crates/settings_content/src/project.rs
