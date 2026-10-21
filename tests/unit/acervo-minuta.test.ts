import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { Buscador } from "@/lib/acervo/busca-por-problema";
import { AVISO_DA_MINUTA, citacoesNaMinuta, escreveMinuta, MARCA_DA_CITACAO_RETIRADA, SEM_BASE, type Minuta } from "@/lib/acervo/minuta";

/**
 * Ticket 0005.E1 (#33) — minuta a partir do acervo.
 *
 * Sobre respostas REAIS do gpt-6-luna (fixture gravada em 21/10/2026), com o
 * acervo de medida = as páginas das duas peças públicas:
 *   - critério 2: todo bloco aponta trecho do acervo ou sai marcado como novo;
 *   - critério 3: matéria sem base → "sem base", nunca peça bem escrita e vazia;
 *   - critério 4: citação inventada não aparece na saída em forma nenhuma —
 *     a medição mostrou o Luna devolvendo o REsp inventado na lista do que faltou;
 *   - critério 7: a minuta se declara rascunho;
 *   - critério 9: a busca é da organização de quem pede.
 */

const { pecas } = JSON.parse(readFileSync("tests/fixtures/pecas-publicas.json", "utf8")) as {
  pecas: Array<{ id: string; paginas: Array<{ numero: number; texto: string }> }>;
};
const gravada = JSON.parse(readFileSync("tests/fixtures/minuta-luna-gravada.json", "utf8")) as {
  pedidos: Record<"tipico" | "armadilha" | "citacao_forcada", string>;
  respostas: Record<"tipico" | "armadilha" | "citacao_forcada", string>;
};

const HITS = pecas.flatMap((p) =>
  p.paginas.map((pg) => ({
    content: pg.texto,
    similarity: 0.8,
    metadata: { documento: p.id, nome: p.id === "tjmg-acp-netflix" ? "ACP Netflix.pdf" : "ACP Brascan.pdf", pagina_inicial: pg.numero, pagina_final: pg.numero },
  })),
);
const ORG = "22222222-2222-4222-8222-222222222222";

function buscador(results = HITS) {
  return vi.fn<Buscador>(async () => ({ ok: true, results }) as unknown as Awaited<ReturnType<Buscador>>);
}
const responde = (texto: string) => vi.fn(async () => ({ texto }));
const minuta = (texto: string, buscar = buscador()) =>
  escreveMinuta({ buscar, organizationId: ORG, fontesDoAcervo: ["fonte"], pedido: "Petição inicial de ACP de consumo.", chamar: responde(texto) });
const tudo = (m: Minuta) => JSON.stringify(m);

describe("sobre a resposta real do Luna", () => {
  it("pedido típico: minuta com blocos, todo bloco com trecho do acervo ou marcado como novo (critério 2)", async () => {
    const m = await minuta(gravada.respostas.tipico);
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos.length).toBeGreaterThan(5);
    const ids = new Set(m.fontes.map((f) => f.id));
    for (const b of m.blocos) {
      expect(b.novo).toBe(b.fontes.length === 0);
      for (const f of b.fontes) expect(ids.has(f)).toBe(true);
    }
    expect(m.blocos.some((b) => !b.novo)).toBe(true);
    for (const f of m.fontes) expect(f.citacao).toMatch(/^ACP (Netflix|Brascan)\.pdf, p\. \d+$/);
  });

  it("a minuta se declara rascunho e traz o que faltou (critério 7)", async () => {
    const m = await minuta(gravada.respostas.tipico);
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.aviso).toBe(AVISO_DA_MINUTA);
    expect(m.aviso).toMatch(/RASCUNHO/);
    expect(m.faltou.length).toBeGreaterThan(0);
  });

  it("armadilha: contestação trabalhista sobre acervo de consumo sai 'sem base' (critério 3)", async () => {
    const m = await minuta(gravada.respostas.armadilha);
    expect(m).toMatchObject({ situacao: "sem_base", mensagem: SEM_BASE });
  });

  it("citação forçada: o REsp e a súmula inventados não aparecem em forma nenhuma — nem no que faltou (critério 4)", async () => {
    expect(gravada.respostas.citacao_forcada).toMatch(/1\.999\.999/); // o modelo de fato tentou
    const m = await minuta(gravada.respostas.citacao_forcada);
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(tudo(m)).not.toMatch(/1\.?999\.?999|s[uú]mula\s*(n[oº.]?\s*)?999/i);
    expect(citacoesNaMinuta(m)).toEqual([]);
    expect(m.removidas.citacao_externa).toBeGreaterThan(0);
  });
});

