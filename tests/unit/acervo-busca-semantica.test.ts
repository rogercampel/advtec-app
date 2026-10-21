import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LIMIAR_PADRAO, buscaPorProblema, type Buscador } from "@/lib/acervo/busca-por-problema";
import { sombra } from "@/lib/acervo/metadado";

/**
 * Spec 0004, critério 1: "Busca descrevendo um problema SEM usar as palavras da
 * peça encontra a peça certa. Teste com três casos de referência."
 *
 * Contra a fonte real, com resposta gravada (como manda o plano de teste da
 * 0007): os vetores em `tests/fixtures/acervo-busca-semantica.json` vieram do
 * modelo da base (`text-embedding-3-small`) em 21/10/2026. As peças são
 * SINTÉTICAS (rótulo no próprio fixture), com distrações difíceis da mesma área.
 *
 * Medido: 3 de 3 com a peça certa em 1º. O caso da revisional de alimentos passou
 * RASPANDO o limiar (0,410 contra 0,4), com folga de 0,011 para a 2ª colocada:
 * está anotado em `.context/MEDIDO.md`, e este teste trava a folga para a próxima
 * troca de modelo ou de limiar não passar calada.
 *
 * Mutação (21/10/2026): trocar a pergunta 3 por uma que repete "alimentos" da
 * peça faz o teste de "nenhuma palavra em comum" acusar; subir o limiar para 0,42
 * faz o caso 3 cair para "nada no acervo".
 */

type Fixture = {
  modelo: string;
  pecas: Array<{ id: string; texto: string; alvo?: boolean }>;
  perguntas: Array<{ alvo: string; texto: string }>;
  vetores: { pecas: Record<string, number[]>; perguntas: number[][] };
};
const F = JSON.parse(readFileSync("tests/fixtures/acervo-busca-semantica.json", "utf8")) as Fixture;

const cos = (a: number[], b: number[]) => {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return s / (Math.sqrt(na) * Math.sqrt(nb));
};

/** Palavras de conteúdo: sem acento, sem pontuação, sem as funcionais e as curtas. */
const FUNCIONAIS = new Set(["para", "mesmo", "assim", "todo", "dele", "esse", "mais", "quase", "nunca", "pelo", "pela", "como", "sobre", "seus", "suas", "que", "dos", "das", "nos", "nas", "com", "sem", "por", "uma", "um"]);
const palavras = (t: string) => new Set(sombra(t).replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !FUNCIONAIS.has(w)));

/** Buscador com os vetores gravados: a mesma conta de cosseno que o pgvector faz. */
const buscadorGravado = (i: number): Buscador => async (q) => ({
  ok: true,
  results: F.pecas
    .map((p) => ({ chunk_id: p.id, knowledge_source_id: "acervo", source_name: "Acervo", content: p.texto,
      similarity: cos(F.vetores.perguntas[i]!, F.vetores.pecas[p.id]!),
      metadata: { documento: p.id, nome: `${p.id}.pdf`, pagina_inicial: 1, pagina_final: 1 } }))
    .filter((h) => h.similarity >= q.threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, q.topK),
});

describe("critério 1: a peça certa sem as palavras dela", () => {
  it("o fixture é do modelo da base e as peças estão rotuladas como sintéticas", () => {
    expect(F.modelo).toBe("text-embedding-3-small");
    expect(JSON.stringify(F)).toMatch(/SINTÉTICAS/);
    expect(F.perguntas).toHaveLength(3);
  });

  it.each(F.perguntas.map((q, i) => [q.alvo, i] as const))("%s: a pergunta não divide nenhuma palavra de conteúdo com a peça", (alvo) => {
    const q = F.perguntas.find((x) => x.alvo === alvo)!;
    const peca = F.pecas.find((p) => p.id === alvo)!;
    const comuns = [...palavras(q.texto)].filter((w) => palavras(peca.texto).has(w));
    expect(comuns).toEqual([]);
  });

  it.each(F.perguntas.map((q, i) => [q.alvo, i] as const))("%s: a pesquisa devolve a peça certa em 1º, acima do limiar", async (alvo, i) => {
    const r = await buscaPorProblema(buscadorGravado(i), { organizationId: "o", fontesDoAcervo: ["acervo"], problema: F.perguntas[i]!.texto });
    expect(r.situacao).toBe("encontrado");
    if (r.situacao !== "encontrado") return;
    expect(r.trechos[0]!.origem.documento).toBe(alvo);
    expect(r.trechos[0]!.similaridade).toBeGreaterThanOrEqual(LIMIAR_PADRAO);
  });

  it("a folga medida fica registrada: o pior caso passa por pouco", () => {
    const folgas = F.perguntas.map((q, i) => {
      const s = F.pecas.map((p) => cos(F.vetores.perguntas[i]!, F.vetores.pecas[p.id]!)).sort((a, b) => b - a);
      return { alvo: q.alvo, primeiro: s[0]!, folga: s[0]! - s[1]! };
    });
    expect(Math.min(...folgas.map((f) => f.primeiro))).toBeGreaterThan(LIMIAR_PADRAO);
    expect(Math.min(...folgas.map((f) => f.folga))).toBeGreaterThan(0);
  });
});
