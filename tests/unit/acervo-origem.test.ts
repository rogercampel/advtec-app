import { describe, expect, it, vi } from "vitest";

import { DIMENSAO_CONTRATO, paraLinha } from "@/lib/acervo/ingerir";
import { fatia } from "@/lib/acervo/fatiar";
import { citacao, comOrigem, origemDoTrecho } from "@/lib/acervo/origem";
import { searchKnowledge } from "@/lib/agent-engine/agent/search-knowledge";

/**
 * Ticket 0002.E4 — critério 4: toda resposta de busca traz documento de origem
 * e página; resposta sem origem é falha, não degradação.
 *
 * O contrato é o que a INGESTÃO grava (`paraLinha`), não um formato inventado
 * aqui: o primeiro teste passa a metadata real de um pedaço pela porta de saída.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - deixar passar trecho sem origem (tirar o `continue`);
 *   - aceitar página 0 ou ausente (tirar `paginaValida`);
 *   - citação sem a página (`${o.nome}`).
 */

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const vetor = () => Array.from({ length: DIMENSAO_CONTRATO }, () => 0.01);
const PAGINAS = [
  { numero: 1, texto: "CONTESTAÇÃO. " + "O autor não comprovou o dano. ".repeat(40) },
  { numero: 2, texto: "Da prescrição. " + "A pretensão está prescrita. ".repeat(40) },
  { numero: 3, texto: "Dos pedidos. " + "Requer a improcedência. ".repeat(40) },
];

describe("a origem que a ingestão grava sai na resposta", () => {
  it("todo pedaço de um documento real tem documento, nome e página na saída", () => {
    const pedacos = fatia(PAGINAS);
    expect(pedacos.length).toBeGreaterThan(1);
    const hits = pedacos.map((p, i) => {
      const linha = paraLinha(p, vetor(), { id: "doc-1", nome: "Contestação Silva.pdf" }, ORG, "src", "ver", i);
      return { content: linha.content, similarity: 0.8, metadata: linha.metadata };
    });
    const r = comOrigem(hits);
    expect(r.semOrigem).toBe(0);
    expect(r.trechos).toHaveLength(pedacos.length);
    for (const [i, t] of r.trechos.entries()) {
      expect(t.origem).toEqual({
        documento: "doc-1",
        nome: "Contestação Silva.pdf",
        paginaInicial: pedacos[i]!.paginaInicial,
        paginaFinal: pedacos[i]!.paginaFinal,
      });
      expect(t.citacao).toMatch(/^Contestação Silva\.pdf, pp?\. \d/);
    }
  });
});

describe("critério 4: trecho sem origem não sai", () => {
  it.each([
    ["sem metadata", null],
    ["sem documento", { nome: "a.pdf", pagina_inicial: 1, pagina_final: 1 }],
    ["sem nome", { documento: "d", pagina_inicial: 1, pagina_final: 1 }],
    ["sem página", { documento: "d", nome: "a.pdf" }],
    ["página zero", { documento: "d", nome: "a.pdf", pagina_inicial: 0, pagina_final: 1 }],
    ["página em texto", { documento: "d", nome: "a.pdf", pagina_inicial: "1", pagina_final: "1" }],
    ["intervalo invertido", { documento: "d", nome: "a.pdf", pagina_inicial: 4, pagina_final: 2 }],
  ])("%s → retido e contado", (_, metadata) => {
    const r = comOrigem([{ content: "trecho", similarity: 0.9, metadata }]);
    expect(r).toEqual({ trechos: [], semOrigem: 1 });
  });

  it("um trecho sem origem no meio não derruba os outros, e é contado", () => {
    const boa = { documento: "d", nome: "a.pdf", pagina_inicial: 2, pagina_final: 2 };
    const r = comOrigem([
      { content: "um", similarity: 0.9, metadata: boa },
      { content: "dois", similarity: 0.8, metadata: {} },
      { content: "três", similarity: 0.7, metadata: boa },
    ]);
    expect(r.trechos.map((t) => t.texto)).toEqual(["um", "três"]);
    expect(r.semOrigem).toBe(1);
  });
});

describe("citação", () => {
  it("uma página e intervalo", () => {
    expect(citacao({ documento: "d", nome: "Recurso.pdf", paginaInicial: 3, paginaFinal: 3 })).toBe("Recurso.pdf, p. 3");
    expect(citacao({ documento: "d", nome: "Recurso.pdf", paginaInicial: 3, paginaFinal: 4 })).toBe("Recurso.pdf, pp. 3–4");
  });

  it("nome com espaço sobrando sai limpo", () => {
    expect(origemDoTrecho({ documento: "d", nome: "  Parecer.pdf ", pagina_inicial: 1, pagina_final: 1 })?.nome).toBe("Parecer.pdf");
  });
});

describe("de ponta a ponta com a busca da base", () => {
  it("o que `searchKnowledge` devolve passa por `comOrigem` com documento e página", async () => {
    const linhas = [
      { chunk_id: "c1", knowledge_source_id: "s", source_name: "Acervo", content: "Da prescrição.", similarity: 0.9,
        metadata: { documento: "doc-1", nome: "Contestação.pdf", pagina_inicial: 2, pagina_final: 2 } },
      { chunk_id: "c2", knowledge_source_id: "s", source_name: "Acervo", content: "órfão", similarity: 0.85, metadata: {} },
    ];
    const pool = { query: vi.fn(async (sql: string) => (sql.includes("fn_buscar_trechos") ? { rows: linhas } : { rows: [] })) };
    const r = await searchKnowledge(
      pool as never,
      { organizationId: ORG, knowledgeSourceIds: ["s"], query: "prazo para cobrar", topK: 5, threshold: 0.4 },
      { embed: async () => ({ embedding: vetor(), model: "text-embedding-3-small" }) as never },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(comOrigem(r.results)).toEqual({
      trechos: [
        {
          texto: "Da prescrição.",
          similaridade: 0.9,
          origem: { documento: "doc-1", nome: "Contestação.pdf", paginaInicial: 2, paginaFinal: 2 },
          citacao: "Contestação.pdf, p. 2",
        },
      ],
      semOrigem: 1,
    });
  });
});
