import { describe, expect, it } from "vitest";

import { desfechoDoProcesso, MOVIMENTO_PARA_DESFECHO } from "@/lib/datajud/desfecho";

/**
 * Ticket 0007.E3 — desfecho por movimento. A regra da spec: "movimento
 * desconhecido não vira desfecho", e todo desfecho carrega o movimento que o
 * fundamentou.
 *
 * As fixtures têm a forma MEDIDA em 24/08/2026 na API real (TJSP): movimento é
 * `{codigo, nome, dataHora, complementosTabelados}`, o `dataHora` veio ISO, e
 * existe movimento real sem nome (código 15216 veio com nome ausente).
 *
 * MUTAÇÕES (24/08/2026), feitas e conferidas uma a uma:
 *  - 221 removido do mapa → vermelho em "procedência em parte".
 *  - escolha por ordem do array em vez de dataHora → vermelho em "vale o mais
 *    recente pela DATA, não pela posição".
 *  - ramo conflito_sem_data removido → vermelho em "empate de ignorância".
 *  - contagem de ilegíveis removida → vermelho em "sujeira contada".
 *  - mapa aberto (todo código vira procedência) → vermelho em "movimento
 *    desconhecido não vira desfecho".
 */

/** A forma real: rotina de cartório que domina a amostra (51, 26, 92...). */
const ROTINA = [
  { codigo: 26, nome: "Distribuição", dataHora: "2026-01-10T10:00:00.000Z" },
  { codigo: 51, nome: "Conclusão", dataHora: "2026-02-01T09:00:00.000Z" },
  { codigo: 92, nome: "Publicação", dataHora: "2026-02-02T09:00:00.000Z" },
];

function mov(codigo: number, dataHora: string, nome: string | undefined = "x") {
  return { codigo, nome, dataHora, complementosTabelados: [] };
}

describe("o mapa só tem o que foi medido", () => {
  it.each([
    [219, "procedencia"],
    [220, "improcedencia"],
    [221, "procedencia_parcial"],
  ] as const)("código %i → %s", (codigo, esperado) => {
    const r = desfechoDoProcesso([...ROTINA, mov(codigo, "2026-03-01T12:00:00.000Z")]);
    expect(r.desfecho).toBe(esperado);
    expect(r.motivo).toBe("mapeado");
    expect(r.fundamento?.codigo).toBe(codigo);
  });

  it("o mapa tem exatamente os três códigos medidos — ampliar é medir de novo", () => {
    expect(Object.keys(MOVIMENTO_PARA_DESFECHO).sort()).toEqual(["219", "220", "221"]);
  });

  it("movimento desconhecido não vira desfecho — nem o Provimento (237), que é de recurso", () => {
    // 237 apareceu na amostra real e ficou FORA de propósito: reforma de
    // recurso contada como procedência da instância mentiria a estatística.
    const r = desfechoDoProcesso([...ROTINA, mov(237, "2026-03-01T12:00:00.000Z")]);
    expect(r.desfecho).toBeNull();
    expect(r.motivo).toBe("sem_movimento_de_merito");
  });

  it("processo só de rotina de cartório → sem desfecho, dito com o motivo", () => {
    const r = desfechoDoProcesso(ROTINA);
    expect(r.desfecho).toBeNull();
    expect(r.fundamento).toBeNull();
    expect(r.motivo).toBe("sem_movimento_de_merito");
  });
});

describe("mais de um movimento de mérito", () => {
  it("vale o mais recente pela DATA, não pela posição no array", () => {
    // Improcedência DEPOIS no array, mas ANTES no tempo — embargos viraram o
    // jogo. A ordem do array não é garantia de cronologia.
    const r = desfechoDoProcesso([
      mov(219, "2026-06-01T12:00:00.000Z"),
      mov(220, "2026-03-01T12:00:00.000Z"),
    ]);
    expect(r.desfecho).toBe("procedencia");
    expect(r.fundamento?.dataHora).toBe("2026-06-01T12:00:00.000Z");
  });

  it("empate de ignorância: dois de mérito e um sem data legível → null, com o motivo dito", () => {
    const r = desfechoDoProcesso([
      mov(219, "2026-06-01T12:00:00.000Z"),
      { codigo: 220, nome: "Improcedência" }, // sem dataHora
    ]);
    expect(r.desfecho).toBeNull();
    expect(r.motivo).toBe("conflito_sem_data");
  });

  it("um único movimento de mérito sem data ainda é desfecho — não há o que ordenar", () => {
    const r = desfechoDoProcesso([...ROTINA, { codigo: 220, nome: "Improcedência" }]);
    expect(r.desfecho).toBe("improcedencia");
    expect(r.fundamento?.dataHora).toBeNull();
  });
});

describe("a sujeira da fonte", () => {
  it("item ilegível é contado, não engolido — e não derruba a leitura", () => {
    const r = desfechoDoProcesso([
      "corrompido",
      null,
      { nome: "sem código" },
      mov(219, "2026-03-01T12:00:00.000Z"),
    ]);
    expect(r.desfecho).toBe("procedencia");
    expect(r.ilegiveis).toBe(3);
  });

  it("movimento sem nome (medido: código 15216 veio assim) não quebra nada", () => {
    const r = desfechoDoProcesso([{ codigo: 15216, dataHora: "2026-01-01T00:00:00.000Z" }]);
    expect(r.motivo).toBe("sem_movimento_de_merito");
    expect(r.ilegiveis).toBe(0);
  });

  it("dataHora no formato compacto do CNJ é lida — o fundamento sai em ISO", () => {
    // A api.ts mediu "20260629120145" em dataAjuizamento; o mesmo formato em
    // movimento não pode cegar a ordenação.
    const r = desfechoDoProcesso([
      { codigo: 219, nome: "Procedência", dataHora: "20260301120000" },
      { codigo: 220, nome: "Improcedência", dataHora: "2026-06-01T12:00:00.000Z" },
    ]);
    expect(r.desfecho).toBe("improcedencia");
    expect(r.fundamento?.dataHora).toBe("2026-06-01T12:00:00.000Z");
  });
});
