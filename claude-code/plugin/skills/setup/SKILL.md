---
name: setup
description: Sign this machine in to ValorBrain for Claude Code, so the plugin's hooks can recall and checkpoint memory. Use when the user asks to connect, log in to or set up ValorBrain, or when the status skill says there is no credential.
disable-model-invocation: true
---

# Connect ValorBrain

The plugin runs the official ValorBrain client (`@valorbrain/connect`), and that client needs a
token for Claude Code. Getting one is a browser sign-in (OAuth device flow) done by the official
installer in MCP-only mode, so it adds no hooks of its own: the plugin's hooks are the ones that run.

Never ask the user to paste a token into the conversation, and never print one.

## Steps

1. Run this with the Bash tool, **in the background** (it waits until the user approves in the
   browser, up to about 10 minutes):

   ```
   npx -y @valorbrain/connect@0.13.0 --harness claude-code --mcp-only
   ```

   Pass extra arguments the user gave (`$ARGUMENTS`) only when they are `--api <url>`,
   `--app <url>` or `--no-browser`; they point at a self-hosted or staging engine.

2. Read the command's output until it prints a link such as
   `https://valorbrain.valor.digital/cli/link?code=XXXX-XXXX`, and show the link and the code to
   the user. The installer also tries to open the browser by itself.

3. When the command finishes, tell the user what it wrote, from its output:
   - the token for Claude Code in `~/.valorbrain/connect.json` (mode 0600, one entry per harness);
   - a `valorbrain` MCP server in `~/.claude.json`, at the same URL as this plugin's server, so
     Claude Code connects once and hides the plugin's copy;
   - a short instruction block in `~/.claude/CLAUDE.md`.

4. Tell the user to start a new session (or run `/reload-plugins`): from then on each session
   starts with ValorBrain context and the hooks send what the
   [plugin README](https://github.com/ValorBrain/valorbrain-harness/tree/main/claude-code#what-leaves-your-machine)
   describes. `/valorbrain:status` shows what is connected.

## If it cannot run here

If the Bash tool is not available or the command fails, give the user the same command to run
in their own terminal. Someone who already has an MCP token (`vbm_…`) can run it there as
`VALORBRAIN_MCP_TOKEN=vbm_… npx -y @valorbrain/connect@0.13.0 --harness claude-code --mcp-only`,
which skips the browser and keeps the token out of this conversation.
