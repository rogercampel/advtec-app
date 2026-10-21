---
impacto: nada_mudou
secao: adicionado
titulo: Sugestão de resposta sobre andamento do processo, sempre para aprovação
---

AdvTec (fork), spec 0010.E3. `decideAndamento` (`lib/djen/resposta-de-andamento.ts`) monta, a partir da consulta do caso, uma resposta em linguagem simples, com uma linha por movimentação: a data, o tipo de ato, o tribunal e o processo, e no fim "quem explica é o advogado responsável". A resposta passa pelas travas da OAB e sai **só como sugestão**: não existe caminho de envio. Vai para humano, sem frase nenhuma, quando: a mensagem está vazia, a pessoa pede humano, a pergunta é de mérito (mesmo com publicação disponível), o caso é sigiloso, o contato não tem caso ou publicação, ou a trava segura a frase. Ainda não está ligada ao agente do WhatsApp. Sem migration e sem variável de ambiente nova.
