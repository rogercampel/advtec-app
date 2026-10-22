---
impacto: nada_mudou
secao: adicionado
titulo: Prova de que a minuta não sai do escritório e se declara rascunho
---

AdvTec (fork), spec 0005.E5 (#38), a etapa que libera a minuta para advogado real junto com a trava de citação. É só teste, sem mudança de comportamento: `tests/unit/minuta-nao-sai-do-rascunho.test.ts` segue as importações de runtime a partir de `lib/acervo/minuta.ts` e reprova se ela alcançar chamada de rede fora de uma lista fechada de três (o banco do escritório, o login e a validação da chave do provedor do modelo). Hoje nenhum arquivo de produção importa a minuta, então a prova vale por ausência de caminho: uma trava de releitura fica vermelha no dia em que o primeiro importar, e o lado de quem a usa passa a ser examinado pela mesma regra. Também reprova nome de função ou variável de ato de saída (protocolar, peticionar, assinar, enviar, exportar…) na minuta, e confere que o aviso diz "RASCUNHO" e "a revisão é do advogado". Medido: a minuta alcança 82 módulos e nenhum envia nada. Limites declarados: chamada de rede por forma que o teste não reconhece passa; a lista permitida libera o arquivo inteiro; a chamada ao provedor do modelo sai pela biblioteca de IA, fora do grafo; e fila ou minuta salva no banco não passam pelo grafo (hoje não existe minuta persistida). Sem migration e sem variável de ambiente nova.
