---
impacto: nada_mudou
secao: adicionado
titulo: As três travas da pesquisa de tese no acervo
---

AdvTec (fork), spec 0004.E5. `lib/acervo/trava-da-tese.ts` traz as três travas. (1) `retiraCitacoesExternas` tira inteira a frase que cita julgado (REsp, AgInt, súmula, apelação…) ausente do acervo do escritório, em qualquer grafia. (2) `travaDaTese` recusa texto do sistema que chame o histórico do escritório de jurisprudência, entendimento consolidado ou pacífico, ou que cite julgado. (3) A mesma trava de previsão da jurimetria. `textoDaTese` monta a frase da tela: argumento usado pelo escritório em N trechos, desfecho com N e data da consulta ao DataJud, o trecho literal entre aspas e as fontes. Sem migration e sem variável de ambiente nova.
