# ValorBrain for Codex (plugin)

A [Codex](https://github.com/openai/codex) plugin that gives every session durable memory from
[ValorBrain](https://valorbrain.valor.digital):

- **session start**: what ValorBrain knows about the work, injected as context;
- **every prompt**: the memory relevant to that prompt;
- **every few turns**: a short checkpoint asking Codex to record what is worth keeping;
- **MCP tools**: `memory_retrieve`, `memory_store`, `task_state` and the rest of the
  ValorBrain MCP server, for when Codex decides to look something up or write it down.

The plugin carries no memory logic of its own. Its hooks run the official ValorBrain client,
[`@valorbrain/connect`](https://www.npmjs.com/package/@valorbrain/connect), pinned to
**0.13.0**, the same version the engine pins for hosted installs:

```
npx --no-update-notifier --loglevel=warn -y @valorbrain/connect@0.13.0 hook <event> --harness=codex
```

What the plugin adds is small (`plugin/bin/valorbrain-plugin.mjs`, Node built-ins only, the
same file as the Claude Code plugin's): it steps aside when the official installer's hooks are
already there, redacts obvious secrets from the prompt before handing it over, and passes the
client's answer back without letting the client's background work hold Codex's hook pipes open.

It runs in the Codex CLI and in local threads of the ChatGPT desktop app. Plugins with hooks
are not eligible for OpenAI's public plugin directory, so this one is distributed through this
repository's marketplace.

## Install

```
codex plugin marketplace add ValorBrain/valorbrain-harness
codex plugin add valorbrain@valorbrain
```

In the ChatGPT desktop app: **Plugins → Manage → Marketplace**, add the source
`ValorBrain/valorbrain-harness`, and install **ValorBrain**.

**Trust its hooks.** Codex runs no plugin hook until you trust it, and says nothing about the ones
it skips. In a terminal session, `/hooks` lists the three ValorBrain hooks; trust them. In the
desktop app, the plugin's page offers **Trust all**. An update that changes a hook command asks
again.

Then sign in:

```
$valorbrain:setup
```

The setup skill runs the official installer in MCP-only mode,
`npx -y @valorbrain/connect@0.13.0 --harness codex --mcp-only` (Codex asks before running it
outside the sandbox: it needs the network). It opens a browser page where you approve this
computer (OAuth device flow); ValorBrain creates a token for Codex, revocable on its own under
Settings → MCP tokens. The installer writes:

| File | What |
|---|---|
| `~/.valorbrain/connect.json` (0600) | the token, under `codex`; the hooks read it from there, never from the command line |
| `~/.codex/config.toml` | a `[mcp_servers.valorbrain]` table; Codex uses it instead of the plugin's server of the same name, so there is one server |
| `~/.codex/AGENTS.md` | a managed instruction block on how to use the memory |

No hooks: in MCP-only mode the installer adds none, and the plugin's are the ones that run.
`$valorbrain:status` shows what is connected.

Prefer not to install anything else? The plugin's MCP server also works without the setup: with
no saved token it falls back to OAuth (`codex mcp login valorbrain`). The hooks, though, need the
token the setup saves; until then they send nothing.

Requirements: Codex CLI with plugin hooks (tested on 0.160.0), Node.js 18+ with `npx`.

## Already installed with `npx @valorbrain/connect`?

Then nothing runs twice:

- **Hooks.** Before doing anything, each plugin hook looks for hooks of the official client
  (its launcher or `npx @valorbrain/connect`) or of a self-hosted engine in
  `~/.codex/hooks.json`, `~/.codex/config.toml` (or under `$CODEX_HOME`) and in the project's
  `.codex/hooks.json` and `.codex/config.toml`. If it finds one, it exits at once without output:
  those hooks do the work. `$valorbrain:status` says which file it found.
- **MCP.** A `[mcp_servers.valorbrain]` table in your config replaces the plugin's server of the
  same name (no merge), so you get one `valorbrain` server: the installer's.

To let the plugin own the hooks instead, run
`npx -y @valorbrain/connect@0.13.0 --harness codex --mcp-only`: it removes the installer's hooks
and keeps its token and MCP table.

## What leaves your machine, and when

All requests go to the ValorBrain engine the token belongs to
(`https://valorbrain-api.valor.digital` unless you signed in to another one). The full page, per
harness: <https://docs.valorbrain.com.br/docs/concepts/what-leaves-your-machine>.

| When | What is sent |
|---|---|
| Session start | the harness name, the session id and how it started (`startup`, `resume`…); the answer is the context |
| Every prompt | the prompt (up to 8,000 characters) to find relevant memory. **Before it leaves**, the plugin replaces obvious secrets with `[redacted]`: private keys, GitHub/GitLab/OpenAI/Anthropic/Slack/Stripe/AWS/Cloudflare/ValorBrain tokens, JWTs, `Bearer …`, the password in `scheme://user:password@host`, and `NAME=value` where the name says key, token, secret or password. It is a safety net, not a guarantee |
| After a turn | turn counters only (no conversation text); every few turns (never the first, at most 6 per session) the answer asks Codex for a checkpoint, which Codex writes through MCP — or not |
| When Codex calls an MCP tool | what the tool call carries (the query, the note it stores) |
| Each hook | `X-ValorBrain-Client: connect/0.13.0`, the harness, a random install id; for `codex exec` and SDK runs a run kind |
| Transcript | **never by default**. Only after `npx -y @valorbrain/connect@0.13.0 --harness codex --transcript on`; then the official client uploads the session rollout as is (never for `codex exec` or sub-agent threads; the plugin's redaction covers prompts, not this file) |

Also: running the hook through `npx` downloads `@valorbrain/connect` from the npm registry the
first time (and npm checks the registry for it on later runs). In the background, at most every
6 hours, the official client fetches the engine's signed manifest and keeps its instruction block
in `~/.codex/AGENTS.md` current; in MCP-only mode it never adds hooks.

No file content, diff, command output or tool output is sent by the hooks.

## Turning it off

| To stop | Do |
|---|---|
| prompts being sent | `VALORBRAIN_SEND_PROMPT=off` in Codex's environment, or `npx -y @valorbrain/connect@0.13.0 --harness codex --prompt off` |
| the checkpoint | `VALORBRAIN_CHECKPOINT=off`, or `npx -y @valorbrain/connect@0.13.0 --harness codex --checkpoint off` |
| the plugin's hooks only (keep MCP) | `VALORBRAIN_PLUGIN_HOOKS=off`, or disable them in `/hooks` |
| the plugin's MCP server only | `[plugins."valorbrain@valorbrain".mcp_servers.valorbrain]` with `enabled = false` in `~/.codex/config.toml` |
| the whole plugin | `codex plugin remove valorbrain@valorbrain` |
| the token, MCP table and instructions the setup wrote | `npx -y @valorbrain/connect@0.13.0 --harness codex --remove` |

## Configuration

The plugin's MCP server points at `https://mcpbrain.valor.digital/mcp`; Codex does not expand
variables in a plugin's `.mcp.json`. For a self-hosted engine, sign in with
`--api <engine>` on the setup command and keep the `[mcp_servers.valorbrain]` table it writes
(edit its `url` if needed): it replaces the plugin's server.

The MCP headers helper reads the token from `VALORBRAIN_MCP_TOKEN`, then from
`~/.valorbrain/connect.json` (`codex` entry); only `vbm_` tokens count. It is a one-line
`node -e` script inside `.mcp.json`, because Codex runs the helper without `PLUGIN_ROOT`.

Every switch of the official client (`VALORBRAIN_SEND_PROMPT`, `VALORBRAIN_CHECKPOINT`,
`VALORBRAIN_SEND_TRANSCRIPT`, `VALORBRAIN_RUN_KIND`, `VALORBRAIN_SOURCE_AGENT`…) applies to the
hooks as documented in its README.

## Files

```
.agents/plugins/marketplace.json         (repository root) the marketplace: valorbrain
codex/plugin/
  .codex-plugin/plugin.json              manifest (Codex format, with hooks)
  hooks/hooks.json                       SessionStart, UserPromptSubmit, Stop → bin/valorbrain-plugin.mjs hook …
  .mcp.json                              the valorbrain MCP server (streamable HTTP) and its headers helper
  bin/valorbrain-plugin.mjs              hook guard + delegation, prompt redaction, status
  skills/setup/SKILL.md                  $valorbrain:setup
  skills/status/SKILL.md                 $valorbrain:status
codex/test/
  plugin.test.mjs                        offline tests
  e2e/run-e2e.sh                         live run: real codex, throwaway HOME, staging engine, mock model
```

## Tests

Offline (no network, no `codex`):

```
node --test codex/test/*.test.mjs
```

Live, against a non-production engine, with the real `codex` CLI in a throwaway `HOME`. The
model is a local mock of the Responses API (`test/e2e/mock-openai.mjs`, a custom model
provider), so no OpenAI account is used and the run is deterministic. It installs the plugin from
this repository's marketplace, signs in with the setup command, checks that the three hooks
complete and that the session-start context reaches the model once, stores, finds and forgets a
marker through the plugin's MCP server, then repeats with the installer's MCP table and hooks
present to check that nothing runs twice:

```
VB_STAGING_URL=… VB_STAGING_MCP_URL=… VB_STAGING_MCP_TOKEN=vbm_… bash codex/test/e2e/run-e2e.sh
```

Tested with Codex CLI 0.160.0, Node.js 24, `@valorbrain/connect` 0.13.0, on Linux.

## License

MIT, as the rest of this repository.
