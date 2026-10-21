import { describe, expect, it, vi } from "vitest";

import { NADA_NO_ACERVO, buscaPorProblema, buscadorPg } from "@/lib/acervo/busca-por-problema";

/**
 * Ticket 0004.E1 — busca por problema, sobre a busca da base.
 *
 * Critério 3: todo trecho traz documento e página. Critério 4 (armadilha, roda
 * em todo commit): matéria ausente do acervo → "não há nada no acervo sobre
 * isso", nunca um texto plausível.
 *
 * NÃO MEDIDO: o critério 1 (achar a peça descrevendo o problema sem as palavras
 * dela) depende do embedding real do provedor — chamada paga. Aqui o embedding é
 * injetado; o que se prova é a camada em volta. A medição com três casos de
 * referência fica para quando houver a autorização de gasto.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - devolver "encontrado" com lista vazia em vez de `nada_no_acervo`;
 *   - parear o processo pelo índice do resultado cru (o trecho sem origem desalinha);
 *   - tratar falha da busca como "nada no acervo".
 */

const vetor = () => Array(1536).fill(0.1);
const embed = async () => ({ embedding: vetor(), model: "text-embedding-3-small" }) as never;
const ARGS = { organizationId: "org-a", fontesDoAcervo: ["fonte-a"], problema: "cliente cobrado depois de cancelar o plano" };

function pool(linhas: unknown[]) {
  return { query: vi.fn(async (sql: string) => (sql.includes("fn_buscar_trechos") ? { rows: linhas } : { rows: [] })) } as never;
}
const hit = (content: string, similarity: number, metadata: Record<string, unknown>) => ({
  chunk_id: content, knowledge_source_id: "fonte-a", source_name: "Acervo", content, similarity, metadata,
});
const origem = (doc: string, pagina: number, processo?: string) => ({
  documento: doc, nome: `${doc}.pdf`, pagina_inicial: pagina, pagina_final: pagina, ...(processo ? { processo } : {}),
});

describe("critério 3: todo trecho com documento, página e processo", () => {
  it("trechos com origem, na ordem da busca, e o processo da peça quando houver", async () => {
    const linhas = [
      hit("órfão sem origem", 0.9, { processo: "0000939-36.2024.8.26.0358" }),
      hit("Cobrança após o cancelamento é indevida.", 0.82, origem("inicial", 3, "1002288-81.2025.8.26.0565")),
      hit("Repetição do indébito em dobro.", 0.7, origem("replica", 5, "0006889-43.2023.8.26.0590")),
      hit("Dano moral in re ipsa.", 0.6, origem("parecer", 2)),
    ];
    const r = await buscaPorProblema(buscadorPg(pool(linhas), { embed }), ARGS);
    // O órfão vem PRIMEIRO de propósito: parear pelo índice cru daria a cada peça o processo da vizinha.
    expect(r).toEqual({
      situacao: "encontrado",
      semOrigem: 1,
      trechos: [
        expect.objectContaining({ citacao: "inicial.pdf, p. 3", processo: "1002288-81.2025.8.26.0565" }),
        expect.objectContaining({ citacao: "replica.pdf, p. 5", processo: "0006889-43.2023.8.26.0590" }),
        expect.objectContaining({ citacao: "parecer.pdf, p. 2", processo: null }),
      ],
    });
  });
});

describe("critério 4: armadilha — matéria ausente do acervo", () => {
  it("nada acima do limiar: a resposta é a frase fixa, sem texto nenhum para enfeitar", async () => {
    const r = await buscaPorProblema(buscadorPg(pool([hit("assunto distante", 0.1, origem("x", 1))]), { embed }), ARGS);
    expect(r).toEqual({ situacao: "nada_no_acervo", mensagem: NADA_NO_ACERVO, semOrigem: 0 });
  });

  it("só trechos sem origem também é 'nada no acervo' — e eles ficam contados", async () => {
    const r = await buscaPorProblema(buscadorPg(pool([hit("sem fonte", 0.9, {})]), { embed }), ARGS);
    expect(r).toEqual({ situacao: "nada_no_acervo", mensagem: NADA_NO_ACERVO, semOrigem: 1 });
  });
});

describe("falha é falha", () => {
  it("o provedor de embedding cai: 'falha', nunca 'nada no acervo'", async () => {
    const r = await buscaPorProblema(buscadorPg(pool([]), { embed: async () => { throw new Error("provedor fora"); } }), ARGS);
    expect(r.situacao).toBe("falha");
  });

  it("sem fonte de acervo ou pergunta vazia", async () => {
    expect(await buscaPorProblema(buscadorPg(pool([]), { embed }), { ...ARGS, fontesDoAcervo: [] })).toEqual({ situacao: "falha", codigo: "sem_acervo" });
    expect(await buscaPorProblema(buscadorPg(pool([]), { embed }), { ...ARGS, problema: "  " })).toEqual({ situacao: "falha", codigo: "pergunta_vazia" });
  });
});
