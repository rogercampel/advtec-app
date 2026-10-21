import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { leAlegacoes } from "@/lib/acervo/alegacoes";
import { itensDosAutos, leContradicoes, MAXIMO_DE_LACUNAS } from "@/lib/acervo/contradicoes";
import type { Pagina } from "@/lib/acervo/fatiar";
import { linhaDoTempo } from "@/lib/acervo/linha-do-tempo";

/**
 * Tickets 0003.E4 e 0003.E5 sobre a resposta VERDADEIRA do modelo de produção
 * (gpt-6-luna, pela chave de API da organização), gravada em 21/10/2026 nas
 * duas iniciais públicas, páginas inteiras. O modelo não é chamado: a resposta
 * gravada é devolvida como se fosse — e, se faltar resposta, o teste falha.
 *
 * O gabarito é o que dá para conferir à mão no PDF, não a opinião do modelo:
 *   - uma inicial sozinha não tem defesa (as duas);
 *   - a do TJMG não traz decisão nenhuma;
 *   - a do MPRJ numera 7 pedidos (1º a 7º, págs. 11-12) e anexa, na pág. 12, a
 *     ementa do acórdão DESTE processo (Apelação 2007.001.37257).
 * E o efeito das regras da âncora sobre saída real: medido, elas derrubam 1 item
 * em cada peça (TJMG: trecho longo demais; MPRJ: uma "decisão" cujo trecho só
 * descrevia o pedido).
 */

type Gravada = { paginas: Pagina[]; alegacoes: string[]; contradicoes: string };
const { pecas } = JSON.parse(readFileSync("tests/fixtures/leitura-luna-gravada.json", "utf8")) as {
  pecas: Record<"tjmg" | "mprj", Gravada>;
};
const devolve = (respostas: string[]) => async () => {
  const r = respostas.shift();
  if (r === undefined) throw new Error("o teste pediu mais respostas do que as gravadas");
  return { texto: r };
};

async function le(qual: "tjmg" | "mprj") {
  const p = pecas[qual];
  const alegacoes = await leAlegacoes(p.paginas, devolve([...p.alegacoes]));
  const itens = itensDosAutos(alegacoes.alegacoes, linhaDoTempo(p.paginas).eventos);
  const contradicoes = await leContradicoes(itens, devolve([p.contradicoes]));
  return { p, alegacoes, itens, contradicoes };
}

describe.each(["tjmg", "mprj"] as const)("%s — resposta real do Luna", (qual) => {
  it("todo bloco foi lido, nenhuma página ficou sem texto, e as regras da âncora derrubam pouco", async () => {
    const { alegacoes } = await le(qual);
    expect(alegacoes.blocosNaoLidos).toEqual([]);
    expect(alegacoes.paginasSemTexto).toEqual([]);
    expect(alegacoes.alegacoes.length).toBeGreaterThanOrEqual(12);
    const removidas = Object.values(alegacoes.removidas).reduce((s, n) => s + n, 0);
    expect(removidas).toBeLessThanOrEqual(2);
  });

  it("uma inicial sozinha não tem defesa: nenhuma no resultado", async () => {
    const { alegacoes } = await le(qual);
    expect(alegacoes.alegacoes.filter((a) => a.tipo === "defesa")).toEqual([]);
    expect([...alegacoes.naoConsta, ...alegacoes.descartados]).toContain("defesa");
  });

  it("contradições e lacunas: procurado, nenhum número inventado, nenhuma contradição numa peça de um lado só", async () => {
    const { contradicoes } = await le(qual);
    expect(contradicoes.naoLido).toBeNull();
    expect(contradicoes.removidas.numero_inexistente).toBe(0);
    expect(contradicoes.removidas.mesmo_item).toBe(0);
    expect(contradicoes.contradicoes).toEqual([]);
    expect(contradicoes.lacunas.length).toBeLessThanOrEqual(MAXIMO_DE_LACUNAS);
  });

  it("toda página que importa existe no documento e tem motivo", async () => {
    const { p, contradicoes } = await le(qual);
    const numeros = new Set(p.paginas.map((x) => x.numero));
    expect(contradicoes.paginasQueImportam.length).toBeGreaterThan(0);
    for (const pg of contradicoes.paginasQueImportam) {
      expect(numeros.has(pg.pagina)).toBe(true);
      expect(pg.motivos.length).toBeGreaterThan(0);
    }
  });
});

describe("gabarito conferido à mão", () => {
  it("TJMG: nenhuma decisão (é só a inicial) e os 7 pedidos que o modelo achou ficam", async () => {
    const { alegacoes } = await le("tjmg");
    expect(alegacoes.alegacoes.filter((a) => a.tipo === "decisao")).toEqual([]);
    expect(alegacoes.alegacoes.filter((a) => a.tipo === "pedido")).toHaveLength(7);
  });

  it("MPRJ: os 7 pedidos numerados, e as decisões só na pág. 12 — o acórdão deste processo, que entra na lista do que ler", async () => {
    const { alegacoes, contradicoes } = await le("mprj");
    expect(alegacoes.alegacoes.filter((a) => a.tipo === "pedido")).toHaveLength(7);
    const decisoes = alegacoes.alegacoes.filter((a) => a.tipo === "decisao");
    expect(decisoes.length).toBeGreaterThan(0);
    expect(new Set(decisoes.map((d) => d.pagina))).toEqual(new Set([12]));
    expect(alegacoes.removidas.decisao_sem_verbo).toBe(1);
    expect(contradicoes.paginasQueImportam.find((x) => x.pagina === 12)!.motivos).toContain("decisão do juízo — o que já vale no processo");
  });
});
