---
impacto: nada_mudou
secao: adicionado
titulo: Minuta a partir do acervo, sem citação de fora dele
---

AdvTec (fork), spec 0005.E1 (#33). `escreveMinuta` (`lib/acervo/minuta.ts`) busca no acervo do escritório os trechos para a peça pedida e pede ao modelo (gpt-6-luna) uma minuta em blocos que segue a estrutura e a linguagem dessas peças. Cada bloco aponta os trechos em que se apoia, com documento e página, ou sai marcado como texto novo. Citação de julgado ou súmula que não está nos trechos lidos não sai em forma nenhuma, nem na lista do que faltou: a frase é retirada e o lugar fica marcado "[A COMPLETAR]". Sem trecho no acervo, a resposta é "Não há base no acervo do escritório para esta peça", e o modelo nem é chamado. A minuta se declara rascunho. Sem tela ainda. Sem migration e sem variável de ambiente nova.
