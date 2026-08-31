# valorbrain-harness

> **ValorBrain is durable memory for AI agents.** One brain, every CLI: your
> agents stop re-learning what your team already knows — decisions, facts,
> incidents, sessions — with retrieval that cites its sources.

This repository is the **integration hub for agent harnesses**. Installers,
rule files, plugins and templates — tenant-neutral. You bring credentials;
nothing of ours ships here.

**Hosted product docs:** https://docs.valor.digital  
**CLI (published):** `npx @valorbrain/cli help --json` — that JSON is the
command contract. There is no `setup harness` subcommand.

## Hosted (start here)

No engine on your laptop. Mint a key, then point MCP at the hosted server.

```bash
npx @valorbrain/cli init --agent --agent-caller grok
```

That talks REST at `https://valorbrain-api.valor.digital` (`vb_agent_` key).

MCP needs a **`vbm_`** token from the app (Settings → MCP tokens) or OAuth:

```toml
# e.g. Grok — ~/.grok/config.toml
[mcp_servers.valorbrain]
command = "npx"
args = ["-y", "@valorbrain/connect", "--token=vbm_YOUR_TOKEN_HERE"]
```

`@valorbrain/connect` is the published alias of `valorbrain mcp` (stdio ↔ HTTP).

## Install from this repo

`./install.sh` is what exists today. It does **not** call a CLI subcommand.

```bash
./install.sh zcode      # marketplace plugin files → ~/.zcode
./install.sh grok       # managed contract in ~/.grok/AGENTS.md
./status.sh             # drift check
```

| Harness | What you get | Install today |
|---|---|---|
| **ZCode** | Plugin: per-prompt recall, bootstrap, write reminders, skill | `./install.sh zcode` or marketplace `valor-digital` → `valorbrain` |
| **Grok** | Global rules (`~/.grok/AGENTS.md`) + MCP example | `./install.sh grok` + [`grok/mcp.example.toml`](./grok/mcp.example.toml) |
| **Hermes** | Native MemoryProvider (self-hosted) | `./install.sh hermes` (plugin is vendored; no engine checkout) |
| **OpenClaw** | `memory` slot plugin (self-hosted) | `./install.sh openclaw` (bundled dist is vendored; no engine checkout) |
| **Claude Code / Cursor / Codex / …** | MCP HTTP or stdio | See [docs.valor.digital/docs/integrations](https://docs.valor.digital/docs/integrations) |

Hermes and OpenClaw plugins are **vendored** in this repo. Refresh them after
an engine change with `scripts/vendor-from-engine.sh`. Hosted customers can
skip both and use MCP via `@valorbrain/connect`.

## The quality loop

1. **Consult before answering** — memory is authoritative about the
   operation; training data is not.
2. **Declare what you used** — `memory_used` with the docids you relied on.
   When the human confirms or corrects, pass `verdict="confirmed"|"corrected"`.

## Phantom commands

CI runs [`scripts/check-phantom-commands.sh`](./scripts/check-phantom-commands.sh).
It fails if markdown cites a CLI subcommand that is not in
`npx @valorbrain/cli help --json`. Unpublished subcommands must not return.

## Layout

```
zcode/     ZCode plugin (canonical source; published to the marketplace)
grok/      Grok contract + MCP config templates (placeholders only)
docs/      INTEGRATIONS.md — per-harness details
install.sh / status.sh
scripts/check-phantom-commands.sh
```

## License

MIT — see [LICENSE](./LICENSE). ZCode plugin: [`zcode/LICENSE`](./zcode/LICENSE).
