import { describe, expect, it } from "vitest";

import type { PublicacaoDaCaixa } from "@/lib/djen/caixa";
import { confereContagem } from "@/lib/djen/conferencia";

/**
 * 0006.E5 (#27) e 0009.E4 (#66) — a conferência da contagem: a data que o
 * escritório confirmou (contada no controle dele) contra a sugestão do sistema.
 *
 * Sugestões contadas à mão no calendário (não pela regra):
 *   - disp. qui 22/10, 5 dias úteis → começa seg 26/10 → vence sex 30/10 (nenhum aviso);
 *   - disp. ter 20/10, 15 dias úteis → começa qui 22/10 → vence qua 11/11 (Finados no caminho);
 *   - disp. qui 22/10, 15 dias úteis → vence sex 13/11.
 */

const CINCO_UTEIS = "Manifeste-se no prazo de 5 (cinco) dias úteis.";
const QUINZE_UTEIS = "Manifeste-se no prazo de 15 (quinze) dias úteis.";
const CINCO_SEM_DIZER = "Manifeste-se no prazo de 5 (cinco) dias.";
const REMISSAO = "DESPACHO. Decorreu o prazo previsto no §2º do art. 903 do CPC; intime-se.";
const DOIS_PRAZOS = "Manifeste-se no prazo de 5 (cinco) dias úteis. Após, recorra no prazo de 15 (quinze) dias úteis.";

let n = 0;
function pub(data: string, texto: string, venceEm: string | null, confirmadoEm = "2026-10-21T15:00:00Z"): PublicacaoDaCaixa {
  n++;
  return {
    id: `p${n}`,
    organizationId: "org",
    numeroProcesso: `000${n}`,
    dataDisponibilizacao: data,
    tipoComunicacao: "Intimação",
    siglaTribunal: "TJSP",
    nomeOrgao: null,
    texto,
    descartadaEm: null,
    prazoConfirmado: venceEm ? { venceEm, confirmadoEm, observacao: null } : null,
  };
}

describe("conferência da contagem", () => {
  it("confirmada igual à sugestão é acerto; sem confirmação fica fora", () => {
    const c = confereContagem([pub("2026-10-22", CINCO_UTEIS, "2026-10-30"), pub("2026-10-22", CINCO_UTEIS, null)], "2026-10-23");
    expect({ confirmadas: c.confirmadas, acertos: c.acertos, divergencias: c.divergencias.length }).toEqual({ confirmadas: 1, acertos: 1, divergencias: 0 });
  });

  it("divergência SEM aviso na sugestão é 'errou' — data errada com cara de certa", () => {
    const c = confereContagem([pub("2026-10-22", CINCO_UTEIS, "2026-11-03")], "2026-10-23");
    expect(c.divergencias.map((d) => ({ sugerida: d.sugerida, confirmada: d.confirmada, diferenca: d.diferenca, julgamento: d.julgamento }))).toEqual([
      { sugerida: "2026-10-30", confirmada: "2026-11-03", diferenca: 4, julgamento: "errou" },
    ]);
  });

  it("divergência que a sugestão avisava (feriado nacional no caminho) é 'incerta'", () => {
    const c = confereContagem([pub("2026-10-20", QUINZE_UTEIS, "2026-11-12")], "2026-10-23");
    expect(c.divergencias.map((d) => [d.sugerida, d.julgamento])).toEqual([["2026-11-11", "incerta"]]);
  });

  it("texto que não declarou útil nem corrido também é aviso: 'incerta'", () => {
    const c = confereContagem([pub("2026-10-22", CINCO_SEM_DIZER, "2026-11-05")], "2026-10-23");
    expect(c.divergencias.map((d) => [d.sugerida, d.julgamento])).toEqual([["2026-10-30", "incerta"]]);
  });

  it("confirmada sem contagem possível (prazo sem número) fica fora da medição, contada à parte", () => {
    const c = confereContagem([pub("2026-10-22", REMISSAO, "2026-11-05")], "2026-10-23");
    expect({ confirmadas: c.confirmadas, semSugestao: c.semSugestao, acertos: c.acertos, divergencias: c.divergencias.length }).toEqual({
      confirmadas: 1,
      semSugestao: 1,
      acertos: 0,
      divergencias: 0,
    });
  });

  it("publicação com dois prazos: bater com qualquer um é acerto", () => {
    expect(confereContagem([pub("2026-10-22", DOIS_PRAZOS, "2026-11-13")], "2026-10-23").acertos).toBe(1);
    expect(confereContagem([pub("2026-10-22", DOIS_PRAZOS, "2026-11-20")], "2026-10-23").divergencias[0]?.sugerida).toBe("2026-10-30");
  });

  it("o paralelo conta desde a primeira confirmação, no dia do foro", () => {
    const c = confereContagem(
      [
        pub("2026-10-22", CINCO_UTEIS, "2026-10-30", "2026-10-10T15:00:00Z"),
        // 22h30 de 01/10 em Brasília é 02/10 em UTC: o dia é 01/10.
        pub("2026-10-22", CINCO_UTEIS, "2026-10-30", "2026-10-02T01:30:00Z"),
      ],
      "2026-10-23",
    );
    expect({ desde: c.desde, diasEmParalelo: c.diasEmParalelo }).toEqual({ desde: "2026-10-01", diasEmParalelo: 22 });
  });

  it("a mesma publicação lida duas vezes conta uma só", () => {
    const p = pub("2026-10-22", CINCO_UTEIS, "2026-10-30");
    expect(confereContagem([p, p], "2026-10-23").confirmadas).toBe(1);
  });

  it("nada confirmado: paralelo não começou", () => {
    expect(confereContagem([pub("2026-10-22", CINCO_UTEIS, null)], "2026-10-23")).toMatchObject({ confirmadas: 0, desde: null, diasEmParalelo: 0 });
  });
});
