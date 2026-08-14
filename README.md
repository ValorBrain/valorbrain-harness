# valorbrain-harness — integração ValorBrain para todos os CLIs, num lugar só

> **Por que este repo existe (2026-08-14):** as integrações de harness estavam
> dispersas em quatro endereços — plugin Hermes e OpenClaw nasciam no repo do
> engine, o plugin do ZCode só existia num cache local sem fonte, o Grok não
> tinha integração nenhuma, e as regras dos demais harnesses eram geradas pelo
> `valorbrain setup harness`. Ninguém conseguia responder "onde mexo para
> mudar a integração do X?". Este repo é a resposta.

## Mapa: quem vive onde

Nem tudo **deve** viver aqui. Regra: **a fonte vive onde o instalador dela
roda** — o que o engine instala (`valorbrain setup …`) continua no engine;
o que não tinha fonte ganha fonte aqui.

| Harness | Fonte canônica | Instalado em | Instalação/atualização |
|---|---|---|---|
| **ZCode** | **este repo** (`zcode/`) | `~/.zcode/cli/plugins/cache/valor-digital/valorbrain/<ver>/` | `./install.sh zcode` |
| **Grok** | **este repo** (`grok/`) | `~/.grok/AGENTS.md` + `~/.grok/config.toml` | `./install.sh grok` |
| **Hermes** | engine `src/hermes/` | `~/.hermes/plugins/valorbrain/` | `./install.sh hermes` (copia do engine) |
| **OpenClaw** | engine `src/openclaw/` | `~/.openclaw/extensions/valorbrain/` | `valorbrain setup openclaw` (ou `./install.sh openclaw`) |
| **Claude Code** | engine `src/harness/contract.ts` | `~/.claude/CLAUDE.md` (bloco gerenciado) + hooks | `valorbrain setup harness claude-code` |
| **Kiro** | engine `src/harness/contract.ts` | `~/.kiro/steering/valorbrain.md` + hooks | `valorbrain setup harness kiro` |
| **Codex** | engine `src/harness/contract.ts` | `~/.codex/AGENTS.md` (bloco gerenciado) | `valorbrain setup harness codex` |
| OpenCode / Gemini / Cursor | engine `src/harness/adapters.ts` | respectivos configs | `valorbrain setup harness <id>` |

O contrato de comportamento (consultar antes de responder, declarar
`memory_used`, gravar o que presta) é **um texto só** — `src/harness/contract.ts`
no engine — renderado por harness. Quando ele muda, rode
`valorbrain setup harness --all` para regenerar os blocos gerenciados.

## O laço de qualidade (V3 do PRD-VALOR-VISIBILITY-DIGEST)

Toda integração precisa dos dois lados:

1. **Instrução** — lembrar o agente de declarar os docids usados após
   responder (`memory_used` via MCP, ou `POST /api/v1/memory/used` via REST).
2. **Etiqueta** — o recall entregue traz o docid (`#hex`) ou o caminho de cada
   memória, para declarar ser copiar-e-colar.

## Uso

```bash
./status.sh              # drift check de todos os harnesses
./install.sh zcode       # implanta plugin ZCode (do fonte daqui)
./install.sh grok        # implanta regras + MCP do Grok
./install.sh hermes      # copia do engine src/hermes → ~/.hermes
./install.sh openclaw    # rebuild + deploy do plugin (igual ao setup do engine)
```

## Publicação (pendência)

O plugin ZCode declama `github.com/ValorBrain/zcode-valorbrain-plugin` como
fonte no `plugin.json`/marketplace — esse repo remoto precisa receber o push
deste fonte (o marketplace `valor-digital` instala de lá). Até lá, o cache
local é implantado por `install.sh zcode`.
