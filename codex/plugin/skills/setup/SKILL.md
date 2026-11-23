---
name: setup
description: Sign this machine in to ValorBrain for Codex, so the plugin's hooks can recall and checkpoint memory. Use when the user asks to connect, log in to or set up ValorBrain, or when $valorbrain:status says there is no credential.
---

# Connect ValorBrain

The plugin runs the official ValorBrain client (`@valorbrain/connect`), and that client needs a
token for Codex. Getting one is a browser sign-in (OAuth device flow) done by the official
installer in MCP-only mode, so it adds no hooks of its own: the plugin's hooks are the ones that run.

Never ask the user to paste a token into the conversation, and never print one.

## Steps

1. Run this command. It needs the network and writes to `~/.valorbrain` and `~/.codex`, so it
   runs outside the sandbox: ask for that permission. It waits until the user approves in the
   browser, up to about 10 minutes.

   ```
   npx -y @valorbrain/connect@0.13.0 --harness codex --mcp-only
   ```

   Add `--api <url>`, `--app <url>` or `--no-browser` only when the user gave them; they point at
   a self-hosted or staging engine.

2. When it prints a link such as `https://valorbrain.valor.digital/cli/link?code=XXXX-XXXX`, show
   the link and the code to the user. The installer also tries to open the browser by itself.

3. When it finishes, tell the user what it wrote, from its output:
   - the token for Codex in `~/.valorbrain/connect.json` (mode 0600, one entry per harness);
   - a `[mcp_servers.valorbrain]` table in `~/.codex/config.toml`, at the same URL as this
     plugin's server; Codex uses that table instead of the plugin's, so there is one server;
   - a short instruction block in `~/.codex/AGENTS.md`.

4. Remind the user that Codex runs no plugin hook until it is trusted: open `/hooks` in a terminal
   session and trust the three ValorBrain hooks (or **Trust all** on the plugin's page in the
   ChatGPT desktop app). Then a new session starts with ValorBrain context.
   `$valorbrain:status` shows what is connected.

## If it cannot run here

Give the user the same command to run in their own terminal. Someone who already has an MCP token
(`vbm_…`) can run it there as
`VALORBRAIN_MCP_TOKEN=vbm_… npx -y @valorbrain/connect@0.13.0 --harness codex --mcp-only`,
which skips the browser and keeps the token out of this conversation.
