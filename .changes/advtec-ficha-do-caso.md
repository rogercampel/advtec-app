---
impacto: capacidade_nova
secao: adicionado
titulo: Ficha do caso — o cliente, a conversa, os documentos e a consulta numa página
---

AdvTec (fork), spec 0001.E4 (#18). Nova tela Fichas dos casos, no hub ao lado da Leitura de processo: a lista dos casos mais recentes do escritório (o negócio do funil, ADR 0003) e, para cada um, a ficha que o advogado lê sem abrir a conversa — quem é o cliente, o histórico da conversa em ordem, os documentos que ele enviou (com tipo, tamanho e o atalho para a conversa) e os compromissos. Quem tem papel de atendente ou acima agenda a consulta dali mesmo, pela rota da Agenda, com as mesmas regras de horário, conflito e lembrete. Área, resumo e urgência jurídica são trabalho da triagem jurídica (0001.E3), que ainda não existe: até lá a ficha diz "a definir pela triagem jurídica" e nunca "sem urgência" — quando o cliente escreve palavra de urgência, a mensagem aparece literal, com a data. Mensagens, documentos e compromissos são do cliente, não do negócio: dois casos abertos do mesmo cliente mostram o mesmo histórico. E a ficha mostra só o que a pessoa já pode ver na caixa de entrada: quem atende "só as minhas" não vê ali a conversa atribuída a um colega. Reações e avisos do sistema ficam fora do histórico. Sem migration e sem variável de ambiente nova.
