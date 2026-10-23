import { describe, expect, it } from "vitest";

import { lerEmPaginas, lerPorLotes, piorEstado, TETO_DE_LINHAS, type Leitura, type RespostaDePagina } from "@/lib/painel/leitura";

/**
 * 0001.E5 — a leitura do painel (`lib/painel/leitura.ts`): erro nunca vira zero, o fim da leitura não é
 * adivinhado, e bater no teto deixa a etapa sem número.
 *
 * MUTAÇÕES: provadas em 23/10/2026 por `C:/t/mut-painel/mutar.cjs` (cada uma aplicada, vista acusar e desfeita):
 *   - ignorar `r.error` (devolver as linhas mesmo com erro) → reprovou "erro vira erro, nunca lista vazia";
 *   - voltar ao critério antigo "página curta = acabou" → reprovou "max_rows menor que a página";
 *   - tirar o teto (`total > teto`) → reprovou "acima do teto a leitura é parcial";
 *   - sem `count` devolver "ok" → reprovou "sem count não se prova que acabou";
 *   - trocar o deslocamento `lidas` por `chamada * tamanho` → reprovou "max_rows menor que a página";
 *   - tirar a deduplicação por id → reprovou "linhas repetidas pela paginação contam uma vez";
 *   - `lerPorLotes` sem propagar o pior estado → reprovou "um lote com erro derruba a leitura inteira".
 */

type Linha = { id: string; n: number };
const tabela = (total: number): Linha[] => Array.from({ length: total }, (_, i) => ({ id: `id-${i}`, n: i }));

/** Uma fonte que se comporta como o PostgREST: respeita `range` e um `max_rows`, e informa o `count` exato. */
function fonte(linhas: Linha[], opcoes: { maxRows?: number; semCount?: boolean; erroNaChamada?: number; lanca?: boolean; dataNula?: boolean } = {}) {
  const chamadas: Array<[number, number]> = [];
  const pagina = async (de: number, ate: number): Promise<RespostaDePagina<Linha>> => {
    chamadas.push([de, ate]);
    if (opcoes.lanca) throw new Error("rede");
    if (opcoes.erroNaChamada === chamadas.length) return { data: null, error: { message: "timeout" } };
    if (opcoes.dataNula) return { data: null };
    const pedido = ate - de + 1;
    const limite = Math.min(pedido, opcoes.maxRows ?? pedido);
    return { data: linhas.slice(de, de + limite), count: opcoes.semCount ? undefined : linhas.length };
  };
  return { pagina, chamadas };
}

