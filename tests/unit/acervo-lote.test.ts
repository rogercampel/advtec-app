import { describe, expect, it } from "vitest";

import {
  DIMENSAO_CONTRATO,
  estimaTokens,
  ingere,
  type ClienteAcervo,
  type Documento,
  type LinhaChunk,
} from "@/lib/acervo/ingerir";

/**
 * Ticket 0002.E2 — lote e falhas. Dois critérios da spec:
 *
 *   3. "Documento corrompido ou protegido não derruba o lote; aparece na lista
 *      de falhas com o motivo."
 *   7. "Ingestão de 100 documentos respeita o teto de gasto configurado e para
 *      com aviso ao atingir."
 *
 * O teto NÃO é falha: nada há de errado com o documento cortado, e reprocessar
 * com teto maior resolve. Por isso `naoProcessados` é lista própria — falha e
 * corte de orçamento pedem ações opostas, e misturá-los faria o escritório
 * "consertar" documento são.
 *
 * MUTAÇÕES (24/08/2026), feitas e conferidas uma a uma:
 *  - checagem do teto removida → vermelho em "o lote PARA no teto".
 *  - freio movido para DEPOIS de gastar (paga primeiro, pergunta depois) →
 *    vermelho em "o gasto estimado nunca passa do teto".
 *  - restantes não listados após a parada → vermelho em "o que ficou de fora
 *    aparece por nome".
 */

/** Cada documento com conteúdo PRÓPRIO — senão a deduplicação esvazia o lote. */
function paginasDe(doc: Documento) {
  return [
    {
      numero: 1,
      texto:
        `Conteúdo exclusivo do documento ${doc.id}: alegações, fundamentos e ` +
        `pedido, redigidos de forma distinta para não colidir com os demais.`,
    },
  ];
}

function vetor(): number[] {
  return Array.from({ length: DIMENSAO_CONTRATO }, (_, i) => (i % 7) / 10);
}

function acervoEmMemoria() {
  const banco: LinhaChunk[] = [];
  const cliente: ClienteAcervo = {
    async hashesExistentes(_organizationId, kbVersionId) {
      return new Set(
        banco.filter((l) => l.kb_version_id === kbVersionId).map((l) => l.content_hash),
      );
    },
    async proximaPosicao(sourceId, kbVersionId) {
      const usadas = banco
        .filter((l) => l.knowledge_source_id === sourceId && l.kb_version_id === kbVersionId)
        .map((l) => l.position);
      return usadas.length ? Math.max(...usadas) + 1 : 0;
    },
    async inserirChunks(linhas) {
      banco.push(...linhas);
      return { inseridos: linhas.length };
    },
  };
  return { banco, cliente };
}

const DOCS: Documento[] = [
  { id: "doc-1", nome: "inicial.pdf" },
  { id: "doc-2", nome: "contestacao.pdf" },
  { id: "doc-3", nome: "recurso.pdf" },
];

/** O custo real de um documento deste lote, na mesma régua do módulo. */
function custoDeUmDoc(): number {
  return estimaTokens(paginasDe(DOCS[0]!)[0]!.texto);
}

describe("critério 3: a falha não derruba o lote", () => {
  it("o documento protegido aparece na lista com o motivo, e os outros dois entram", async () => {
    const { banco, cliente } = acervoEmMemoria();
    const r = await ingere("org-1", "src-1", "v1", DOCS, {
      extrair: async (doc) => {
        if (doc.id === "doc-2") throw new Error("PDF protegido por senha");
        return paginasDe(doc);
      },
      embedar: async (textos) => textos.map(() => vetor()),
      cliente,
    });

    expect(r.falhas).toEqual([{ documento: "doc-2", motivo: "PDF protegido por senha" }]);
    expect(r.pedacosNovos).toBeGreaterThan(0);
    expect(new Set(banco.map((l) => l.metadata.documento))).toEqual(new Set(["doc-1", "doc-3"]));
    expect(r.paradoPorTeto).toBe(false);
  });
});

describe("critério 7: o teto de gasto", () => {
  const deps = () => {
    const { banco, cliente } = acervoEmMemoria();
    return {
      banco,
      d: {
        extrair: async (doc: Documento) => paginasDe(doc),
        embedar: async (textos: string[]) => textos.map(() => vetor()),
        cliente,
      },
    };
  };

  it("sem teto configurado, o lote inteiro entra — o comportamento da E1 não muda", async () => {
    const { d } = deps();
    const r = await ingere("org-1", "src-1", "v1", DOCS, d);
    expect(r.paradoPorTeto).toBe(false);
    expect(r.naoProcessados).toEqual([]);
    expect(r.gastoEstimadoTokens).toBeGreaterThan(0);
  });

  it("o lote PARA no teto, e o que entrou antes dele fica gravado", async () => {
    const { banco, d } = deps();
    // Cabe UM documento: o segundo estouraria.
    const teto = custoDeUmDoc() + 1;
    const r = await ingere("org-1", "src-1", "v1", DOCS, d, { tetoDeTokens: teto });

    expect(r.paradoPorTeto).toBe(true);
    expect(new Set(banco.map((l) => l.metadata.documento))).toEqual(new Set(["doc-1"]));
    expect(r.falhas).toEqual([]); // teto não é falha
  });

  it("o que ficou de fora aparece por nome — aviso, não silêncio", async () => {
    const { d } = deps();
    const r = await ingere("org-1", "src-1", "v1", DOCS, d, {
      tetoDeTokens: custoDeUmDoc() + 1,
    });
    expect(r.naoProcessados).toEqual(["doc-2", "doc-3"]);
  });

  it("o gasto estimado nunca passa do teto — o freio vem antes de pagar", async () => {
    const { d } = deps();
    const teto = custoDeUmDoc() + 1;
    const r = await ingere("org-1", "src-1", "v1", DOCS, d, { tetoDeTokens: teto });
    expect(r.gastoEstimadoTokens).toBeLessThanOrEqual(teto);
    expect(r.gastoEstimadoTokens).toBeGreaterThan(0);
  });

  it("teto menor que o primeiro documento → nada entra, e os três ficam listados", async () => {
    const { banco, d } = deps();
    const r = await ingere("org-1", "src-1", "v1", DOCS, d, { tetoDeTokens: 1 });
    expect(banco).toHaveLength(0);
    expect(r.paradoPorTeto).toBe(true);
    expect(r.naoProcessados).toEqual(["doc-1", "doc-2", "doc-3"]);
    expect(r.gastoEstimadoTokens).toBe(0);
  });
});