describe("o que o código garante, sem depender do modelo", () => {
  it("nada no acervo: 'sem base', e o modelo nem é chamado (critério 3)", async () => {
    const chamar = responde("{}");
    const m = await escreveMinuta({ buscar: buscador([]), organizationId: ORG, fontesDoAcervo: ["fonte"], pedido: "x", chamar });
    expect(m).toMatchObject({ situacao: "sem_base", mensagem: SEM_BASE });
    expect(chamar).not.toHaveBeenCalled();
  });

  it("a busca é a da organização de quem pede, e o modelo só vê os trechos que ela devolveu (critério 9)", async () => {
    const buscar = buscador(HITS.slice(0, 2));
    const chamar = responde(JSON.stringify({ blocos: [{ texto: "Texto.", fontes: ["T1"] }], faltou: [] }));
    await escreveMinuta({ buscar, organizationId: ORG, fontesDoAcervo: ["fonte"], pedido: "Peça.", chamar });
    expect(buscar.mock.calls[0]![0]).toMatchObject({ organizationId: ORG, fontes: ["fonte"] });
    const enviado = (chamar.mock.calls[0] as unknown as [{ user: string }])[0].user;
    expect(enviado).toContain("[T1]");
    expect(enviado).toContain("[T2]");
    expect(enviado).not.toContain("[T3]");
  });

  it("fonte que o modelo inventou não vale: o bloco sai como texto novo, e a remoção é contada (critério 2)", async () => {
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "Do direito.", fontes: ["T99", "T1"] }, { texto: "Dos pedidos.", fontes: ["T42"] }], faltou: [] }));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos).toEqual([
      { texto: "Do direito.", fontes: ["T1"], novo: false },
      { texto: "Dos pedidos.", fontes: [], novo: true },
    ]);
    expect(m.removidas.fonte_inexistente).toBe(2);
  });

  it("citação externa: a frase sai, o lugar fica marcado e vira item do que faltou (critério 4)", async () => {
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "A cláusula é nula. Assim decidiu o REsp 1.234.567/SP.", fontes: ["T1"] }], faltou: [] }));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos[0]!.texto).toBe(`A cláusula é nula. ${MARCA_DA_CITACAO_RETIRADA}`);
    expect(tudo(m)).not.toMatch(/1\.?234\.?567/);
    expect(m.faltou).toContain("Bloco 1: jurisprudência que o acervo do escritório não tem.");
  });

  it("citação que ESTÁ no trecho do acervo fica", async () => {
    const hits = [{ ...HITS[0]!, content: "Conforme o REsp 1.234.567/SP, a cláusula é nula." }];
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "Nos termos do REsp 1.234.567/SP, a cláusula é nula.", fontes: ["T1"] }], faltou: [] }), buscador(hits));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos[0]!.texto).toContain("REsp 1.234.567/SP");
  });

  it("modelo dizendo que os trechos não servem: 'sem base', com o motivo", async () => {
    const m = await minuta(JSON.stringify({ blocos: [], faltou: ["os trechos são de outra matéria"] }));
    expect(m).toEqual({ situacao: "sem_base", mensagem: SEM_BASE, faltou: ["os trechos são de outra matéria"] });
  });

  it("resposta fora do formato é falha, nunca minuta parcial", async () => {
    expect(await minuta("Segue a minuta: ...")).toEqual({ situacao: "falha", codigo: "formato" });
    expect(await minuta(JSON.stringify({ blocos: [{ texto: "x" }], faltou: [] }))).toEqual({ situacao: "falha", codigo: "formato" });
  });

  it("falha do modelo é falha com o motivo, e falha da busca não vira 'sem base'", async () => {
    const m = await escreveMinuta({ buscar: buscador(), organizationId: ORG, fontesDoAcervo: ["fonte"], pedido: "x", chamar: async () => { throw new Error("403 access_denied"); } });
    expect(m).toMatchObject({ situacao: "falha", codigo: "modelo" });
    const caiu = vi.fn<Buscador>(async () => ({ ok: false, error: { code: "embedding_falhou" } }) as unknown as Awaited<ReturnType<Buscador>>);
    expect(await escreveMinuta({ buscar: caiu, organizationId: ORG, fontesDoAcervo: ["fonte"], pedido: "x", chamar: responde("{}") })).toEqual({ situacao: "falha", codigo: "embedding_falhou" });
  });
});

/*
 * Mutações (21/10/2026): 7 de 7 acusadas. Lista do que faltou sem a trava; bloco
 * sem a trava de citação; fonte inventada aceita; "nada no acervo" virando falha;
 * blocos vazios virando minuta; bloco sem fonte não marcado como novo; resposta
 * fora do formato virando "sem base".
 */
