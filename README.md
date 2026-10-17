# ValorBrain integrations

> **ValorBrain is durable memory for AI agents.** One memory for every agent and
> tool your team uses: decisions, facts, incidents and sessions, retrieved with
> their sources.

This repository holds the open-source integrations that connect ValorBrain to the
agents, automation tools and frameworks people already run. Every integration is
tenant-neutral: you bring a token, nothing of ours ships with credentials.

- **Hosted API:** `https://valorbrain-api.valor.digital` (REST) · `https://mcpbrain.valor.digital/mcp` (MCP, OAuth or `Authorization: Bearer vbm_…`)
- **Docs:** https://docs.valorbrain.com.br
- **Agent onboarding in one line:** tell your agent *"Connect ValorBrain as your memory: read https://valorbrain.com.br/connect.md and follow it."*

## Get a token

```bash
npx -y @valorbrain/cli@latest init --agent --agent-caller <your-agent> --json
```

The JSON carries `mcp_token` (`vbm_…`), which works on the MCP server and on the REST API.
With an account, create one at https://valorbrain.valor.digital/settings/mcp-tokens.

## Integrations

| Integration | What you get | Install | Tested |
|---|---|---|---|
| [**Hermes Agent**](hermes/) | Native `MemoryProvider`: recall into `<memory-context>`, session capture, tools (plugin 1.11.0, vendored from [`valorbrain-cli`](https://github.com/ValorBrain/valorbrain-cli/tree/main/packages/hermes-plugin)) | `./install.sh hermes`, or `pip install "git+https://github.com/ValorBrain/valorbrain-harness#subdirectory=hermes"`; official catalog entry prepared in [`hermes/catalog/`](hermes/catalog/) | Hermes 0.22.0 |
| [**OpenClaw**](openclaw/) | `memory` slot plugin over HTTPS: recall before every turn, opt-in transcript capture, `valorbrain_search` / `valorbrain_get` / `valorbrain_store` tools; hosted or `apiUrl` to your own engine | `openclaw plugins install ./openclaw` (or `./install.sh openclaw`); npm `@valorbrain/openclaw` not yet published | OpenClaw 2026.4.24 |
| [**n8n**](n8n/) | Community node `n8n-nodes-valorbrain`: Store Memory, Write Document (`event_at`), Prepare Context, Search, Forget; usable as an AI Agent tool | Settings → Community Nodes → `n8n-nodes-valorbrain` once published to npm | n8n 2.43.7 |
| [**Dify**](dify/) | Tool plugin: Store memory, Prepare context, Search memory, Forget memory; scope set by the app builder (token, fixed collection or one per end user) | Marketplace submission prepared; local package with `dify plugin package` | dify_plugin 0.9.1, plugin daemon 0.6.11 |
| [**Open WebUI**](open-webui/) | Filter function (recall before each turn, save each finished turn with secrets redacted) and an optional `search_memory` / `remember` tool | Import from URL in Admin Panel → Functions / Workspace → Tools | Open WebUI 0.12.3 plugin contract |
| [**Python**](python/) | `valorbrain` client plus a LangChain retriever, a LangGraph store and CrewAI memory | `pip install "git+https://github.com/ValorBrain/valorbrain-harness#subdirectory=python"` (PyPI `valorbrain` not yet published) | langchain-core 1.6.12, langgraph 1.2.16, crewai 1.15.28 |
| [**MCP clients**](mcp/) | Copy-paste recipes for Goose, Continue, Cline, Roo Code, Kilo Code, LibreChat, AnythingLLM, Zed, Open WebUI, Gemini CLI, Codex, OpenCode and Kiro, plus `server.json` for the MCP Registry | One config block per client, OAuth or `vbm_` bearer | Gemini CLI, Codex, OpenCode, Kiro, Cline CLI and Open WebUI live; the rest against their schema or source |
| [**Claude Code**](claude-code/) | Plugin: session-start and per-prompt recall, memory checkpoint, MCP tools; runs the official `@valorbrain/connect` client and steps aside if it is already installed | `claude plugin marketplace add ValorBrain/valorbrain-harness`, `claude plugin install valorbrain@valorbrain`, then `/valorbrain:setup` | Claude Code 2.1.302 |
| [**Codex**](codex/) | Plugin with the same hooks and MCP server, in the Codex CLI | `codex plugin marketplace add ValorBrain/valorbrain-harness`, `codex plugin add valorbrain@valorbrain`, trust it in `/hooks`, then `$valorbrain:setup` | Codex 0.160.0 |
| [**ZCode**](zcode/) | Plugin: per-prompt recall, bootstrap, write reminders, skill | `./install.sh zcode` or marketplace `valor-digital` → `valorbrain` | — |
| [**Grok**](grok/) | Global rules (`~/.grok/AGENTS.md`) and an MCP example | `./install.sh grok` + [`grok/mcp.example.toml`](grok/mcp.example.toml) | — |

Claude Code, Codex, Cursor, Gemini CLI, Kiro, OpenCode, Grok and omp can also be connected in one
command with the official installer, which writes the MCP entry, the memory rules and the hooks:

```bash
npx -y @valorbrain/connect@latest --token <vbm_…> --harness <claude-code|codex|kiro|gemini-cli|cursor>
```

`openclaw-self-hosted/` keeps the older OpenClaw build that drives a self-hosted engine binary;
new installs should use `openclaw/`.

"Tested" means a real run on 2026-10-17 against a ValorBrain engine, with the host software at that
version, in an isolated home directory. Each integration's README has the exact steps and limits.

## What leaves your machine

Each integration's README has a table of what it sends to ValorBrain, when, and how to turn it off.
Integrations that capture conversations automatically (Hermes, OpenClaw, Open WebUI, Claude Code,
Codex) strip obvious secrets on the client before sending and never block the host when ValorBrain
is slow or down.

## Tests

Offline tests run in CI on every pull request ([`.github/workflows/integrations.yml`](.github/workflows/integrations.yml)).
Live tests run against an engine only when you set the engine URL and a token in the environment;
see each integration's README.

`./status.sh` checks the integrations installed on the current machine against this repository.
CI also runs [`scripts/check-phantom-commands.sh`](scripts/check-phantom-commands.sh), which fails if
markdown cites a CLI subcommand that `npx @valorbrain/cli help --json` does not list.

## License

MIT — see [LICENSE](LICENSE). ZCode plugin: [`zcode/LICENSE`](zcode/LICENSE).
