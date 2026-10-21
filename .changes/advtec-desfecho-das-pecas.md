---
impacto: nada_mudou
secao: adicionado
titulo: Desfecho das peças do acervo pelo DataJud, com N e data da consulta
---

AdvTec (fork), spec 0004.E4. `desfechoDasPecas` (`lib/acervo/desfecho-das-pecas.ts`) cruza as peças amarradas a processo (0004.E3) com o espelho do DataJud (0007) e devolve quantos processos distintos terminaram em procedência, improcedência ou procedência em parte. Usa o mesmo leitor de desfecho e a mesma higiene de sigilo da jurimetria. A contagem ("5 de 7") sai sempre; o percentual só a partir de 30 processos com desfecho, e abaixo disso o resultado marca "casos insuficientes". Vão junto a data da consulta e o que ficou de fora: peça sem processo, processo fora do espelho, sigilo e processo sem desfecho. Sem migration e sem variável de ambiente nova.
