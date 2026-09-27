#!/usr/bin/env bash
# Stop hook — lembra o agente de FECHAR o trabalho no brain.
# Sem rede, sem custo: so um lembrete; o agente decide e usa as tools dele.
# Instalacao: ver README.md (fragmento para settings.json)
cat <<'MSG'
[disciplina-valorbrain] Antes de encerrar: se nesta sessão houve decisão tomada,
erro corrigido, contradição detectada, fato duradouro aprendido ou passagem de
bastão — registre com as tools ValorBrain (decisions / record_lesson / conflicts
/ memory_store / team_handoff) e feche com task_state ledger_checkpoint
(what + verified_by + coverage). Sem registro, o próximo recomeça do zero.
MSG
exit 0
