---
impacto: nada_mudou
secao: adicionado
titulo: Minuta a partir do acervo, com citação só pelo acervo
---

AdvTec (fork), spec 0005.E1 (#33). `escreveMinuta` (`lib/acervo/minuta.ts`) busca no acervo do escritório os trechos para a peça pedida e pede ao modelo (gpt-6-luna) uma minuta em blocos que segue a estrutura e a linguagem dessas peças. Cada bloco traz os trechos que o modelo diz ter usado, com documento e página, ou sai marcado como texto novo; o código confere que esses trechos existem, não que o argumento está neles. Citação só pelo acervo: o modelo cita escrevendo `[CITA T3: "frase"]`, e a frase só entra, entre aspas e com documento e página, se estiver literal naquele trecho (medido: o Luna devolveu uma citação "literal" com a lei trocada, e ela não entrou). No texto próprio do modelo, frase com algarismo, tribunal, súmula, precedente, relator, verbo de julgamento ou número por extenso vira "[A COMPLETAR: trecho retirado…]" no mesmo lugar — inclusive artigo de lei e endereçamento a desembargador fora de citação; é o custo escolhido. Sem trecho no acervo, ou sem nenhum bloco apoiado nele, a resposta é "Não há base no acervo do escritório para esta peça". A minuta se declara rascunho. Limite conhecido: nome de magistrado sem título nem verbo de julgamento não é reconhecido. Sem tela ainda. Sem migration e sem variável de ambiente nova.
