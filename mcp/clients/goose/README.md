# ValorBrain MCP in Goose

[Goose](https://github.com/aaif-goose/goose) loads remote MCP servers as `streamable_http` extensions from `~/.config/goose/config.yaml` (key `extensions`).

## Get a token (Bearer)

- No account yet: `npx -y @valorbrain/cli@latest init --agent --agent-caller goose --json` prints an `mcp_token` (`vbm_…`).
- With an account: create one at [Settings → MCP tokens](https://valorbrain.valor.digital/settings/mcp-tokens).

Only `vbm_` tokens work on MCP. A `vb_agent_` key is REST-only and gets `401 wrong_credential_type`. Keep the token in an environment variable, not in the file:

```bash
export VALORBRAIN_MCP_TOKEN=vbm_...   # in your shell profile
```

## Bearer token

Add this under `extensions:` in `~/.config/goose/config.yaml`:

```yaml
extensions:
  valorbrain:
    name: valorbrain
    type: streamable_http
    uri: https://mcpbrain.valor.digital/mcp
    enabled: true
    timeout: 300
    env_keys:
      - VALORBRAIN_MCP_TOKEN
    headers:
      Authorization: "Bearer ${VALORBRAIN_MCP_TOKEN}"
      X-Source-Agent: goose
```

- The key is `uri`, not `url`, and the type is `streamable_http` with an underscore.
- Goose expands `${VAR}` in `uri` and `headers`. It reads the value from the variables listed in `env_keys` or from its secret store (`goose configure`).

## OAuth (no token in config)

Leave out the `Authorization` header. On the first `401`, Goose discovers the authorization server and registers itself with Dynamic Client Registration (DCR). It then opens your browser to sign in to ValorBrain.

```yaml
extensions:
  valorbrain:
    name: valorbrain
    type: streamable_http
    uri: https://mcpbrain.valor.digital/mcp
    enabled: true
    timeout: 300
    headers:
      X-Source-Agent: goose
```

To fix the callback port, set `GOOSE_OAUTH_CALLBACK_PORT`.

## Verify and disable

- Verify: start `goose session` and ask it to call the `whoami` tool. It should report `agent: goose`.
- Disable: set `enabled: false`, or delete the `valorbrain` block.

## What leaves your machine, and when

- At startup the client sends `initialize` and `tools/list` to `mcpbrain.valor.digital`, with your token (or OAuth access token) and the `X-Source-Agent` header.
- After that, a request goes out only when the model calls a ValorBrain tool. It carries that tool's arguments: a search query, or the title and text of a memory the agent decided to store.
- Nothing is captured automatically. This recipe installs no hooks and does not upload files or conversation history.

## Tested

Checked **against the source** on 2026-10-17: `mcp/test/recipes.test.ts` asserts the keys and values of the `ExtensionConfig::StreamableHttp` serde struct (Goose v1.55.0). The struct itself was not run. Goose is not installed on the test host.

## Sources

- https://goose-docs.ai/docs/getting-started/using-extensions/
- https://goose-docs.ai/docs/guides/config-files/
- https://github.com/aaif-goose/goose/blob/main/crates/goose/src/agents/extension.rs
