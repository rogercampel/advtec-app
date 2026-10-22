---
impacto: capacidade_nova
secao: adicionado
titulo: Mensagens antigas do WhatsApp trazidas para a conversa, sob demanda
---

AdvTec (fork). No topo de uma conversa de WhatsApp, quando o CRM já não tem mensagem mais antiga, aparece "Buscar mensagens anteriores no WhatsApp": o que o canal guardou daquele contato no pareamento entra na conversa, na ordem em que foi enviado. Rota `POST /api/v1/conversations/[id]/historico`, para quem atende (`agent` em diante) e só em conversa que a pessoa já vê. Repetir não duplica. O passado não dispara nada: a mensagem importada leva `metadata.historico_importado = true`, e a migration 9008 faz os gatilhos de `messages` ignorarem essa marca. Sem ela, a recebida de meses atrás emitia `message.received`, abria demanda e acordaria o agente, a push e o follow-up. A conversa também não sobe para o topo, não ganha "não lida" e o navegador dos atendentes não toca aviso de "nova mensagem". As importadas passam a fazer parte da conversa, então o agente de IA também as lê como contexto. Fica de fora: grupos, e a mídia antiga, que entra como tipo e legenda sem o arquivo. Migration nova (9008, também no `baseline.sql`); sem variável de ambiente nova.
