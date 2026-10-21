import { describe, expect, it } from "vitest";

import { amarra, chaveDeProcesso, type CasoDoEscritorio } from "@/lib/djen/amarrar";

/**
 * Ticket 0006.E2 — amarração e caixa de não reconhecidas. Critério 3 da spec:
 * "Publicação de processo desconhecido aparece na caixa de não reconhecidas.
 * Nunca é descartada."
 *
 * MUTAÇÕES (24/08/2026), feitas e conferidas uma a uma:
 *  - organização fora da chave composta → vermelho em "mesmo número em
 *    organização diferente NÃO amarra".
 *  - exigência dos 20 dígitos removida → vermelho em "número fora do padrão".
 *  - normalização removida (comparação crua) → vermelho em "formatos diferentes".
 *  - caixa descartada (return sem naoReconhecidas) → vermelho em "nada se perde".
 */

const ORG_A = "org-a";
const ORG_B = "org-b";

/** O mesmo processo nos dois formatos que circulam de verdade. */
const FORMATADO = "0001234-56.2026.8.06.0001";
const SO_DIGITOS = "00012345620268060001";

function caso(over: Partial<CasoDoEscritorio> = {}): CasoDoEscritorio {
  return { id: "caso-1", organizationId: ORG_A, numeroProcesso: FORMATADO, ...over };
}

function pub(numeroProcesso: string | null, organizationId = ORG_A) {
  return { organizationId, numeroProcesso };
}

describe("a chave de processo", () => {
  it("iguala o formatado e o só-dígitos — é o mesmo processo", () => {
    expect(chaveDeProcesso(FORMATADO)).toBe(SO_DIGITOS);
    expect(chaveDeProcesso(SO_DIGITOS)).toBe(SO_DIGITOS);
  });

  it("preserva os zeros à esquerda — comparação numérica casaria o processo errado", () => {
    expect(chaveDeProcesso(FORMATADO)).toMatch(/^000/);
  });

  it("número fora do padrão CNJ não vira chave — vai para exame humano", () => {
    expect(chaveDeProcesso("123456")).toBeNull();
    expect(chaveDeProcesso(SO_DIGITOS.slice(0, 19))).toBeNull(); // 19 dígitos: quase, e quase não casa
    expect(chaveDeProcesso(null)).toBeNull();
    expect(chaveDeProcesso("")).toBeNull();
  });
});

describe("a amarração", () => {
  it("casa a publicação com o caso mesmo em formatos diferentes", () => {
    const r = amarra([pub(SO_DIGITOS)], [caso({ numeroProcesso: FORMATADO })]);
    expect(r.reconhecidas).toHaveLength(1);
    expect(r.reconhecidas[0]!.casoIds).toEqual(["caso-1"]);
    expect(r.naoReconhecidas).toHaveLength(0);
  });

  it("processo desconhecido vai para a caixa — nunca é descartado", () => {
    const r = amarra(
      [pub("9999999-99.2026.8.06.9999")],
      [caso({ numeroProcesso: FORMATADO })],
    );
    expect(r.reconhecidas).toHaveLength(0);
    expect(r.naoReconhecidas).toHaveLength(1);
  });

  it("publicação sem número vai para a caixa", () => {
    const r = amarra([pub(null)], [caso()]);
    expect(r.naoReconhecidas).toHaveLength(1);
  });

  it("caso sem número não amarra publicação sem número — nulo não casa com nulo", () => {
    // A implementação ingênua que compara valores crus faria null === null e
    // amarraria toda publicação sem número a todo caso sem número.
    const r = amarra([pub(null)], [caso({ numeroProcesso: null })]);
    expect(r.reconhecidas).toHaveLength(0);
    expect(r.naoReconhecidas).toHaveLength(1);
  });

  it("nada se perde: reconhecidas + caixa = entrada, com mais de um item em cada lado", () => {
    // N > 1 nos dois lados de propósito — fixture curta já reprovou código certo
    // neste projeto por nunca exercitar o caminho (ver .context/ARMADILHAS.md).
    const publicacoes = [
      pub(FORMATADO),
      pub(SO_DIGITOS),
      pub("1111111-11.2026.8.06.0001"),
      pub(null),
      pub("curto"),
    ];
    const r = amarra(publicacoes, [caso()]);
    expect(r.reconhecidas).toHaveLength(2);
    expect(r.naoReconhecidas).toHaveLength(3);
    expect(r.reconhecidas.length + r.naoReconhecidas.length).toBe(publicacoes.length);
  });

  it("dois casos do escritório com o mesmo processo → a publicação amarra nos dois", () => {
    const r = amarra(
      [pub(FORMATADO)],
      [caso({ id: "caso-1" }), caso({ id: "caso-2", numeroProcesso: SO_DIGITOS })],
    );
    expect(r.reconhecidas[0]!.casoIds).toEqual(["caso-1", "caso-2"]);
  });

  it("mesmo número em organização diferente NÃO amarra", () => {
    // Número de processo é público: duas bancas atuam no mesmo processo. A
    // publicação da banca A dentro do caso da banca B é vazamento entre
    // inquilinos — a armadilha nº 1 deste projeto.
    const r = amarra([pub(FORMATADO, ORG_B)], [caso({ organizationId: ORG_A })]);
    expect(r.reconhecidas).toHaveLength(0);
    expect(r.naoReconhecidas).toHaveLength(1);
  });
});
