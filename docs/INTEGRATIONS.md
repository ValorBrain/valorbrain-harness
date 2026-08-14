# Integrations — pointing a harness at ValorBrain

Every integration delivers the same three artifact kinds; harnesses differ
only in where each artifact lives:

| Artifact | Purpose | Where it typically lives |
|---|---|---|
| **MCP entry** | The tools (`memory_retrieve`, `memory_store`, `memory_used`, …) | harness MCP config |
| **Rules file** | Standing instructions: consult-first, declare usage, write-back | `CLAUDE.md` / `AGENTS.md` / steering / system prompt |
| **Hooks** (where supported) | Automatic context injection per prompt + end-of-session extraction | harness hook system |

Self-hosted installs use one command per harness via the engine CLI:

```bash
valorbrain setup harness --detect   # install for every harness found
valorbrain setup harness claude-code --dry-run
valorbrain setup status             # verify + drift check
valorbrain setup harness claude-code --remove
```

## ZCode

Plugin from the `valor-digital` marketplace (name: `valorbrain`). Per-prompt
recall injection, session bootstrap, post-edit write reminder, Stop-event
handoff gate, and the `valorbrain-memory` skill. Requires a hosted MCP URL +
`vbm_` token in the plugin's user config — the token determines the tenant.

Canonical source: [`../zcode/`](../zcode) (published to the marketplace
repository on every release).

## Claude Code

- MCP: `~/.claude.json` → `mcpServers.valorbrain`
- Rules: managed block in `~/.claude/CLAUDE.md`
- Hooks: `SessionStart`, `UserPromptSubmit`, `PreCompact`, `Stop` in
  `~/.claude/settings.json` (context injection + decision/episode/handoff
  extraction)

## Codex / Gemini CLI / Cursor

MCP + managed rules block; no lifecycle hook system, so consulting memory is
enforced by the rules text rather than injection.

- Codex: `~/.codex/config.toml` (`[mcp_servers.valorbrain]`, TOML) + `~/.codex/AGENTS.md`
- Gemini CLI: `~/.gemini/settings.json` + `~/.gemini/GEMINI.md`
- Cursor: `~/.cursor/mcp.json` + project `.cursor/rules` (user-level pickup
  is best-effort)

## Kiro

MCP (`~/.kiro/settings/mcp.json`), always-included steering
(`~/.kiro/steering/valorbrain.md`) and JSON hooks
(`~/.kiro/hooks/valorbrain.json`).

## OpenCode

MCP + `instructions[]` reference + an experimental lifecycle plugin
(`chat.message` → retrieval, `experimental.chat.system.transform` →
injection).

## Hermes

Native MemoryProvider plugin (Python). Install from the engine repo:

```bash
cp -r /path/to/valorbrain-engine/src/hermes ${HERMES_HOME:-~/.hermes}/plugins/valorbrain
hermes memory list   # should list valorbrain
```

Activate with `memory.provider: valorbrain` in `~/.hermes/config.yaml`.

## OpenClaw

```bash
valorbrain setup openclaw
```

Registers the `memory` slot plugin (`before_prompt_build` context injection,
`agent_end` extraction) and the `valorbrain_*` REST tools.

## Grok

Grok reads global rules from `~/.grok/AGENTS.md` and MCP servers from
`~/.grok/config.toml`:

```bash
./install.sh grok   # installs the managed rules block
# then copy the MCP section (hosted or self-hosted) from grok/mcp.example.toml
```

## Adding a new harness

1. Find where its MCP config lives (that's the tools).
2. Find the always-on instructions file (that's the rules) — render the
   contract from the engine's `src/harness/contract.ts` so every harness
   drifts together.
3. If it has lifecycle hooks, wire `context-surfacing` on prompt submit and
   the extractors on session end.
4. Add a drift check to `status.sh` so integration age is measurable.
