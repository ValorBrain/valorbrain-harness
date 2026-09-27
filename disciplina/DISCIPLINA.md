# Memória ValorBrain — quando registrar o quê

Você tem acesso ao cérebro da empresa via MCP ValorBrain. Registrar no momento
certo é parte do trabalho, não burocracia. Regras por momento:

## Ao tomar uma DECISÃO (escolha com racional)
→ `decisions` action=record — category, scenario (o que disparou), outcome, reasoning.
Uma decisão que não está no brain vai ser re-debatida do zero na próxima sessão.

## Ao errar e corrigir (erro que outro agente cometeria de novo)
→ `record_lesson` — surface_id (ex.: `deploy`, `postgres`, `frontend`), content
(no imperativo: o que fazer/evitar). Lição sem registro vira erro recorrente.

## Ao notar CONTRADIÇÃO (fato novo conflita com memória, doc ou outra fala)
→ Não sobreponha silenciosamente. `conflicts` action=detect/list; se você tem
autoridade, `upsert_keyed_fact` com evidence; senão, registre e sinalize ao humano.
Contradição ignorada hoje é decisão errada no próximo sprint.

## Ao PASSAR O BASTÃO (fim de sessão, troca de agente, trabalho a meio)
→ `team_handoff` create — summary do estado, open_questions, files_changed.
→ `task_state` ledger_checkpoint — what foi verificado e por quê (sem coverage
declarado o checkpoint não vale). Quem assume sem handoff recomeça do zero.

## Ao aprender algo DURADOURO sobre cliente/projeto/ferramenta
→ `memory_store` (type coerente) — decisões e lições têm ferramenta própria;
use `memory_store` para o resto (observation/milestone/faq).

## Fim de TODA sessão com trabalho real
→ `task_state` action=ledger_checkpoint (what + verified_by + coverage).
O hook de disciplina vai te lembrar — não é ruído, é o trabalho sendo fechado.

Nunca registre: segredo/credencial (usar `secrets`), fato perecível, ou opinião
sem evidência. A memória da empresa é lida por outros agentes e humanos.
