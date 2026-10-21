import { describe, expect, it } from "vitest";

import type { TrechoDaPeca } from "@/lib/acervo/busca-por-problema";
import { agrupaPorTese, jaccard, shingles } from "@/lib/acervo/tese";

/**
 * Ticket 0004.E2 — agrupamento por tese. Critério 2: trechos do mesmo argumento
 * aparecem agrupados, não repetidos.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - unir pelos índices em vez das raízes (C parecido com A e com B, A e B não:
 *     o segundo par sobrescreve o primeiro — pego só pelo caso "ponte");
 *   - raiz no índice maior (o representante deixa de ser o mais bem colocado);
 *   - limiar 0 (tudo vira uma tese só).
 */

const trecho = (texto: string, doc: string, processo: string | null = null): TrechoDaPeca => ({
  texto,
  similaridade: 0.8,
  origem: { documento: doc, nome: `${doc}.pdf`, paginaInicial: 1, paginaFinal: 1 },
  citacao: `${doc}.pdf, p. 1`,
  processo,
});

const PRESCRICAO =
  "A pretensão do autor está fulminada pela prescrição trienal prevista no artigo 206, parágrafo 3º, do Código Civil, pois o fato ocorreu em 10/02/2019 e a ação foi proposta somente em 15/03/2023.";
const PRESCRICAO_OUTRO_CASO =
  "A pretensão do autor está fulminada pela prescrição trienal prevista no artigo 206, parágrafo 3º, do Código Civil, pois o fato ocorreu em 22/07/2018 e a ação foi proposta somente em 01/09/2022.";
const DANO_MORAL = "Não houve dano moral indenizável: o mero dissabor cotidiano não ofende direito da personalidade, conforme a petição já demonstrou.";

describe("critério 2: o mesmo parágrafo reaproveitado é uma tese só", () => {
  it("datas diferentes não separam o mesmo argumento", () => {
    const teses = agrupaPorTese([
      trecho(PRESCRICAO, "contestacao-a", "1002288-81.2025.8.26.0565"),
      trecho(DANO_MORAL, "contestacao-a", "1002288-81.2025.8.26.0565"),
      trecho(PRESCRICAO_OUTRO_CASO, "contestacao-b", "0000939-36.2024.8.26.0358"),
    ]);
    expect(teses).toHaveLength(2);
    expect(teses[0]!.trechos.map((t) => t.origem.documento)).toEqual(["contestacao-a", "contestacao-b"]);
    expect(teses[0]!.processos).toEqual(["1002288-81.2025.8.26.0565", "0000939-36.2024.8.26.0358"]);
    expect(teses[1]!.representante.texto).toBe(DANO_MORAL);
  });

  it("argumentos diferentes não se juntam", () => {
    expect(agrupaPorTese([trecho(PRESCRICAO, "a"), trecho(DANO_MORAL, "b")])).toHaveLength(2);
  });

  it("transitivo: A~B e B~C põem A, B e C na mesma tese, com o mais bem colocado à frente", () => {
    const base = "o contrato foi rescindido por culpa exclusiva da ré que deixou de entregar o imóvel no prazo combinado entre as partes";
    const a = `${base} conforme cláusula quinta`;
    const b = `${base} conforme cláusula quinta e notificação`;
    const c = `${base} e notificação extrajudicial enviada`;
    const teses = agrupaPorTese([trecho(a, "1"), trecho(DANO_MORAL, "x"), trecho(b, "2"), trecho(c, "3")]);
    expect(teses.map((t) => t.trechos.map((x) => x.origem.documento))).toEqual([["1", "2", "3"], ["x"]]);
    expect(teses[0]!.representante.origem.documento).toBe("1");
  });
});

describe("a ponte: C parece com A e com B, mas A e B não se parecem", () => {
  const A = "o autor nao comprovou o fato constitutivo do seu direito nos autos segundo o artigo trezentos";
  const B = "desde a inicial o autor nao comprovou o fato constitutivo do seu direito nos autos";
  const C = "desde a inicial o autor nao comprovou o fato constitutivo do seu direito nos autos segundo o artigo";

  it("pré-condição medida: A~C e B~C passam do limiar, A~B não", () => {
    expect(jaccard(shingles(A), shingles(B))).toBeLessThan(0.6);
    expect(jaccard(shingles(A), shingles(C))).toBeGreaterThanOrEqual(0.6);
    expect(jaccard(shingles(B), shingles(C))).toBeGreaterThanOrEqual(0.6);
  });

  it("os três ficam na mesma tese, com A (o mais bem colocado) à frente", () => {
    const teses = agrupaPorTese([trecho(A, "a"), trecho(B, "b"), trecho(C, "c")]);
    expect(teses).toHaveLength(1);
    expect(teses[0]!.representante.origem.documento).toBe("a");
  });
});

describe("as peças", () => {
  it("shingles ignoram acento, pontuação e número", () => {
    expect(shingles("Prescrição, em 10/02/2019!")).toEqual(shingles("prescricao em 22 07 2018"));
  });

  it("jaccard", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it("lista vazia não tem tese", () => expect(agrupaPorTese([])).toEqual([]));
});
