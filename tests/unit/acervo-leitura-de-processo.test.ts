import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { afirmacoesDo } from "@/lib/acervo/documento-de-leitura";
import type { Pagina } from "@/lib/acervo/fatiar";
import { estimaCusto, executaLeitura } from "@/lib/acervo/leitura-de-processo";

/**
 * Ticket 0003.E6 (#41) — a leitura de ponta a ponta e a estimativa antes dela.
 *
 * Critério 7: o custo é avisado ANTES — `estimaCusto` não chama modelo nenhum e
 *   cresce com o tamanho do processo.
 * De ponta a ponta sobre a resposta REAL gravada: o documento sai com quem é
 *   quem, alegações e páginas, e toda afirmação com página (critério 2).
 */

type Gravada = { paginas: Pagina[]; alegacoes: string[]; contradicoes: string };
const { pecas } = JSON.parse(readFileSync("tests/fixtures/leitura-luna-gravada.json", "utf8")) as {
  pecas: Record<"tjmg" | "mprj", Gravada>;
};

describe("critério 7: a estimativa sai antes, sem modelo", () => {
  it("custo pela chave de API cresce com o processo, e 34 páginas custam menos de um centavo de dólar", async () => {
    const pequeno = await estimaCusto(pecas.mprj.paginas);
    const maior = await estimaCusto(pecas.tjmg.paginas);
    expect(pequeno.paginas).toBe(12);
    expect(maior.paginas).toBe(34);
    expect(pequeno.dolaresPelaChave).not.toBeNull();
    expect(maior.dolaresPelaChave!).toBeGreaterThan(pequeno.dolaresPelaChave!);
    // Medido em 21/10/2026: US$ 0,0031 (E4) + contradições no TJMG — a estimativa fica acima, nunca abaixo.
    expect(maior.dolaresPelaChave!).toBeGreaterThan(0.003);
    expect(maior.dolaresPelaChave!).toBeLessThan(0.01);
  });

  it("400 páginas: estimativa de até 10 minutos", async () => {
    const grande = Array.from({ length: 400 }, (_, i) => ({ numero: i + 1, texto: pecas.tjmg.paginas[i % 34]!.texto }));
    expect((await estimaCusto(grande)).minutos).toBeLessThanOrEqual(10);
  });
});

describe.each(["tjmg", "mprj"] as const)("%s — de ponta a ponta sobre a resposta real", (qual) => {
  it("o documento sai completo, e toda afirmação tem página do processo", async () => {
    const p = pecas[qual];
    const respostas = [...p.alegacoes, p.contradicoes];
    const doc = await executaLeitura(p.paginas, async () => ({ texto: respostas.shift()! }));
    expect(respostas).toEqual([]); // uma chamada por bloco + uma das contradições
    expect(doc.quemEQuem.filter((c) => c.afirmacao).length).toBeGreaterThanOrEqual(4);
    expect(doc.alegacoes.find((s) => s.tipo === "pedido")!.itens.length).toBe(7);
    expect(doc.paginasQueImportam.length).toBeGreaterThan(0);
    const paginas = new Set(p.paginas.map((x) => x.numero));
    for (const a of afirmacoesDo(doc)) expect(paginas.has(a.pagina)).toBe(true);
  });
});
