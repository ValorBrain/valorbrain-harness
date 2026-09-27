# Disciplina ValorBrain — hooks de escrita no harness do cliente

A metade de LEITURA (context-surfacing) já existe: `valorbrain hook
context-surfacing` no UserPromptSubmit/SessionStart injeta o contexto a cada
sessão. Este kit é a metade de ESCRITA: hooks + instruções que estimulam o
AGENTE — com o modelo dele, no contexto dele — a registrar decisões, lições,
contradições, fatos duradouros e handoffs nas tools do ValorBrain, nos
momentos certos.

Por que assim: (1) o "pensar sobre o que lembrar" roda no harness do cliente
(custo zero para o engine — o hot path fica local); (2) funciona com qualquer
harness que tenha hooks ou arquivo de instruções; (3) os registros entram
ESTRUTURADOS (decisions/lessons/handoffs), não como MEMORY.md solto — é a
pilha sombra profissionalizada.

## Instalação por harness

### Claude Code (hooks nativos)
1. Copie o bloco de `claude-code/settings-hooks.json.example` para
   `~/.claude/settings.json` (merge na chave `hooks`).
2. Adicione o conteúdo de `DISCIPLINA.md` ao `CLAUDE.md` do projeto
   (ou ao `~/.claude/CLAUDE.md` global).
3. O hook `context-surfacing` (leitura) já vem do install.sh principal.

### Codex / Gemini CLI / outros (sem hooks de Stop)
1. Adicione `DISCIPLINA.md` ao arquivo de instruções do harness
   (`AGENTS.md`, `GEMINI.md`, etc.).
2. Opcional: tarefa de fim de sessão no fluxo do time ("feche com
   ledger_checkpoint") — o agente cumpre pela instrução, sem hook.

### Regras do conteúdo (para todos)
- Nunca registrar segredo via memory_store — existe o cofre (`secrets`).
- Decisão sem scenario/reasoning não vale: o valor é o racional, não a data.
- Contradição: detectar é barato; deixar para o consolidation tick é caro.

## Status
- claude-code: pronto (Stop hook + instruções).
- codex/gemini: instruções servem hoje; hook nativo a explorar.
