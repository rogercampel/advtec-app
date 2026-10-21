import { describe, expect, it } from "vitest";

import { CAMPO_DO_PROCESSO, casosDosNegocios, montaCaixa, type PublicacaoDaCaixa } from "@/lib/djen/caixa";

/**
 * Ticket 0009.E2 — a caixa de não reconhecidas, com o caso modelado como
 * NEGÓCIO do funil (ADR 0003).
 *
 * Critério 5 da spec 0009: "publicação não reconhecida só sai da caixa por uma
 * das três ações". Aqui se prova o lado da caixa: ela é calculada, então a
 * publicação sai SOZINHA quando um negócio ganha o número, e só por isso — ou
 * pelo descarte com motivo.
 */

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const OUTRA = "bbbbbbbb-0000-4000-8000-000000000002";
const NUM = "0001234-56.2026.8.26.0100";

const pub = (id: string, extra: Partial<PublicacaoDaCaixa> = {}): PublicacaoDaCaixa => ({
  id,
  organizationId: ORG,
  numeroProcesso: NUM,
  dataDisponibilizacao: "2026-10-19",
  tipoComunicacao: "Intimação",
  siglaTribunal: "TJSP",
  nomeOrgao: "3ª Vara Cível",
  texto: "Intime-se.",
  descartadaEm: null,
  ...extra,
});

const negocio = (id: string, numero: unknown, org = ORG) => ({
  id,
  organization_id: org,
  title: `Caso ${id}`,
  custom_fields: numero === undefined ? {} : { [CAMPO_DO_PROCESSO]: numero, outro: "x" },
});

describe("o caso é o negócio com número de processo", () => {
  it("só vira caso o negócio que tem o número anotado", () => {
    expect(casosDosNegocios([negocio("n1", NUM), negocio("n2", undefined), negocio("n3", "  ")])).toEqual([
      { id: "n1", organizationId: ORG, numeroProcesso: NUM },
    ]);
  });

  it("número que não é texto não vira caso", () => {
    expect(casosDosNegocios([negocio("n1", 12345678901234567890)])).toEqual([]);
  });
});

describe("a caixa", () => {
  it("sem negócio com o número, a publicação está na caixa", () => {
    const c = montaCaixa([pub("p1")], [negocio("n1", undefined)]);
    expect(c.naoReconhecidas.map((p) => p.id)).toEqual(["p1"]);
  });

  it("quando um negócio ganha o número, a publicação sai da caixa sozinha", () => {
    const c = montaCaixa([pub("p1")], [negocio("n1", "0001234-56.2026.8.26.0100")]);
    expect(c.naoReconhecidas).toEqual([]);
    expect(c.reconhecidas).toEqual([{ publicacao: pub("p1"), casoIds: ["n1"] }]);
  });

  it("o número casa pelos dígitos: pontuação diferente no negócio ainda reconhece", () => {
    const c = montaCaixa([pub("p1")], [negocio("n1", "00012345620268260100")]);
    expect(c.naoReconhecidas).toEqual([]);
  });

  it("negócio de OUTRO escritório com o mesmo número não tira a publicação da caixa", () => {
    const c = montaCaixa([pub("p1")], [negocio("n1", NUM, OUTRA)]);
    expect(c.naoReconhecidas.map((p) => p.id)).toEqual(["p1"]);
  });

  it("descartada com motivo sai da caixa, mas é contada — não some", () => {
    const c = montaCaixa([pub("p1", { descartadaEm: "2026-10-20T10:00:00Z" }), pub("p2")], []);
    expect(c.naoReconhecidas.map((p) => p.id)).toEqual(["p2"]);
    expect(c.descartadas.map((p) => p.id)).toEqual(["p1"]);
  });

  it("publicação sem número de processo fica na caixa — nunca casa por acaso", () => {
    const c = montaCaixa([pub("p1", { numeroProcesso: null })], [negocio("n1", NUM)]);
    expect(c.naoReconhecidas.map((p) => p.id)).toEqual(["p1"]);
  });
});
