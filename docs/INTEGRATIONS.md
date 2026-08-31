# Integrations — pointing a harness at ValorBrain

Every integration delivers the same three artifact kinds; harnesses differ
only in where each artifact lives:

| Artifact | Purpose | Where it typically lives |
|---|---|---|
| **MCP entry** | The tools (`memory_retrieve`, `memory_store`, `memory_used`, …) | harness MCP config |
| **Rules file** | Standing instructions: consult-first, declare usage, write-back | `CLAUDE.md` / `AGENTS.md` / steering / system prompt |
| **Hooks** (where supported) | Automatic context injection per prompt + end-of-session extraction | harness hook system |

The **published** CLI is `@valorbrain/cli` (`help --json` is the contract).
It does **not** include `setup harness`. What this repo actually runs:

```bash
./install.sh zcode|grok|hermes|openclaw|all
./status.sh
npx @valorbrain/cli init --agent --agent-caller <name>
npx @valorbrain/connect --token vbm_…
```

Hosted docs: https://docs.valor.digital/docs/integrations

## ZCode

Plugin from the `valor-digital` marketplace (name: `valorbrain`). Per-prompt
recall injection, session bootstrap, post-edit write reminder, Stop-event
handoff gate, and the `valorbrain-memory` skill. Requires a hosted MCP URL +
`vbm_` token in the plugin's user config — the token determines the tenant.

```bash
./install.sh zcode
```

Canonical source: [`../zcode/`](../zcode).

## Grok

```bash
./install.sh grok
```

Writes the managed contract block into `~/.grok/AGENTS.md`. Copy MCP from
[`../grok/mcp.example.toml`](../grok/mcp.example.toml) — hosted mode is
`npx -y @valorbrain/connect --token=vbm_…`.

## Claude Code / Cursor / Codex / OpenCode / Gemini CLI / Kiro

No installer in this repo for these (yet). Use MCP:

- HTTP: `https://mcpbrain.valor.digital/mcp` with `Authorization: Bearer vbm_…`
- stdio: `npx -y @valorbrain/connect --token vbm_…`

Per-client steps: https://docs.valor.digital/docs/integrations

## Hermes

Native MemoryProvider plugin (Python). Vendored in `hermes/` — no engine
checkout on the target machine:

```bash
./install.sh hermes
```

Hosted Hermes: MCP via `@valorbrain/connect`, same as any other client.

Activate with `memory.provider: valorbrain` in `~/.hermes/config.yaml`.

## OpenClaw

Vendored bundled dist in `openclaw/dist` — no engine or bun on the target:

```bash
./install.sh openclaw
```

Hosted: MCP via `@valorbrain/connect`.
