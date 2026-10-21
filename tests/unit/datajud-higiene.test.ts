import { describe, expect, it } from "vitest";

import {
  eDataIlegivel,
  eDataImpossivel,
  ePublico,
  higieniza,
  totalDescartado,
  type ParaEstatistica,
} from "@/lib/datajud/higiene";

/**
 * Ticket 0007.E2 — higiene.
 *
 * A E1 guarda o lixo (fidelidade). Esta etapa decide o que NÃO entra na conta e
 * devolve o tamanho do que saiu — critérios 2 e 7 da spec 0007.
 *
 * MUTAÇÕES (19/08/2026), feitas e conferidas:
 *
 *  - `ePublico` passando a aceitar `null` → vermelho em "sigilo nulo NÃO é
 *    público". É a mutação que importa: nulo entrando na conta é sigilo
 *    quebrado, não estatística maior.
 *  - `eDataImpossivel` devolvendo sempre `false` → vermelho em 1888 e futuro.
 *  - `eDataIlegivel` devolvendo sempre `false` → vermelho em "formato trocado".
 *  - a soma de `totalDescartado` trocada por zero → vermelho em "a tabela do
 *    advogado fecha".
 */

function p(over: Partial<ParaEstatistica> = {}): ParaEstatistica {
  return {
    data_ajuizamento: "2026-06-29T12:01:45.000Z",
    data_ajuizamento_bruto: "20260629120145",
    nivel_sigilo: 0,
    ...over,
  };
}

const HOJE = new Date("2026-08-19T12:00:00.000Z");

describe("segredo de justiça não entra em estatística", () => {
  it("só nível 0 é público", () => {
    expect(ePublico(0)).toBe(true);
    expect(ePublico(1)).toBe(false);
    expect(ePublico(5)).toBe(false);
  });

  it("sigilo nulo NÃO é público — a fonte não disse, e não dizer não é liberar", () => {
    // Escolha registrada no cabeçalho do módulo. Errar para o lado de incluir
    // põe processo sob segredo numa conta que o escritório mostra ao cliente.
    expect(ePublico(null)).toBe(false);
  });

  it("o descarte por sigilo é CONTADO, não some", () => {
    const r = higieniza([p(), p({ nivel_sigilo: 1 }), p({ nivel_sigilo: null })], { hoje: HOJE });
    expect(r.total).toBe(1);
    expect(r.descartados.sigilo).toBe(2);
  });
});

describe("data impossível sai, e aparece na contagem", () => {
  it("1888 é descartado — o caso que a spec manda injetar", () => {
    const r = higieniza(
      [p(), p({ data_ajuizamento: "1888-01-01T00:00:00.000Z", data_ajuizamento_bruto: "18880101000000" })],
      { hoje: HOJE },
    );
    expect(r.total).toBe(1);
    expect(r.descartados.dataImpossivel).toBe(1);
  });

  it("data no futuro além do ano que vem também é impossível", () => {
    expect(eDataImpossivel("2030-01-01T00:00:00.000Z", HOJE)).toBe(true);
    expect(eDataImpossivel("2027-01-01T00:00:00.000Z", HOJE)).toBe(false);
    expect(eDataImpossivel("1990-01-01T00:00:00.000Z", HOJE)).toBe(false);
  });

  it("formato trocado é contado à parte — é alarme, não sujeira do CNJ", () => {
    // 1888 é dado velho DELES. Ilegível é o layout tendo mudado: se o CNJ
    // trocar o formato, este número vai a 100% de uma vez, e somá-lo dentro de
    // "impossível" esconderia a troca dentro da sujeira normal.
    expect(eDataIlegivel(null, "sem data")).toBe(true);
    expect(eDataIlegivel(null, null)).toBe(false);
    const r = higieniza([p(), p({ data_ajuizamento: null, data_ajuizamento_bruto: "N/A" })], { hoje: HOJE });
    expect(r.descartados.dataIlegivel).toBe(1);
    expect(r.descartados.dataImpossivel).toBe(0);
  });
});

describe("ausência não é sujeira", () => {
  it("processo sem data NENHUMA continua na conta, e fica visível", () => {
    // Ele ainda serve a desfecho por órgão, que não depende de data. Descartar
    // seria jogar fora dado bom por um cálculo que talvez nem seja feito.
    const r = higieniza([p(), p({ data_ajuizamento: null, data_ajuizamento_bruto: null })], { hoje: HOJE });
    expect(r.total).toBe(2);
    expect(r.semData).toBe(1);
    expect(totalDescartado(r.descartados)).toBe(0);
  });
});

describe("a tabela do advogado fecha", () => {
  it("limpos + descartados = o que entrou", () => {
    const linhas = [
      p(),
      p(),
      p({ nivel_sigilo: 2 }),
      p({ data_ajuizamento: "1888-01-01T00:00:00.000Z", data_ajuizamento_bruto: "18880101000000" }),
      p({ data_ajuizamento: null, data_ajuizamento_bruto: "lixo" }),
    ];
    const r = higieniza(linhas, { hoje: HOJE });
    expect(r.total + totalDescartado(r.descartados)).toBe(linhas.length);
  });

  it("uma linha com dois defeitos conta UMA vez — senão a soma estoura", () => {
    const r = higieniza(
      [p({ nivel_sigilo: 3, data_ajuizamento: "1888-01-01T00:00:00.000Z", data_ajuizamento_bruto: "18880101000000" })],
      { hoje: HOJE },
    );
    expect(totalDescartado(r.descartados)).toBe(1);
    expect(r.descartados.sigilo).toBe(1);
  });

  it("lote vazio devolve zero, não NaN nem exceção", () => {
    const r = higieniza([], { hoje: HOJE });
    expect(r.total).toBe(0);
    expect(totalDescartado(r.descartados)).toBe(0);
  });
});
