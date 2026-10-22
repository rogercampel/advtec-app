---
impacto: nada_mudou
secao: corrigido
titulo: Usuário logado não consegue mais gravar fala falsa de cliente pela marca de histórico importado
---

AdvTec (fork), correção de segurança da migration 9008, achada na auditoria de 22/10/2026. A 9008 faz os gatilhos de `messages` ignorarem a mensagem marcada como histórico importado. Como `messages` aceita insert de qualquer membro da organização pela API, um usuário logado (até `viewer`) conseguia gravar uma "fala do cliente" falsa com a marca, e ela entrava sem evento, sem demanda e sem aviso. Sem a marca, esse insert sempre foi recusado (`message.received` é evento reservado ao servidor). A migration 9009 apaga a marca antes do insert quando quem grava não é o servidor, e a trava antiga volta a valer. O importador, que grava pelo cliente de serviço, segue igual. Gate: `tests/invariants/historico-importado-so-do-servidor.test.ts`. Migration nova (9009, também no `baseline.sql`); sem variável de ambiente nova.
