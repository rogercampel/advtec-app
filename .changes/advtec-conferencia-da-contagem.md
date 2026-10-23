---
impacto: capacidade_nova
secao: adicionado
titulo: Conferência da contagem — cada data confirmada contra a sugestão, os 30 dias em paralelo e o gabarito (0006.E5, 0009.E4)
---

AdvTec (fork), issues #27 e #66 do repositório de specs.

**Tela.** A página de publicações ganha a seção "Conferência da contagem". Ela mostra:
- quantos dias de paralelo já correram, desde a primeira confirmação;
- quantos prazos confirmados bateram com a contagem sugerida, e quantos foram COMPARADOS (acertos + divergências; "sem contagem possível" não conta);
- quais divergiram, cada um marcado como "data errada sem aviso" ou "a sugestão avisava".

**Quando a tela fala em confiar.** Só com as quatro condições juntas: 30 dias em paralelo, ao menos 20 prazos comparados (`MINIMO_DE_COMPARADAS`, o tamanho do gabarito pedido ao advogado), nenhuma divergência (nem a avisada) e a leitura inteira. Um prazo só há 31 dias, ou só prazos sem contagem possível, não basta.

**Um juiz só para a tela e o gabarito.** `lib/djen/conferencia.ts` decide se a sugestão acertou.
- "Incerta" é a divergência que o aviso da sugestão EXPLICA em direção e tamanho: feriado nacional no caminho (a sugestão não o desconta) explica uma data confirmada depois, até 3 dias por feriado; o recesso explica depois, até 35 dias; texto que não declarou útil/corrido explica uma data confirmada antes (o escritório contou corrido).
- Qualquer outra diferença é "errou", mesmo com aviso: +14 ou −9 dias contra uma sugestão com feriado no caminho é data errada com cara de certa.
- O aviso geral sobre feriado local não conta.

**Gabarito.** O gabarito do advogado entra em `tests/fixtures/gabarito-contagem.json`, hoje vazio. `tests/unit/djen-contagem-gabarito.test.ts` reprova qualquer linha "errou". A coluna opcional `texto` (o texto da publicação) faz o teste "a leitura bate com o gabarito" conferir também que o sistema lê do texto os mesmos dias e a mesma contagem; sem `texto` o gabarito prova só a aritmética.

**Limites que a tela declara.**
- A página lê no máximo 300 confirmações, as mais recentes. No teto, a conferência avisa "leitura parcial" e não fala em confiar.
- Corrigir a data de um prazo já confirmado SOBRESCREVE a anterior: não há histórico, então uma divergência corrigida some da conferência e a data da confirmação passa a ser a da correção.

Sem migration e sem variável de ambiente nova. A página faz uma leitura a mais: as publicações com prazo confirmado, inclusive já vencido, com teto de 300.
