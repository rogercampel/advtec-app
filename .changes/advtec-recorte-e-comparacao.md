---
impacto: nada_mudou
secao: adicionado
titulo: Jurimetria: perfil do órgão julgador contra os demais do tribunal
---

AdvTec (fork), spec 0007.E5. `perfilDoRecorte` (`lib/datajud/recorte.ts`) monta, para um recorte do espelho do DataJud (tribunal, classe, assunto e órgão julgador), dois lados: o órgão e os demais órgãos do mesmo tribunal na mesma classe. Cada lado traz o volume, os descartados (sigilo e data inválida), os desfechos com cada percentual acompanhado do seu N e do denominador, e o tempo até a sentença em mediana e faixa. Leva junto o filtro e a data da coleta. Abaixo de 30 processos com desfecho, o resultado é "amostra insuficiente". A unidade é o órgão; nada aqui lê nome de pessoa. Sem tela ainda. Sem migration e sem variável de ambiente nova.
