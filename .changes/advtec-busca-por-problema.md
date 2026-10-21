---
impacto: nada_mudou
secao: adicionado
titulo: Busca por problema no acervo, com origem e sem resposta inventada
---

AdvTec (fork), spec 0004.E1. `buscaPorProblema` (`lib/acervo/busca-por-problema.ts`) busca no acervo do escritório pelo significado (a busca da base, recortada por organização e por fonte). Devolve cada trecho com documento, página e, quando houver, o processo da peça. Quando nada passa do limiar, a resposta é a frase fixa "Não há nada no acervo do escritório sobre isso.", e não sai texto nenhum para enfeitar. Falha do provedor de embedding é falha, nunca "nada encontrado". Sem tela ainda. Sem migration e sem variável de ambiente nova.
