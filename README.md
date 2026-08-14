# valorbrain-harness

> **ValorBrain is durable memory for AI agents.** One brain, every CLI: your
> agents stop re-learning what your team already knows — decisions, facts,
> incidents, sessions — with retrieval that cites its sources.

This repository is the **integration hub for agent harnesses** (CLIs and
agent runtimes). Everything here is what you need to point a harness at
ValorBrain: installers, rule files, plugins and templates — one per harness,
all tenant-neutral (you bring your own credentials; nothing of ours ships
here).

## Install by harness

| Harness | What you get | Install |
|---|---|---|
| **ZCode** | Plugin: per-prompt memory recall, session bootstrap, write reminders, quality-loop skill | Marketplace `valor-digital` → `valorbrain`, or see [`zcode/`](./zcode) |
| **Claude Code** | MCP tools + always-on rules + lifecycle hooks (auto context injection) | `valorbrain setup harness claude-code` |
| **Codex** | MCP tools + always-on rules | `valorbrain setup harness codex` |
| **Kiro** | MCP tools + steering rules + hooks | `valorbrain setup harness kiro` |
| **OpenCode** | MCP tools + instructions + context-injection plugin | `valorbrain setup harness opencode` |
| **Gemini CLI** | MCP tools + rules | `valorbrain setup harness gemini-cli` |
| **Cursor** | MCP tools + rules | `valorbrain setup harness cursor` |
| **Hermes** | Native MemoryProvider plugin (bootstrap + per-turn recall) | Ship `src/hermes/` from the engine repo → `~/.hermes/plugins/valorbrain` |
| **OpenClaw** | `memory` slot plugin (per-turn injection + end-of-session extraction) | `valorbrain setup openclaw` |
| **Grok** | Global rules (`~/.grok/AGENTS.md`) + MCP server config | [`grok/`](./grok) templates + `./install.sh grok` |

`valorbrain` is the engine CLI (self-hosted). On the hosted service you get an
MCP endpoint and a `vbm_…` token instead — see **Modes** below.

## Modes

**Hosted (recommended to start)** — no engine to run. Your harness talks to
the hosted MCP endpoint; the token identifies your tenant.

```toml
# e.g. Grok — ~/.grok/config.toml
[mcp_servers.valorbrain]
command = "npx"
args = ["-y", "@valorbrain/connect", "mcp", "--token=vbm_YOUR_TOKEN_HERE"]
```

**Self-hosted** — you run the engine; harnesses launch it as a local MCP
process or point at your deployment. Same rules/plugins, your infrastructure:

```bash
valorbrain setup harness --detect   # wires every harness found on this machine
valorbrain setup status             # drift check: what's installed, what aged
```

## The quality loop (why the rules exist)

Every integration installs the same two-part contract:

1. **Consult before answering** — memory is authoritative about your
   operation; the agent's training data is not.
2. **Declare what you used** — after answering with retrieved memory, the
   agent calls `memory_used` with the docids it actually relied on. Used
   memories rise in ranking, ignored ones decay, and your dashboard shows
   *counted* utilization instead of guesswork. When the user confirms or
   corrects a memory, the agent passes `verdict="confirmed"|"corrected"` —
   that feeds the trust score.

## Repository layout

```
zcode/    ZCode plugin (canonical source; published to the marketplace repo)
grok/     Grok global rules + MCP config templates (placeholders only)
docs/     INTEGRATIONS.md — per-harness setup details
install.sh / status.sh   deploy + drift-check helpers
```

## Contributing

Adding a harness? The pattern is always the same: **rules file** (the
standing instructions), **MCP entry** (the tools), and — where the harness
supports it — **lifecycle hooks** (automatic context injection). Open an
issue or PR with the harness name and we'll help wire it.

## License

MIT — see [LICENSE](./LICENSE). The ZCode plugin carries its own MIT license
in [`zcode/LICENSE`](./zcode/LICENSE).
