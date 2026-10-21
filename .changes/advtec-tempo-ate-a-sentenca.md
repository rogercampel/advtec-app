---
impacto: nada_mudou
secao: adicionado
titulo: Jurimetria: tempo do ajuizamento à sentença em mediana e faixa
---

AdvTec (fork), spec 0007.E4. `tempoAteASentenca` (`lib/datajud/tempo.ts`) calcula, sobre os processos do espelho do DataJud, quantos dias vão do ajuizamento à sentença. A sentença é o movimento de mérito do desfecho. O resultado sai em mediana e faixa interquartil, sempre com o N e sem campo de média. Antes da conta, a higiene tira sigilo e datas impossíveis ou ilegíveis. Saem contados também: processo sem ajuizamento, sem sentença, com sentença sem data e com sentença antes do ajuizamento. Abaixo de 30 processos medidos, o resultado é "amostra insuficiente". Sem tela ainda (é a 0007.E5). Sem migration e sem variável de ambiente nova.
