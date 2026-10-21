import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { leAlegacoes, type LeituraDasAlegacoes } from "@/lib/acervo/alegacoes";
import { itensDosAutos, leContradicoes, type LeituraDasContradicoes } from "@/lib/acervo/contradicoes";
import { afirmacoesDo, AVISO_DO_DOCUMENTO, montaDocumento } from "@/lib/acervo/documento-de-leitura";
import type { Pagina } from "@/lib/acervo/fatiar";
import { linhaDoTempo } from "@/lib/acervo/linha-do-tempo";
import { quemEQuem } from "@/lib/acervo/quem-e-quem";

/**
 * Ticket 0003.E6 (#41) — o documento de saída, a parte pura.
 *
 * Critério 2: TODA afirmação do documento tem número de página. Teste
 *   automatizado varrendo a saída (`afirmacoesDo`), sobre a leitura REAL das
 *   duas iniciais públicas (resposta gravada do gpt-6-luna).
 * E o que o documento diz de si: o aviso na primeira linha; o que não foi lido;
 *   contradições "procuradas só no que foi lido" quando parte ficou de fora;
 *   lacuna escrita como "não achamos, nos trechos lidos", nunca "não há prova".
 */

type Gravada = { paginas: Pagina[]; alegacoes: string[]; contradicoes: string };
const { pecas } = JSON.parse(readFileSync("tests/fixtures/leitura-luna-gravada.json", "utf8")) as {
  pecas: Record<"tjmg" | "mprj", Gravada>;
};
const devolve = (respostas: string[]) => async () => ({ texto: respostas.shift()! });

async function documentoReal(qual: "tjmg" | "mprj") {
  const p = pecas[qual];
  const alegacoes = await leAlegacoes(p.paginas, devolve([...p.alegacoes]));
  const linha = linhaDoTempo(p.paginas);
  const contradicoes = await leContradicoes(itensDosAutos(alegacoes.alegacoes, linha.eventos), devolve([p.contradicoes]));
  return { p, doc: montaDocumento({ quemEQuem: quemEQuem(p.paginas), linhaDoTempo: linha, alegacoes, contradicoes }) };
}

describe.each(["tjmg", "mprj"] as const)("%s — documento da leitura real", (qual) => {
  it("critério 2: toda afirmação tem página, e a página existe no processo", async () => {
    const { p, doc } = await documentoReal(qual);
    const paginas = new Set(p.paginas.map((x) => x.numero));
    const afirmacoes = afirmacoesDo(doc);
    expect(afirmacoes.length).toBeGreaterThan(15);
    for (const a of afirmacoes) {
      expect(Number.isInteger(a.pagina), a.texto).toBe(true);
      expect(paginas.has(a.pagina), `p${a.pagina}: ${a.texto}`).toBe(true);
    }
    expect(doc.retiradasSemPagina).toBe(0);
  });

  it("a varredura cobre TODA seção: quem é quem, advogados, linha do tempo, alegações, contradições, lacunas e páginas", async () => {
    const { doc } = await documentoReal(qual);
    const afirmacoes = afirmacoesDo(doc);
    const esperadas = [
      ...doc.quemEQuem.flatMap((c) => (c.afirmacao ? [c.afirmacao] : [])),
      ...doc.advogados,
      ...doc.linhaDoTempo,
      ...doc.alegacoes.flatMap((x) => x.itens),
      ...doc.contradicoes.itens.flatMap((c) => c.lados),
      ...doc.contradicoes.lacunas.map((l) => l.afirmacao),
    ];
    expect(afirmacoes).toEqual(expect.arrayContaining(esperadas));
    expect(afirmacoes).toHaveLength(esperadas.length + doc.paginasQueImportam.length);
    expect(doc.contradicoes.lacunas.length).toBeGreaterThan(0); // a varredura de lacunas tem o que varrer
  });

  it("a primeira coisa é o aviso de que o documento não substitui a leitura", async () => {
    const { doc } = await documentoReal(qual);
    expect(doc.aviso).toBe(AVISO_DO_DOCUMENTO);
    expect(doc.naoLido).toEqual({ paginasSemTexto: [], trechos: [] });
  });

  it("quem é quem do gabarito chega ao documento com página", async () => {
    const { doc } = await documentoReal(qual);
    const autor = doc.quemEQuem.find((c) => c.rotulo === "Autor")!.afirmacao!;
    expect(autor.texto).toBe(qual === "tjmg" ? "INSTITUTO DEFESA COLETIVA" : "O MINISTÉRIO PÚBLICO DO ESTADO DO RIO DE JANEIRO");
    expect(autor.pagina).toBe(1);
  });

  it("defesa aparece como 'não consta' ou 'descartado', nunca como lista inventada", async () => {
    const { doc } = await documentoReal(qual);
    const defesa = doc.alegacoes.find((s) => s.tipo === "defesa")!;
    expect(defesa.itens).toEqual([]);
    expect(["nao_consta", "descartado"]).toContain(defesa.estado);
  });

  it("lacuna nunca afirma 'não há prova': diz que não achou nos trechos lidos", async () => {
    const { doc } = await documentoReal(qual);
    for (const l of doc.contradicoes.lacunas) expect(l.falta).toMatch(/^Não achamos, nos trechos lidos, prova disto — os anexos podem ter: /);
  });
});

