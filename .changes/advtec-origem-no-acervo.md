---
impacto: nada_mudou
secao: adicionado
titulo: Trecho do acervo só sai com documento e página
---

AdvTec (fork), spec 0002.E4. `comOrigem` (`lib/acervo/origem.ts`) é a porta de saída da busca no acervo do escritório. Cada trecho devolvido sai com documento, nome do arquivo, página inicial e página final, mais a citação pronta ("Contestação.pdf, p. 3"). O trecho que chega sem origem completa é retido e contado, nunca mostrado sem fonte. A origem é a que a ingestão já grava em `ai_chunks.metadata`. Ainda não há tela nem ferramenta chamando a função: ela é a base da 0004. Sem migration e sem variável de ambiente nova.
