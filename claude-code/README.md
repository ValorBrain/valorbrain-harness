# ValorBrain for Claude Code (plugin)

A Claude Code plugin that gives every session durable memory from
[ValorBrain](https://valorbrain.valor.digital):

- **session start**: what ValorBrain knows about the work, injected as context;
- **every prompt**: the memory relevant to that prompt;
- **every few turns**: a short checkpoint asking Claude to record what is worth keeping;
- **MCP tools**: `memory_retrieve`, `memory_store`, `task_state` and the rest of the
  ValorBrain MCP server, for when Claude decides to look something up or write it down.

The plugin carries no memory logic of its own. Its hooks run the official ValorBrain client,
[`@valorbrain/connect`](https://www.npmjs.com/package/@valorbrain/connect), pinned to
**0.13.0**, the same version the engine pins for hosted installs:

```
npx --no-update-notifier --loglevel=warn -y @valorbrain/connect@0.13.0 hook <event> --harness=claude-code
```

What the plugin adds is small (`plugin/bin/valorbrain-plugin.mjs`, Node built-ins only):
it steps aside when the official installer's hooks are already there, redacts obvious secrets
from the prompt before handing it over, and gives the MCP server its headers.

## Install

From Claude Code 2.1.275 on, in one step:

```
/plugin install valorbrain --marketplace ValorBrain/valorbrain-harness
```

Or in two:

```
claude plugin marketplace add ValorBrain/valorbrain-harness
claude plugin install valorbrain@valorbrain
```

Then sign in:

```
/valorbrain:setup
```

The setup skill runs the official installer in MCP-only mode,
`npx -y @valorbrain/connect@0.13.0 --harness claude-code --mcp-only`. It opens a browser page
where you approve this computer (OAuth device flow); ValorBrain creates a token for Claude Code,
revocable on its own under Settings → MCP tokens. The installer writes:

| File | What |
|---|---|
| `~/.valorbrain/connect.json` (0600) | the token, under `claude-code`; the hooks read it from there, never from the command line |
| `~/.claude.json` | a `valorbrain` MCP server at the same URL as the plugin's, so Claude Code connects once (see below) |
| `~/.claude/CLAUDE.md` | a managed instruction block on how to use the memory |

No hooks: in MCP-only mode the installer adds none, and the plugin's are the ones that run.
Start a new session (or `/reload-plugins`). `/valorbrain:status` shows what is connected.

Prefer not to install anything else? The plugin's MCP server also works without the setup:
with no saved token it signs in with OAuth (`/mcp` → `plugin:valorbrain:valorbrain` →
authenticate). The hooks, though, need the token the setup saves; until then they send nothing.

Requirements: Claude Code 2.1.163 or later (the checkpoint uses `additionalContext` on `Stop`;
tested on 2.1.302), Node.js 18+ with `npx`.

## Already installed with `npx @valorbrain/connect`?

Then nothing runs twice:

- **Hooks.** Before doing anything, each plugin hook looks for hooks of the official client
  (its launcher or `npx @valorbrain/connect`) or of a self-hosted engine in
  `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) and in the project's
  `.claude/settings.json` and `.claude/settings.local.json`. If it finds one, it exits at once
  without output: those hooks do the work. `/valorbrain:status` says which file it found.
- **MCP.** Claude Code treats a plugin server at the same URL as one you configured as a
  duplicate and connects only yours. The installer writes `https://mcpbrain.valor.digital/mcp`,
  the plugin's default, so you get one `valorbrain` server.

To let the plugin own the hooks instead (for example, to update them with the plugin), run
`npx -y @valorbrain/connect@0.13.0 --harness claude-code --mcp-only`: it removes the installer's
hooks and keeps its token and MCP entry.

## What leaves your machine, and when

All requests go to the ValorBrain engine the token belongs to
(`https://valorbrain-api.valor.digital` unless you signed in to another one). The full page, per
harness: <https://docs.valorbrain.com.br/docs/concepts/what-leaves-your-machine>.

| When | What is sent |
|---|---|
| Session start | the harness name, the session id and how it started (`startup`, `resume`…); the answer is the context |
| Every prompt | the prompt (up to 8,000 characters) to find relevant memory. **Before it leaves**, the plugin replaces obvious secrets with `[redacted]`: private keys, GitHub/GitLab/OpenAI/Anthropic/Slack/Stripe/AWS/Cloudflare/ValorBrain tokens, JWTs, `Bearer …`, the password in `scheme://user:password@host`, and `NAME=value` where the name says key, token, secret or password. It is a safety net, not a guarantee |
| After a turn | turn counters only (no conversation text); every few turns (never the first, at most 6 per session) the answer asks Claude for a checkpoint, which Claude writes through MCP — or not |
| When Claude calls an MCP tool | what the tool call carries (the query, the note it stores) |
| Each hook | `X-ValorBrain-Client: connect/0.13.0`, the harness, a random install id; for scripted runs (`claude -p`, SDK) a run kind |
| Transcript | **never by default**. Only after `npx -y @valorbrain/connect@0.13.0 --harness claude-code --transcript on`; then the official client uploads the session transcript as is (the plugin's redaction covers prompts, not this file) |

Also: running the hook through `npx` downloads `@valorbrain/connect` from the npm registry the
first time (and npm checks the registry for it on later runs). In the background, at most every
6 hours, the official client fetches the engine's signed manifest and keeps its instruction block
in `~/.claude/CLAUDE.md` current; in MCP-only mode it never adds hooks.

Nothing is sent from a session that is not one of these events, and no file content, diff or
tool output is sent by the hooks.

## Turning it off

| To stop | Do |
|---|---|
| prompts being sent | `VALORBRAIN_SEND_PROMPT=off` in Claude Code's environment, or `npx -y @valorbrain/connect@0.13.0 --harness claude-code --prompt off` |
| the checkpoint | `VALORBRAIN_CHECKPOINT=off`, or `npx -y @valorbrain/connect@0.13.0 --harness claude-code --checkpoint off` |
| the plugin's hooks only (keep MCP) | `VALORBRAIN_PLUGIN_HOOKS=off` |
| the whole plugin | `/plugin` → disable `valorbrain@valorbrain`, or `claude plugin uninstall valorbrain@valorbrain` |
| the token, MCP entry and instructions the setup wrote | `npx -y @valorbrain/connect@0.13.0 --harness claude-code --remove` |

## Configuration

| Variable | Effect |
|---|---|
| `VALORBRAIN_MCP_URL` | the plugin's MCP server URL (default `https://mcpbrain.valor.digital/mcp`), for a self-hosted engine; sign in with `--api <engine>` on the setup command |
| `VALORBRAIN_SOURCE_AGENT`, `VALORBRAIN_AGENT_LANE` | an explicit persona or lane, sent as `X-Source-Agent` / `X-Agent-Lane` |
| `VALORBRAIN_PLUGIN_HOOKS=off` | the plugin's hooks do nothing |

Every switch of the official client (`VALORBRAIN_SEND_PROMPT`, `VALORBRAIN_CHECKPOINT`,
`VALORBRAIN_SEND_TRANSCRIPT`, `VALORBRAIN_RUN_KIND`…) applies as documented in its README.

Claude Code hides credential-looking variables (`*TOKEN*`, `*KEY*`…) from a plugin's MCP
headers helper, so the plugin's MCP server reads its token from `~/.valorbrain/connect.json`,
never from `VALORBRAIN_MCP_TOKEN`.

## Files

```
.claude-plugin/marketplace.json          (repository root) the marketplace: valorbrain
claude-code/plugin/
  .claude-plugin/plugin.json             manifest
  hooks/hooks.json                       SessionStart, UserPromptSubmit, Stop → bin/valorbrain-plugin.mjs hook …
  .mcp.json                              the valorbrain MCP server (HTTP) and its headers helper
  bin/valorbrain-plugin.mjs              hook guard + delegation, prompt redaction, MCP headers, status
  skills/setup/SKILL.md                  /valorbrain:setup
  skills/status/SKILL.md                 /valorbrain:status
claude-code/test/
  plugin.test.mjs                        offline tests
  e2e/run-e2e.sh                         live run: real claude, throwaway HOME, staging engine, mock model
```

## Tests

Offline (no network, no `claude`):

```
node --test claude-code/test/*.test.mjs
```

Live, against a non-production engine, with the real `claude` CLI in a throwaway `HOME`. The
model is a local mock of the Messages API (`test/e2e/mock-anthropic.mjs`), so no Anthropic
account is used and the run is deterministic. It installs the plugin from this repository's
marketplace, signs in with the setup command, checks that the three hooks run the official client
and that the session-start context reaches the model once, stores, finds and forgets a marker
through the plugin's MCP server, then repeats with the installer's MCP entry and hooks present to
check that nothing runs twice:

```
VB_STAGING_URL=… VB_STAGING_MCP_URL=… VB_STAGING_MCP_TOKEN=vbm_… bash claude-code/test/e2e/run-e2e.sh
```

Tested with Claude Code 2.1.302, Node.js 24, `@valorbrain/connect` 0.13.0, on Linux.

## License

MIT, as the rest of this repository.
