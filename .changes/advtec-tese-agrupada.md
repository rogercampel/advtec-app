---
impacto: nada_mudou
secao: adicionado
titulo: Trechos do mesmo argumento agrupados numa tese só
---

AdvTec (fork), spec 0004.E2. `agrupaPorTese` (`lib/acervo/tese.ts`) junta numa tese só os trechos da busca que são o mesmo parágrafo reaproveitado de peça em peça, ignorando acento, pontuação e números, por semelhança de texto (Jaccard ≥ 0,6 sobre trios de palavras, transitivo). Cada tese traz o trecho mais bem colocado à frente, todas as origens e os processos distintos das peças, que é o insumo do desfecho. Paráfrase com outras palavras ainda não agrupa: isso pede embedding. Sem migration e sem variável de ambiente nova.
