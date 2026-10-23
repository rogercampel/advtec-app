---
impacto: capacidade_nova
secao: adicionado
titulo: Conferência da contagem — cada data confirmada contra a sugestão, os 30 dias em paralelo e o gabarito (0006.E5, 0009.E4)
---

AdvTec (fork), issues #27 e #66 do repositório de specs.

**Tela.** A página de publicações ganha a seção "Conferência da contagem". Ela mostra:
- quantos dias de paralelo já correram, desde a primeira confirmação;
- quantos prazos confirmados bateram com a contagem sugerida;
- quais divergiram, cada um marcado como "data errada sem aviso" ou "a sugestão avisava".

A tela só fala em começar a conversa sobre confiar depois de 30 dias sem divergência (spec 0006).

**Um juiz só para a tela e o gabarito.** `lib/djen/conferencia.ts` decide se a sugestão acertou. "Incerta" é a divergência que a sugestão avisava: feriado nacional no caminho, recesso ou texto que não declarou útil/corrido. "Errou" é data errada com cara de certa. O aviso geral sobre feriado local não conta como aviso.

**Gabarito.** O gabarito do advogado entra em `tests/fixtures/gabarito-contagem.json`, hoje vazio. `tests/unit/djen-contagem-gabarito.test.ts` reprova qualquer linha "errou" e traz linhas sintéticas que provam que o juiz reprova.

Sem migration e sem variável de ambiente nova. A página faz uma leitura a mais: as publicações com prazo confirmado, inclusive já vencido, com teto de 300.
