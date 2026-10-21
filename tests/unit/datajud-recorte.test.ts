import { describe, expect, it } from "vitest";

import { perfilDoRecorte, type Filtro, type LinhaDoRecorte } from "@/lib/datajud/recorte";
import { AMOSTRA_MINIMA } from "@/lib/datajud/tempo";

/**
 * Ticket 0007.E5 — recorte e comparação: o órgão contra os demais do tribunal,
 * na mesma classe.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - não filtrar a classe (outra classe entra na comparação);
 *   - percentual sobre o total do espelho em vez de sobre os com desfecho;
 *   - tirar a guarda de amostra mínima dos desfechos;
 *   - contar o órgão do filtro também em "demais".
 */

const HOJE = new Date("2026-10-20T12:00:00Z");
const ORGAO = 1001;
const FILTRO: Filtro = { rotulo: "Cível TJSP", tribunal: "tjsp", classe_codigo: 7, assunto_codigo: null, orgao_julgador_codigo: ORGAO };

function processo(orgao: number, codigoDoDesfecho: number | null, extra: Partial<LinhaDoRecorte> = {}): LinhaDoRecorte {
  return {
    data_ajuizamento: "2025-01-01T00:00:00.000Z",
    data_ajuizamento_bruto: "20250101000000",
    nivel_sigilo: 0,
    orgao_julgador_codigo: orgao,
    orgao_julgador_nome: orgao === ORGAO ? "1ª Vara Cível" : `Vara ${orgao}`,
    classe_codigo: 7,
    movimentos: codigoDoDesfecho === null ? [] : [{ codigo: codigoDoDesfecho, nome: "x", dataHora: "2025-07-01T00:00:00.000Z" }],
    ...extra,
  };
}
const varios = (n: number, orgao: number, codigo: number | null) => Array.from({ length: n }, () => processo(orgao, codigo));

describe("perfil do órgão", () => {
  const linhas = [
    ...varios(20, ORGAO, 219), // procedência
    ...varios(10, ORGAO, 220), // improcedência
    ...varios(10, ORGAO, 221), // parcial
    ...varios(5, ORGAO, null), // sem desfecho
    ...varios(40, 2002, 220),
    ...varios(20, 3003, 219),
    ...varios(15, 2002, 219, ).map((l) => ({ ...l, classe_codigo: 99 })), // outra classe: fora
  ];
  const p = perfilDoRecorte({ filtro: FILTRO, coletadoEm: "2026-10-19T08:00:00Z", linhas, hoje: HOJE });

  it("critério 1: cada percentual com o seu n e o denominador (os que têm desfecho)", () => {
    expect(p.orgao.desfechos).toEqual({
      situacao: "calculado",
      n: 40,
      procedencia: { n: 20, de: 40, percentual: 50 },
      improcedencia: { n: 10, de: 40, percentual: 25 },
      procedencia_parcial: { n: 10, de: 40, percentual: 25 },
      semDesfecho: 5,
    });
    expect(p.orgao.volume).toBe(45);
  });

  it("os demais são os outros órgãos do tribunal, na mesma classe — sem o próprio órgão e sem outra classe", () => {
    expect(p.demais.orgaos).toBe(2);
    expect(p.demais.volume).toBe(60);
    expect(p.demais.desfechos).toMatchObject({ n: 60, improcedencia: { n: 40 }, procedencia: { n: 20 } });
  });

  it("critério 8: o filtro e a data da coleta vão junto", () => {
    expect(p.filtro).toEqual(FILTRO);
    expect(p.coletadoEm).toBe("2026-10-19T08:00:00Z");
  });

  it("critério 4: o tempo vem da E4, em mediana e faixa", () => {
    expect(p.orgao.tempo).toMatchObject({ situacao: "calculado", n: 40, medianaDias: 181 });
  });
});

describe("critério 3: amostra mínima nos desfechos", () => {
  it(`órgão com ${AMOSTRA_MINIMA - 1} desfechos lidos: amostra insuficiente, sem percentual`, () => {
    const p = perfilDoRecorte({ filtro: FILTRO, coletadoEm: "2026-10-19", linhas: varios(AMOSTRA_MINIMA - 1, ORGAO, 219), hoje: HOJE });
    expect(p.orgao.desfechos).toEqual({ situacao: "amostra_insuficiente", n: AMOSTRA_MINIMA - 1, minimo: AMOSTRA_MINIMA, semDesfecho: 0 });
  });
});

describe("critérios 2 e 7: sigilo e data suja fora, contados", () => {
  it("1888 e sigilo não entram nos percentuais e aparecem nos descartados", () => {
    const linhas = [
      ...varios(30, ORGAO, 219),
      processo(ORGAO, 220, { nivel_sigilo: 5 }),
      processo(ORGAO, 220, { data_ajuizamento: "1888-09-20T00:00:00.000Z" }),
    ];
    const p = perfilDoRecorte({ filtro: FILTRO, coletadoEm: "2026-10-19", linhas, hoje: HOJE });
    expect(p.orgao.desfechos).toMatchObject({ n: 30, procedencia: { percentual: 100 } });
    expect(p.orgao.descartados).toEqual({ sigilo: 1, dataImpossivel: 1, dataIlegivel: 0 });
  });
});
