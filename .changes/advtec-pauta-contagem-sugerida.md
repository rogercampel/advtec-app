---
impacto: capacidade_nova
secao: adicionado
titulo: A pauta mostra a contagem sugerida de cada prazo, com a conta e os avisos à mostra (0006.E4)
---

AdvTec (fork), spec 0006.E4 (rogercampel/advtec#21). Cada prazo lido na pauta (`/app/publicacoes`) ganha "Contagem sugerida: vence em dd/mm/aaaa (dia)". Ao lado vêm:
- o rótulo "sugestão do sistema, confira antes de confirmar";
- os avisos, sempre visíveis;
- a conta passo a passo em "Como foi contada".

**A regra é proposta, não decisão.** Ela está em `lib/djen/contagem.ts` e espera as respostas do advogado do piloto (`docs/advtec/decisao-contagem-de-prazo.md`):
- a publicação conta no 1º dia útil depois da disponibilização no DJEN, e o prazo começa no 1º dia útil seguinte;
- o dia do início conta;
- quando o texto não declara, a conta é em dias úteis, com aviso;
- só sábado e domingo saem da conta;
- prazo corrido que termina no fim de semana passa ao próximo dia útil.

**Avisos, sem desconto.** Feriado nacional fixo no caminho aparece pelo nome e não é descontado. O recesso de 20/12 a 20/01 também é só aviso. Feriado local ou móvel, suspensão e prazo em dobro ficam no aviso geral.

**Sem data.** Prazo sem número no texto não ganha data.

**A sugestão não vira vencimento.** Os grupos "vence hoje / na semana" continuam só com data confirmada, e o campo de confirmação não vem preenchido com a sugestão.

Sem migration, sem variável de ambiente nova e sem chamada de modelo.
