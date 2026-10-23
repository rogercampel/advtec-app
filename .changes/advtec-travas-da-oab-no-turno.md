---
impacto: capacidade_nova
secao: adicionado
titulo: As travas da OAB passam a valer no turno do agente que responde o cliente
---

AdvTec (fork), spec 0001, E2/E3. `lib/oab/travas.ts` já existia, mas só a resposta de andamento do DJEN o chamava: o agente que fala com o cliente não passava por ele. Agora o gate `travas_oab` (`lib/oab/gate-das-travas.ts`, último da cadeia `before_send`, depois do `disclosure`) confere o `send_message` do modelo e os VALORES das variáveis do `send_template`. O texto barrado nunca é enviado, em nenhum caso.

**O que acontece quando a trava dispara.** Promessa de resultado, valor ou prazo de ganho, opinião jurídica, linguagem de propaganda e pergunta de mérito sem deferir ao advogado:
- no 1º veto do turno o modelo recebe um erro instrutivo ("o texto NÃO foi enviado; reformule dizendo que a análise cabe ao advogado, sem prometer nem orientar") e tenta de novo;
- no 2º veto do mesmo turno (o `send_template` conta no mesmo contador) o cliente recebe um aviso curto e a conversa é entregue ao advogado (`contacts.force_human`, passagem com o motivo `trava_da_oab`); o briefing diz o que de fato saiu no turno (nenhuma ou N mensagens);
- pedido de atendimento humano entrega já, sem tentar de novo.

**O que o gate julga.**
- As proibições e a deferência olham o corpo SEM o trecho do template de disclosure da organização: um template honesto ("não garantimos resultado em nenhum caso") não veta toda primeira resposta. A identificação olha o corpo inteiro.
- Na pergunta de mérito, a deferência pode estar em outra mensagem já enviada no mesmo turno (resposta em bolhas).
- "Primeira resposta" é a do MODELO: nenhum envio aceito escrito por ele antes neste contato. Template, aviso de escalação e follow-up determinístico não contam (`lib/oab/primeira-resposta.ts`; o ledger não guarda o autor, então a régua é job de turno do agente, `seq > 0` e mensagem de texto livre).
- A 1ª resposta do modelo sem se declarar atendimento automatizado é vetada e o modelo reescreve; depois de 2 recusas no turno o sistema emenda a frase "Aqui é o atendimento automatizado do escritório." no início, em vez de deixar o cliente sem resposta. A regra de identificação passa a aceitar "Sou o/a assistente virtual…".
- Turno de resposta a mídia sem texto confere só as proibições.

**O aviso ao cliente.** Num follow-up (sem mensagem do cliente) o aviso tem texto próprio e não diz "sua mensagem". O aviso que for o 1º envio da conversa, sem template de disclosure, abre com a identificação como atendimento automatizado.

**A camada.** `travas_oab` aparece em Segurança, nasce LIGADA (sem linha vale ligada) e a organização pode desligá-la. A tela diz (pt/es/en) que desligar a camada dispensa a vedação da OAB no atendimento. O Testar do agente e o follow-up determinístico ainda não a armam.

Migration 9010: alarga os CHECKs de `passagens_de_atendimento` (motivo `trava_da_oab`, origem `trava_de_saida`). `BEFORE_SEND_CHAIN_VERSION` vai a 10. Sem variável de ambiente nova.
