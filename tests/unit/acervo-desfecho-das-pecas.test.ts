import { describe, expect, it } from "vitest";

import { desfechoDasPecas, type ProcessoNoEspelho } from "@/lib/acervo/desfecho-das-pecas";
import { AMOSTRA_MINIMA } from "@/lib/datajud/tempo";

/**
 * Ticket 0004.E4 — desfecho das peças via DataJud.
 *
 * Critério 8: desfecho sempre com N e data da consulta; abaixo do mínimo,
 * "casos insuficientes" em vez de percentual. Risco da spec: "peça sem número de
 * processo fica sem desfecho, e isso aparece".
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - contar PEÇAS em vez de processos distintos (duas peças do mesmo processo);
 *   - percentual mesmo abaixo do mínimo;
 *   - não passar pela higiene (sigilo entra na conta);
 *   - casar o número pela string do espelho em vez dos 20 dígitos (pego só depois
 *     do caso "espelho com máscara": a primeira rodada deixou esta sobreviver).
 */

/** Número sintético com o tamanho do CNJ; aqui o DV não importa (quem filtra DV é a E3). */
const num = (i: number) => `${String(i).padStart(7, "0")}-00.2024.8.26.0100`;
const digitos = (i: number) => num(i).replace(/\D/g, "");

function noEspelho(i: number, codigo: number | null, extra: Partial<ProcessoNoEspelho> = {}): ProcessoNoEspelho {
  return {
    numero_processo: digitos(i), // o DataJud manda os 20 dígitos, sem máscara
    nivel_sigilo: 0,
    data_ajuizamento: "2024-03-01T00:00:00.000Z",
    data_ajuizamento_bruto: "20240301000000",
    movimentos: codigo === null ? [] : [{ codigo, nome: "x", dataHora: "2025-02-01T00:00:00.000Z" }],
    coletado_em: "2026-10-19T08:00:00Z",
    ...extra,
  };
}

describe("o exemplo da spec: 5 de 7 terminaram procedentes", () => {
  const pecas = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ documento: `d${i}`, processo: num(i) }));
  const espelho = [1, 2, 3, 4, 5].map((i) => noEspelho(i, 219)).concat([noEspelho(6, 220), noEspelho(7, 221)]);
  const r = desfechoDasPecas(pecas, espelho);

  it("contagem com N, sem percentual (abaixo do mínimo)", () => {
    expect(r.n).toBe(7);
    expect(r.procedencia).toEqual({ n: 5, de: 7, percentual: null });
    expect(r.improcedencia).toEqual({ n: 1, de: 7, percentual: null });
    expect(r.casosInsuficientes).toBe(true);
  });

  it("a data da consulta vai junto", () => {
    expect(r.consultadoEm).toEqual({ de: "2026-10-19T08:00:00Z", ate: "2026-10-19T08:00:00Z" });
  });
});

describe(`a partir de ${AMOSTRA_MINIMA} processos com desfecho, sai o percentual`, () => {
  it("percentual ao lado da contagem", () => {
    const ids = Array.from({ length: AMOSTRA_MINIMA }, (_, i) => i + 1);
    const r = desfechoDasPecas(
      ids.map((i) => ({ documento: `d${i}`, processo: num(i) })),
      ids.map((i) => noEspelho(i, i <= 18 ? 219 : 220)),
    );
    expect(r.casosInsuficientes).toBe(false);
    expect(r.procedencia).toEqual({ n: 18, de: 30, percentual: 60 });
    expect(r.improcedencia).toEqual({ n: 12, de: 30, percentual: 40 });
  });
});

describe("o que não entra aparece", () => {
  it("peça sem processo, processo fora do espelho, sigilo e sem desfecho — cada um contado", () => {
    const r = desfechoDasPecas(
      [
        { documento: "sem", processo: null },
        { documento: "fora", processo: num(90) },
        { documento: "sig", processo: num(91) },
        { documento: "tram", processo: num(92) },
        { documento: "ok", processo: num(93) },
      ],
      [noEspelho(91, 219, { nivel_sigilo: 3 }), noEspelho(92, null), noEspelho(93, 220)],
    );
    expect(r.n).toBe(1);
    expect(r.fora).toEqual({ pecasSemProcesso: 1, semEspelho: 1, descartados: 1, semDesfecho: 1 });
  });

  it("duas peças do mesmo processo contam um processo", () => {
    const r = desfechoDasPecas(
      [{ documento: "inicial", processo: num(5) }, { documento: "replica", processo: num(5) }],
      [noEspelho(5, 219)],
    );
    expect(r.n).toBe(1);
  });

  it("o número formatado da peça casa com os 20 dígitos do DataJud", () => {
    const r = desfechoDasPecas([{ documento: "d", processo: num(8) }], [noEspelho(8, 221)]);
    expect(r.procedencia_parcial.n).toBe(1);
  });

  it("e casa também se o espelho trouxer o número com máscara, ou a peça sem", () => {
    const r = desfechoDasPecas(
      [{ documento: "d", processo: digitos(10) }],
      [noEspelho(10, 219, { numero_processo: num(10) })],
    );
    expect(r.procedencia.n).toBe(1);
  });

  it("os dois graus do mesmo processo: os movimentos se somam, vale o de mérito mais recente", () => {
    const r = desfechoDasPecas(
      [{ documento: "d", processo: num(9) }],
      [
        noEspelho(9, 219, { movimentos: [{ codigo: 219, nome: "Procedência", dataHora: "2024-08-01T00:00:00.000Z" }] }),
        noEspelho(9, 220, { movimentos: [{ codigo: 220, nome: "Improcedência", dataHora: "2025-05-01T00:00:00.000Z" }], coletado_em: "2026-10-20T08:00:00Z" }),
      ],
    );
    expect(r.improcedencia.n).toBe(1);
    expect(r.consultadoEm).toEqual({ de: "2026-10-19T08:00:00Z", ate: "2026-10-20T08:00:00Z" });
  });
});
