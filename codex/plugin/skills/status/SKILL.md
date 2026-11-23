---
name: status
description: Show whether ValorBrain is connected in Codex, which credential it uses and who runs its hooks. Use when the user asks whether ValorBrain is working, connected or sending.
---

# ValorBrain status

Run this from this skill's folder (the path is relative to it) and show the output to the user as
it is. It only reads local files, never prints a token, and runs inside the sandbox:

```
node ../../bin/valorbrain-plugin.mjs status --harness=codex
```

Then read it for them:

- **hooks: no credential yet**: nothing is recalled or sent; point at `$valorbrain:setup`.
- **hooks: already installed in …hooks.json**: the user also installed ValorBrain with
  `npx @valorbrain/connect`; those hooks run and the plugin's stay silent, so nothing is sent
  twice. To let the plugin own the hooks, they run
  `npx -y @valorbrain/connect@0.13.0 --harness codex --mcp-only`.
- **mcp: no saved token**: the plugin's MCP server signs in with OAuth:
  `codex mcp login valorbrain`.

If the user says nothing is recalled even though the status looks right, the hooks were probably
never trusted: Codex skips an untrusted hook without saying so. Point at `/hooks`.

For the official client's own view (engine, version, mode per harness), run
`npx -y @valorbrain/connect@0.13.0 --status` (needs the network).
