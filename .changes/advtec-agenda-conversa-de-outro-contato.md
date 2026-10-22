---
impacto: nada_mudou
secao: corrigido
titulo: Marcar compromisso com a conversa de outro contato ou de outra organização volta 404, não 500
---

AdvTec (fork), em arquivo do upstream (`app/api/v1/agenda/agendamentos/_handler.ts`). O banco já recusava essa conversa no INSERT (`fn_appointment_stamp`, migration 0224), então nada era gravado. Mas a recusa saía como erro interno (500), e só depois da checagem de horário. Agora o handler confere a conversa por organização e contato antes de tudo e recusa com `not_found`, como já fazia com o contato. Prova em `tests/invariants/agenda-conversa-alheia-nao-entra.test.ts`. Sem migration e sem variável de ambiente nova.