describe("lerEmPaginas", () => {
  it("lê tudo em páginas e termina pelo count", async () => {
    const f = fonte(tabela(2500));
    const r = await lerEmPaginas(f.pagina);
    expect(r.estado).toBe("ok");
    expect(r.linhas).toHaveLength(2500);
    expect(f.chamadas).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("um total exato múltiplo da página não pede página a mais", async () => {
    const f = fonte(tabela(2000));
    expect((await lerEmPaginas(f.pagina)).linhas).toHaveLength(2000);
    expect(f.chamadas).toHaveLength(2);
  });

  it("tabela vazia: ok com zero linhas (zero MEDIDO, com count)", async () => {
    const r = await lerEmPaginas(fonte([]).pagina);
    expect(r).toEqual({ linhas: [], estado: "ok" });
  });

  it("max_rows menor que a página: continua de onde parou e lê tudo — a página curta NÃO é o fim", async () => {
    const f = fonte(tabela(1200), { maxRows: 300 });
    const r = await lerEmPaginas(f.pagina);
    expect(r.estado).toBe("ok");
    expect(r.linhas).toHaveLength(1200);
    expect(f.chamadas.map(([de]) => de)).toEqual([0, 300, 600, 900]);
  });

  it("acima do teto a leitura é parcial — e para sem baixar o resto", async () => {
    const f = fonte(tabela(450));
    const r = await lerEmPaginas(f.pagina, { teto: 400, tamanho: 100 });
    expect(r.estado).toBe("parcial");
    expect(f.chamadas).toHaveLength(1);
  });

  it("no limite exato do teto ainda é ok", async () => {
    expect((await lerEmPaginas(fonte(tabela(400)).pagina, { teto: 400, tamanho: 100 })).estado).toBe("ok");
    expect(TETO_DE_LINHAS).toBe(10_000);
  });

  it("sem count na resposta não se prova que a leitura acabou: parcial", async () => {
    const r = await lerEmPaginas(fonte(tabela(10), { semCount: true }).pagina);
    expect(r.estado).toBe("parcial");
  });

  it("erro vira erro, nunca lista vazia — no meio da leitura também", async () => {
    expect(await lerEmPaginas(fonte(tabela(5), { erroNaChamada: 1 }).pagina)).toEqual({ linhas: [], estado: "erro" });
    expect(await lerEmPaginas(fonte(tabela(2500), { erroNaChamada: 2 }).pagina)).toEqual({ linhas: [], estado: "erro" });
    expect(await lerEmPaginas(fonte(tabela(5), { lanca: true }).pagina)).toEqual({ linhas: [], estado: "erro" });
    expect(await lerEmPaginas(fonte(tabela(5), { dataNula: true }).pagina)).toEqual({ linhas: [], estado: "erro" });
  });

  it("linhas repetidas pela paginação contam uma vez", async () => {
    const base = tabela(3);
    const repete = async (de: number): Promise<RespostaDePagina<Linha>> => ({ data: de === 0 ? [...base, base[0]!] : [], count: 4 });
    const r = await lerEmPaginas(repete, { tamanho: 10 });
    expect(r.linhas.map((l) => l.id)).toEqual(["id-0", "id-1", "id-2"]);
  });
});

describe("lerPorLotes", () => {
  const lerLote = (porLote: (lote: string[]) => Leitura<Linha>) => async (lote: string[]) => porLote(lote);
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

  it("lê por lotes, sem repetir id, e junta tudo", async () => {
    const lotes: string[][] = [];
    const r = await lerPorLotes<Linha>([...ids(5), "id-0"], 2, lerLote((lote) => (lotes.push(lote), { linhas: lote.map((id) => ({ id, n: 0 })), estado: "ok" })));
    expect(lotes).toEqual([["id-0", "id-1"], ["id-2", "id-3"], ["id-4"]]);
    expect(r.linhas).toHaveLength(5);
    expect(r.estado).toBe("ok");
  });

  it("um lote com erro derruba a leitura inteira; um parcial deixa a leitura parcial", async () => {
    const com = (estado: "erro" | "parcial") =>
      lerPorLotes<Linha>(ids(4), 2, lerLote((lote) => ({ linhas: lote.map((id) => ({ id, n: 0 })), estado: lote[0] === "id-2" ? estado : "ok" })));
    expect(await com("erro")).toEqual({ linhas: [], estado: "erro" });
    expect((await com("parcial")).estado).toBe("parcial");
  });

  it("sem ids não lê nada e é ok (zero medido)", async () => {
    expect(await lerPorLotes<Linha>([], 100, async () => ({ linhas: [], estado: "erro" }))).toEqual({ linhas: [], estado: "ok" });
  });

  it("o teto vale para a soma dos lotes", async () => {
    const r = await lerPorLotes<Linha>(ids(30), 10, lerLote((lote) => ({ linhas: lote.flatMap((id) => [0, 1, 2].map((k) => ({ id: `${id}-${k}`, n: k }))), estado: "ok" })));
    expect(r.estado).toBe("ok"); // 90 linhas, abaixo do teto real
    const grande = await lerPorLotes<Linha>(ids(2), 1, lerLote((lote) => ({ linhas: Array.from({ length: TETO_DE_LINHAS }, (_, i) => ({ id: `${lote[0]}-${i}`, n: i })), estado: "ok" })));
    expect(grande.estado).toBe("parcial");
  });

  it("piorEstado: erro > parcial > ok", () => {
    expect(piorEstado("ok", "parcial", "erro")).toBe("erro");
    expect(piorEstado("ok", "parcial")).toBe("parcial");
    expect(piorEstado()).toBe("ok");
  });
});
