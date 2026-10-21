import { describe, expect, it } from "vitest";

import { paraIso } from "@/lib/datajud/api";
import { AMOSTRA_MINIMA, quantil, tempoAteASentenca, type LinhaParaTempo } from "@/lib/datajud/tempo";

/**
 * Ticket 0007.E4 — tempo do ajuizamento à sentença.
 *
 * Critério 4: mediana e faixa, nunca só média. Critério 3: abaixo do mínimo,
 * "amostra insuficiente". Critério 2: dado de 1888 sai contado. Critério 7:
 * sigilo fora da conta.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - trocar a mediana pela média (`dias.reduce(...)/n`) — o outlier acusa;
 *   - tirar a guarda de duração negativa;
 *   - tirar a guarda de amostra mínima;
 *   - não passar pela higiene (usar `linhas` em vez de `limpos`).
 */

const HOJE = new Date("2026-10-20T12:00:00Z");
const DIA = 86_400_000;

/** Ajuizado em 2025-01-01; sentença `dias` depois. Datas no formato que o espelho grava. */
function processo(dias: number, extra: Partial<LinhaParaTempo> = {}, codigo = 219): LinhaParaTempo {
  const aj = Date.parse("2025-01-01T00:00:00.000Z");
  return {
    data_ajuizamento: paraIso("20250101000000"),
    data_ajuizamento_bruto: "20250101000000",
    nivel_sigilo: 0,
    movimentos: [
      { codigo: 26, nome: "Distribuição", dataHora: "2025-01-02T10:00:00.000Z" },
      { codigo, nome: "Procedência", dataHora: new Date(aj + dias * DIA).toISOString() },
    ],
    ...extra,
  };
}
const lote = (duracoes: number[]) => duracoes.map((d) => processo(d));
const trinta = Array.from({ length: AMOSTRA_MINIMA }, (_, i) => 100 + i * 10); // 100..390

describe("critério 4: mediana e faixa, nunca média", () => {
  it("mediana e faixa interquartil com o N", () => {
    const t = tempoAteASentenca(lote(trinta), { hoje: HOJE });
    expect(t).toMatchObject({ situacao: "calculado", n: 30, medianaDias: 245, faixa: { de: 173, ate: 318 } });
  });

  it("o resultado não tem campo de média — não há como exibi-la por engano", () => {
    const t = tempoAteASentenca(lote(trinta), { hoje: HOJE });
    expect(Object.keys(t).some((k) => /media(?!na)|average|mean/i.test(k))).toBe(false);
  });

  it("um outlier de 20 anos não arrasta a mediana (a média iria a ~490)", () => {
    const comOutlier = [...trinta.slice(0, 29), 7300];
    const t = tempoAteASentenca(lote(comOutlier), { hoje: HOJE });
    expect(t.situacao).toBe("calculado");
    if (t.situacao === "calculado") expect(t.medianaDias).toBe(245);
  });
});

describe("critério 3: amostra mínima", () => {
  it(`com ${AMOSTRA_MINIMA - 1} processos medidos: amostra insuficiente, sem mediana`, () => {
    const t = tempoAteASentenca(lote(trinta.slice(1)), { hoje: HOJE });
    expect(t).toEqual(expect.objectContaining({ situacao: "amostra_insuficiente", n: 29, minimo: AMOSTRA_MINIMA }));
    expect("medianaDias" in t).toBe(false);
  });
});

describe("o que não entra sai contado", () => {
  it("critérios 2 e 7: 1888 e sigilo saem pela higiene, com o número", () => {
    const sujos = [
      processo(200, { data_ajuizamento: "1888-09-20T00:00:00.000Z", data_ajuizamento_bruto: "18880920000000" }),
      processo(200, { nivel_sigilo: 1 }),
      processo(200, { nivel_sigilo: null }),
    ];
    const t = tempoAteASentenca([...lote(trinta), ...sujos], { hoje: HOJE });
    expect(t).toMatchObject({ n: 30, descartados: { sigilo: 2, dataImpossivel: 1, dataIlegivel: 0 } });
  });

  it("sem ajuizamento, sem sentença, sentença sem data e sentença antes do ajuizamento", () => {
    const fora = [
      processo(200, { data_ajuizamento: null, data_ajuizamento_bruto: null }),
      processo(200, {}, 26), // só Distribuição: nenhum movimento de mérito
      processo(200, { movimentos: [{ codigo: 220, nome: "Improcedência", dataHora: "lixo" }] }),
      processo(-30),
    ];
    const t = tempoAteASentenca([...lote(trinta), ...fora], { hoje: HOJE });
    expect(t).toMatchObject({
      n: 30,
      foraDoTempo: { semAjuizamento: 1, semSentenca: 1, sentencaSemData: 1, sentencaAntesDoAjuizamento: 1 },
    });
  });
});

describe("quantil", () => {
  it("interpolação linear entre vizinhos", () => {
    expect(quantil([10, 20, 30, 40], 0.5)).toBe(25);
    expect(quantil([10], 0.25)).toBe(10);
    expect(quantil([1, 2, 3, 4, 5], 0.25)).toBe(2);
  });
});