const vazioDeAlegacoes: LeituraDasAlegacoes = {
  alegacoes: [],
  naoConsta: ["pedido", "causa_de_pedir", "defesa", "decisao"],
  descartados: [],
  removidas: { sem_pagina: 0, trecho_nao_literal: 0, tamanho_do_trecho: 0, numero_sem_apoio: 0, formato: 0, repetido: 0, decisao_sem_verbo: 0 },
  blocosNaoLidos: [],
  paginasSemTexto: [],
};
const procurado: LeituraDasContradicoes = {
  contradicoes: [],
  lacunas: [],
  paginasQueImportam: [],
  removidas: { numero_inexistente: 0, mesmo_item: 0, numero_sem_apoio: 0, acima_do_teto: 0, repetido: 0 },
  naoLido: null,
};
const semQuem = { juizo: null, autor: null, classe: null, reu: null, valor_da_causa: null, advogados: [] };

describe("o que não foi lido aparece, e muda o que se diz das contradições", () => {
  it("folha sem texto e trecho que o modelo não respondeu vão para o topo, e as contradições ficam 'parciais'", () => {
    const doc = montaDocumento({
      quemEQuem: semQuem,
      linhaDoTempo: { eventos: [], carimbos: 0, citacoes: 0 },
      alegacoes: { ...vazioDeAlegacoes, paginasSemTexto: [7], blocosNaoLidos: [{ primeira: 40, ultima: 90, motivo: "Error: 429" }] },
      contradicoes: procurado,
    });
    expect(doc.naoLido).toEqual({ paginasSemTexto: [7], trechos: [{ primeira: 40, ultima: 90, motivo: "Error: 429" }] });
    expect(doc.contradicoes).toMatchObject({ estado: "parcial", motivo: "procuradas só nas páginas que foram lidas" });
  });

  it("só uma folha sem texto já basta para as contradições serem 'parciais'", () => {
    const doc = montaDocumento({
      quemEQuem: semQuem,
      linhaDoTempo: { eventos: [], carimbos: 0, citacoes: 0 },
      alegacoes: { ...vazioDeAlegacoes, paginasSemTexto: [7] },
      contradicoes: procurado,
    });
    expect(doc.contradicoes.estado).toBe("parcial");
  });

  it("modelo das contradições fora do ar: 'não procurado' com o motivo, nunca 'nenhuma contradição'", () => {
    const doc = montaDocumento({
      quemEQuem: semQuem,
      linhaDoTempo: { eventos: [], carimbos: 0, citacoes: 0 },
      alegacoes: vazioDeAlegacoes,
      contradicoes: { ...procurado, naoLido: { motivo: "Error: 403" } },
    });
    expect(doc.contradicoes).toMatchObject({ estado: "nao_procurado", motivo: "Error: 403" });
  });

  it("'descartado' e 'não consta' são estados diferentes no documento", () => {
    const doc = montaDocumento({
      quemEQuem: semQuem,
      linhaDoTempo: { eventos: [], carimbos: 0, citacoes: 0 },
      alegacoes: { ...vazioDeAlegacoes, naoConsta: ["pedido", "causa_de_pedir", "decisao"], descartados: ["defesa"] },
      contradicoes: procurado,
    });
    expect(doc.alegacoes.map((s) => [s.tipo, s.estado])).toEqual([
      ["pedido", "nao_consta"],
      ["causa_de_pedir", "nao_consta"],
      ["defesa", "descartado"],
      ["decisao", "nao_consta"],
    ]);
  });
});

describe("o último filtro: sem página, não entra", () => {
  it("item sem página que chegue até aqui é retirado e contado", () => {
    const doc = montaDocumento({
      quemEQuem: {
        ...semQuem,
        autor: { valor: "FULANO", pagina: Number.NaN, trecho: "FULANO, brasileiro" },
        advogados: [{ valor: "BELTRANO", oab: "OAB/SP 1", pagina: -1, trecho: "BELTRANO OAB/SP 1" }],
      },
      linhaDoTempo: { eventos: [{ data: "2024-01-01", pagina: 0, trecho: "x" }], carimbos: 0, citacoes: 0 },
      alegacoes: { ...vazioDeAlegacoes, alegacoes: [{ tipo: "pedido", lado: "autor", texto: "pede", pagina: undefined as never, trecho: "t" }] },
      contradicoes: procurado,
    });
    expect(afirmacoesDo(doc)).toEqual([]);
    expect(doc.retiradasSemPagina).toBe(4);
  });
});

/*
 * Mutações (21/10/2026): 10 de 10 acusadas. Último filtro de página desligado ou
 * aceitando página zero; folha sem texto sem deixar as contradições "parciais";
 * "não procurado" e "parcial" virando "procurado"; "descartado" virando "não
 * consta"; lacuna escrita sem "não achamos, nos trechos lidos"; o que não foi
 * lido sumindo do topo; advogado e evento sem o filtro de página; lacunas fora
 * da varredura.
 */
