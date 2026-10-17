---
name: status
description: Show whether ValorBrain is connected in Claude Code, which credential it uses and who runs its hooks. Use when the user asks whether ValorBrain is working, connected or sending.
---

# ValorBrain status

Run this and show the output to the user as it is. It only reads local files and never prints a
token:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/valorbrain-plugin.mjs" status --harness=claude-code
```

Then read it for them:

- **hooks: no credential yet** — nothing is recalled or sent; point at `/valorbrain:setup`.
- **hooks: already installed in …settings.json** — the user also installed ValorBrain with
  `npx @valorbrain/connect`; those hooks run and the plugin's stay silent, so nothing is sent
  twice. Either is fine. To let the plugin own the hooks, they run
  `npx -y @valorbrain/connect@0.13.0 --harness claude-code --mcp-only`.
- **mcp: no saved token** — the plugin's MCP server signs in with OAuth: run `/mcp`, pick
  `plugin:valorbrain:valorbrain` and authenticate.

For the official client's own view (engine, version, mode per harness), run
`npx -y @valorbrain/connect@0.13.0 --status`.
