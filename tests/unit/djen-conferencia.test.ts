import { describe, expect, it } from "vitest";

import type { PublicacaoDaCaixa } from "@/lib/djen/caixa";
import { comparadas, confereContagem, julga, podeConversarSobreConfiar } from "@/lib/djen/conferencia";
import { contaPrazo, type ContagemSugerida } from "@/lib/djen/contagem";

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
const QUINZE_SEM_DIZER = "Manifeste-se no prazo de 15 (quinze) dias.";
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

  it("texto que não declarou útil nem corrido: confirmada ANTES da sugerida (contou corrido) é 'incerta'; depois, 'errou'", () => {
    // disp. qui 22/10, "15 dias" sem dizer: a sugestão assume úteis → 13/11; corrido seria seg 09/11.
    const antes = confereContagem([pub("2026-10-22", QUINZE_SEM_DIZER, "2026-11-09")], "2026-10-23");
    expect(antes.divergencias.map((d) => [d.sugerida, d.diferenca, d.julgamento])).toEqual([["2026-11-13", -4, "incerta"]]);
    // Contar corrido nunca dá data MAIS TARDE: depois da sugerida o aviso não explica nada.
    const depois = confereContagem([pub("2026-10-22", QUINZE_SEM_DIZER, "2026-11-20")], "2026-10-23");
    expect(depois.divergencias.map((d) => [d.diferenca, d.julgamento])).toEqual([[7, "errou"]]);
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

  it("a leitura cortada pelo teto de linhas é marcada", () => {
    expect(confereContagem([], "2026-10-23").cortada).toBe(false);
    expect(confereContagem([], "2026-10-23", { cortada: true }).cortada).toBe(true);
  });
});

describe("julga: o aviso só vale quando explica a direção e o tamanho da diferença", () => {
  // Sugestão com Finados (02/11) no caminho: o feriado NÃO é descontado, então só empurra a data para DEPOIS.
  const comFeriado = contaPrazo("2026-10-20", { dias: 15, contagem: "util", trecho: "" });
  if (comFeriado.situacao !== "sugerida") throw new Error("sem sugestão");

  it.each([
    ["2026-11-11", "acertou"],
    ["2026-11-12", "incerta"], // +1: o escritório não contou Finados — exatamente o que o aviso diz
    ["2026-11-14", "incerta"], // +3: o teto de um feriado
    ["2026-11-15", "errou"], // +4: um feriado não explica
    ["2026-11-25", "errou"], // +14
    ["2026-10-30", "errou"], // −12
    ["2026-11-02", "errou"], // −9
    ["2026-11-10", "errou"], // −1: feriado só empurra para depois
  ])("feriado no caminho, sugerida 11/11, confirmada %s → %s", (confirmada, esperado) => {
    expect(julga(comFeriado, confirmada)).toBe(esperado);
  });

  const base: Extract<ContagemSugerida, { situacao: "sugerida" }> = { situacao: "sugerida", disponibilizada: "2026-12-18", publicada: "", inicio: "", dias: 5, contagem: "util", ultimoDia: "", vence: "2026-12-28", declarada: true, feriados: [], recesso: true };
  it.each([
    ["2026-12-29", "incerta"], // +1
    ["2027-02-01", "incerta"], // +35: o teto do recesso
    ["2027-02-02", "errou"], // +36
    ["2026-12-27", "errou"], // −1: recesso só empurra para depois
  ])("recesso no caminho, sugerida 28/12, confirmada %s → %s", (confirmada, esperado) => {
    expect(julga(base, confirmada)).toBe(esperado);
  });

  it("dois feriados no caminho explicam até 6 dias", () => {
    const dois = { ...base, recesso: false, feriados: [{ data: "2026-12-24", nome: "x" }, { data: "2026-12-25", nome: "Natal" }] };
    expect([julga(dois, "2027-01-03"), julga(dois, "2027-01-04")]).toEqual(["incerta", "errou"]);
  });

  it("sem nenhum aviso, qualquer diferença é 'errou'", () => {
    const limpa = { ...base, recesso: false };
    expect([julga(limpa, "2026-12-29"), julga(limpa, "2026-12-27")]).toEqual(["errou", "errou"]);
  });
});

describe("podeConversarSobreConfiar", () => {
  /** n prazos confirmados e iguais à sugestão, a primeira confirmação em `desde`. */
  const limpas = (n: number, desde: string) =>
    Array.from({ length: n }, (_, i) => pub("2026-10-22", CINCO_UTEIS, "2026-10-30", i === 0 ? `${desde}T15:00:00Z` : "2026-10-21T15:00:00Z"));

  it("30 dias e 20 comparados limpos: pode", () => {
    const c = confereContagem(limpas(20, "2026-09-20"), "2026-10-23");
    expect({ dias: c.diasEmParalelo, comparadas: comparadas(c), pode: podeConversarSobreConfiar(c) }).toEqual({ dias: 33, comparadas: 20, pode: true });
  });

  it("um prazo só há 31 dias: NÃO", () => {
    const c = confereContagem(limpas(1, "2026-09-22"), "2026-10-23");
    expect({ dias: c.diasEmParalelo, pode: podeConversarSobreConfiar(c) }).toEqual({ dias: 31, pode: false });
  });

  it("19 comparados: NÃO; 20: sim (a fronteira)", () => {
    expect(podeConversarSobreConfiar(confereContagem(limpas(19, "2026-09-20"), "2026-10-23"))).toBe(false);
    expect(podeConversarSobreConfiar(confereContagem(limpas(20, "2026-09-20"), "2026-10-23"))).toBe(true);
  });

  it("só 'sem contagem possível' há 31 dias: NÃO — nada foi comparado", () => {
    const sem = Array.from({ length: 25 }, (_, i) => pub("2026-10-22", REMISSAO, "2026-11-05", i === 0 ? "2026-09-22T15:00:00Z" : "2026-10-21T15:00:00Z"));
    const c = confereContagem(sem, "2026-10-23");
    expect({ semSugestao: c.semSugestao, comparadas: comparadas(c), pode: podeConversarSobreConfiar(c) }).toEqual({ semSugestao: 25, comparadas: 0, pode: false });
  });

  it("uma divergência, mesmo avisada: NÃO", () => {
    const c = confereContagem([...limpas(20, "2026-09-20"), pub("2026-10-20", QUINZE_UTEIS, "2026-11-12")], "2026-10-23");
    expect({ divergencias: c.divergencias.length, pode: podeConversarSobreConfiar(c) }).toEqual({ divergencias: 1, pode: false });
  });

  it("leitura cortada: NÃO, por mais limpa que pareça", () => {
    expect(podeConversarSobreConfiar(confereContagem(limpas(20, "2026-09-20"), "2026-10-23", { cortada: true }))).toBe(false);
  });
});
