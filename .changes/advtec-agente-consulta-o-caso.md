---
impacto: capacidade_nova
secao: adicionado
titulo: O agente do WhatsApp responde "como está meu processo" com as publicações do caso
---

AdvTec (fork), spec 0010.E3. O agente ganha a ferramenta `consultar_andamento`, que não recebe argumento nenhum: escritório, contato e conversa vêm do próprio turno, e a pergunta é a última mensagem recebida nessa conversa, lida do banco. Ela devolve a resposta pronta (data, tipo de ato, tribunal e processo, sem interpretação) ou a ordem de passar para humano. Isso acontece quando: não há pergunta, a pessoa pediu humano, a pergunta é de mérito, o caso é sigiloso, não há caso ou não há publicação. No modo assistido, a resposta vira rascunho e só sai com aprovação. Não ligue o envio direto em escritório que use esta ferramenta. Sem migration e sem variável de ambiente nova.
