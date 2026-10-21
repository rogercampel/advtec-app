---
impacto: nada_mudou
secao: adicionado
titulo: Minuta a partir do acervo, sem citação que o acervo não tenha
---

AdvTec (fork), spec 0005.E1 (#33). `escreveMinuta` (`lib/acervo/minuta.ts`) busca no acervo do escritório os trechos para a peça pedida e pede ao modelo (gpt-6-luna) uma minuta em blocos que segue a estrutura e a linguagem dessas peças. Cada bloco traz os trechos que o modelo diz ter usado, com documento e página, ou sai marcado como texto novo; o código confere que esses trechos existem, não que o argumento está neles. A trava de citação é por apoio, frase a frase, nos blocos e na lista do que faltou: todo número de três dígitos ou mais tem de estar no acervo lido, e a frase que menciona tribunal, súmula, precedente ou relator tem de estar escrita num trecho. A que não passa vira "[A COMPLETAR: trecho retirado…]" no mesmo lugar — paráfrase de citação verdadeira também sai, e o advogado completa. Sem trecho no acervo, ou sem nenhum bloco apoiado nele, a resposta é "Não há base no acervo do escritório para esta peça". A minuta se declara rascunho. Sem tela ainda. Sem migration e sem variável de ambiente nova.
