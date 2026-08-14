# Inventário V3 — estado real das integrações (verificado no disco, 2026-08-14)

Nada abaixo é assumido; tudo foi conferido nos arquivos vivos. Fontes:
`~/.claude/`, `~/.hermes/`, `~/.openclaw/`, `~/.kiro/`, `~/.codex/`,
`~/.grok/`, `~/.zcode/`, `/opt/valorbrain/docs/INTEGRATION_SETUP.md`.

| # | Harness | Mecanismo | Onde o recall é injetado | Instrução `memory_used` antes desta sessão | Estado após esta sessão |
|---|---|---|---|---|---|
| 1 | **Claude Code** | Hooks (binário) + MCP + bloco gerenciado em `~/.claude/CLAUDE.md` | `UserPromptSubmit` → `valorbrain hook context-surfacing`; `SessionStart` → bootstrap + postcompact + curator-nudge; `Stop` → extratores | **Sim** — contrato v1, `CLAUDE.md:130` | Inalterado (já ok) |
| 2 | **Kiro CLI** | Hooks JSON + MCP + steering always-on | `~/.kiro/hooks/valorbrain.json` (context-surfacing `--format=text`) | **Sim** — `steering/valorbrain.md:66` | Inalterado (já ok) |
| 3 | **Hermes** | Plugin Python MemoryProvider + MCP hosted | `~/.hermes/plugins/valorbrain/__init__.py`: session-bootstrap no início, context-surfacing por turn (background), fallback REST memory_prepare | **Não** | **Adicionada** — bloco "Quality loop (required after recall)" no guidance do plugin (v1.2.0); fonte re-centralizada no engine `src/hermes/` |
| 4 | **Grok** | — (nada existia) | — | **Não** | **Criada** — `~/.grok/AGENTS.md` (contrato gerenciado) + `[mcp_servers.valorbrain]` no `config.toml` |
| 5 | **OpenClaw** | Plugin `kind: memory` (`before_prompt_build` etc.) | `~/.openclaw/extensions/valorbrain/`: context-surfacing + precompact por turn, session-bootstrap, agent_end extratores | **Não** | **Adicionada** — tool `valorbrain_memory_used` (REST `/api/v1/memory/used`) + instrução first-turn `<valorbrain-quality-loop>` |
| 6 | **Codex** | MCP + bloco gerenciado em `~/.codex/AGENTS.md` | sem hooks — agente consulta via MCP quando quer | **Sim** — `AGENTS.md:78` | Inalterado (já ok) |
| 7 | **ZCode** | Plugin (hooks + skill + vbctl) + MCP HTTP | `hooks/user-prompt-submit` injeta recall `vbctl prepare` por prompt; `session-start` injeta profile+briefing | **Fraca** — SKILL.md dizia "opcional, mas recomendado" | **Fortalecida** — SKILL: regra, não opcional; recall injetado traz lembrete de declarar; plugin 0.2.0 |

## Lacunas conhecidas

- **ZCode remoto**: `plugin.json` declara `github.com/ValorBrain/zcode-valorbrain-plugin`
  (fonte do marketplace `valor-digital`), sem clone local. O fonte agora vive em
  `zcode/` deste repo; falta o push para o GitHub.
- **Hermes drift resolvido**: o instalado (v1.1.0) estava na frente do fonte do
  engine (v1.0.0); o instalado foi trazido para o engine e o V3 aplicado em cima.
- **Grok hooks**: Grok suporta hooks user-scope (`~/.grok/hooks/*.json`,
  SessionStart) — não cabados nesta sessão; hoje Grok é rules+MCP (layer 1),
  sem injeção automática.
- **OpenClaw dist**: o plugin instalado tem `dist/index.js` empacotado —
  rebuild via `bun build src/openclaw/index.ts --outdir dist --target node`
  após editar os fontes (o `install.sh openclaw` daqui automatiza).

## Cobertura medida (baseline 2026-08-14, tenant Valor Digital, janela 7d)

- 283 sessões com contexto entregue · 4 sessões com declaração `memory_used`
  → cobertura **1%** (PRD SC3 alvo: ≥60%).
- 48 declarações `memory_used` no período, concentradas em poucas sessões.
- Recomputar: `GET /api/v1/tenant/value-summary?period=7d` (campo
  `quality.coverage_pct`).
