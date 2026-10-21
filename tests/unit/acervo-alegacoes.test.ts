import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { leAlegacoes } from "@/lib/acervo/alegacoes";
import type { Pagina } from "@/lib/acervo/fatiar";
import {
  ancorado,
  blocosDePaginas,
  emLotes,
  estimaLeitura,
  jsonDoModelo,
  motivoParaRecusar,
  numerosApoiados,
  tokensDe,
  TOKENS_POR_BLOCO,
  type ChamadaDoModelo,
} from "@/lib/acervo/leitura-por-modelo";

/**
 * Ticket 0003.E4 (#35) — o que cada lado alega, pelo modelo, com página.
 *
 * Critério 2: toda afirmação tem página — item sem página sai e é contado.
 * Critério 3: a página citada contém o que a afirmação diz. O que o código
 *   consegue provar: o `trecho` está LITERAL na página citada, tem tamanho de
 *   citação, e todo número do `texto` está no `trecho`. O SENTIDO do `texto` não
 *   é provado — por isso o documento mostra sempre frase e trecho juntos.
 * Critério 4 (armadilha): o que não está nos autos não aparece — a defesa
 *   inventada sai; "não consta" (o modelo nem apontou) é diferente de
 *   "descartado" (apontou sem trecho que prove).
 * Critério 1: 400 páginas em blocos que cabem no modelo, com estimativa antes.
 *
 * Páginas da inicial pública do TJMG (`pecas-publicas.json`); modelo falso aqui.
 * A resposta real do gpt-6-luna está em `acervo-leitura-luna-gravada.test.ts`.
 *
 * Mutações: ver o fim do arquivo.
 */

type Peca = { id: string; paginas: Pagina[] };
const { pecas } = JSON.parse(readFileSync("tests/fixtures/pecas-publicas.json", "utf8")) as { pecas: Peca[] };
const TJMG = pecas.find((p) => p.id === "tjmg-acp-netflix")!.paginas;
const p34 = TJMG.find((p) => p.numero === 34)!;
const p1 = TJMG.find((p) => p.numero === 1)!;

const VALOR = "Dá-se à causa o valor de R$19.500.000,00 (dezenove milhões e quinhentos mil reais).";
const QUALIFICACAO = "INSTITUTO DEFESA COLETIVA, pessoa jurídica de direito privado, associação sem fins lucrativos";

const modelo =
  (...respostas: Array<string | Error>): ChamadaDoModelo =>
  async () => {
    const r = respostas.shift() ?? '{"itens": []}';
    if (r instanceof Error) throw r;
    return { texto: r };
  };
const itens = (...xs: unknown[]) => JSON.stringify({ itens: xs });
const pedido = (pagina: number, trecho: string, extra: Record<string, unknown> = {}) => ({
  tipo: "pedido",
  lado: "autor",
  texto: "O autor atribui à causa o valor de R$19.500.000,00.",
  pagina,
  trecho,
  ...extra,
});
const zeradas = { sem_pagina: 0, trecho_nao_literal: 0, tamanho_do_trecho: 0, numero_sem_apoio: 0, formato: 0, repetido: 0, decisao_sem_verbo: 0 };

describe("critério 2 e 3: a âncora", () => {
  it("item ancorado fica; sem página e com trecho de outra página saem, contados", async () => {
    const r = await leAlegacoes(
      TJMG,
      modelo(
        itens(
          pedido(34, VALOR),
          pedido(34, VALOR, { pagina: undefined }),
          pedido(1, VALOR), // o trecho é real, mas da página 34
          { tipo: "causa_de_pedir", lado: "autor", texto: "Quem é o autor.", pagina: 1, trecho: QUALIFICACAO },
        ),
      ),
    );
    expect(r.alegacoes.map((a) => [a.tipo, a.pagina])).toEqual([
      ["causa_de_pedir", 1],
      ["pedido", 34],
    ]);
    expect(r.removidas).toEqual({ ...zeradas, sem_pagina: 1, trecho_nao_literal: 1 });
  });

  it("quebra de linha e caixa não importam; trocar uma palavra importa", async () => {
    const quebrado = VALOR.replace("valor de", "valor\nde").toUpperCase();
    const trocado = VALOR.replace("Dá-se à causa", "Atribui-se à causa");
    const r = await leAlegacoes(TJMG, modelo(itens(pedido(34, quebrado), pedido(34, trocado))));
    expect(r.alegacoes).toHaveLength(1);
    expect(r.removidas.trecho_nao_literal).toBe(1);
  });

  it("trecho tem tamanho de citação: 'OAB/MG 84.841' é curto demais; a página inteira, longa demais", () => {
    expect(motivoParaRecusar({ pagina: 34, trecho: "OAB/MG 84.841" }, TJMG)).toBe("tamanho_do_trecho");
    expect(motivoParaRecusar({ pagina: 34, trecho: p34.texto }, TJMG)).toBe("tamanho_do_trecho");
    expect(motivoParaRecusar({ pagina: "34", trecho: VALOR }, TJMG)).toBe("sem_pagina");
    expect(ancorado({ pagina: 34, trecho: VALOR }, TJMG)).toBe(true);
  });

  it("número do texto que o trecho não traz sai: 'R$ 50 milhões' num trecho de R$ 19,5 milhões", async () => {
    const r = await leAlegacoes(TJMG, modelo(itens(pedido(34, VALOR, { texto: "O autor pede R$ 50.000.000,00 de dano moral." }))));
    expect(r.alegacoes).toEqual([]);
    expect(r.removidas.numero_sem_apoio).toBe(1);
  });

  it("os números de uma data reescrita contam: '23.05.2023' apoia '23 de maio de 2023'; '24 de maio' não", () => {
    const trecho = "a ré informou, em 23.05.2023, que passaria a cobrar pelo compartilhamento";
    expect(numerosApoiados("Em 23 de maio de 2023 a ré anunciou a cobrança.", trecho)).toBe(true);
    expect(numerosApoiados("Em 24 de maio de 2023 a ré anunciou a cobrança.", trecho)).toBe(false);
    expect(numerosApoiados("Sem número nenhum.", trecho)).toBe(true);
  });

  it("formato inválido (tipo que não existe, texto vazio) sai como formato", async () => {
    const r = await leAlegacoes(TJMG, modelo(itens(pedido(34, VALOR, { tipo: "opiniao" }), pedido(34, VALOR, { texto: "" }))));
    expect(r.alegacoes).toEqual([]);
    expect(r.removidas.formato).toBe(2);
  });

  it("o mesmo trecho repetido entra uma vez, e a repetição é contada", async () => {
    const r = await leAlegacoes(TJMG, modelo(itens(pedido(34, VALOR), pedido(34, VALOR.toUpperCase()))));
    expect(r.alegacoes).toHaveLength(1);
    expect(r.removidas.repetido).toBe(1);
  });
});

describe("decisão só com verbo de decisão no trecho", () => {
  const autos: Pagina[] = [
    { numero: 60, texto: "Vistos. Ante o exposto, indefiro, por ora, o pedido de tutela de urgência formulado pelo autor. Intimem-se." },
    { numero: 61, texto: "A parte autora juntou os documentos de fls. 20 a 45 e requereu o prosseguimento do feito." },
  ];
  it("'indefiro…' é decisão; a juntada de documentos não é", async () => {
    const r = await leAlegacoes(
      autos,
      modelo(
        itens(
          { tipo: "decisao", lado: "juizo", texto: "O juiz negou a liminar.", pagina: 60, trecho: "indefiro, por ora, o pedido de tutela de urgência formulado pelo autor" },
          { tipo: "decisao", lado: "juizo", texto: "O juiz aceitou os documentos de fls. 20 a 45.", pagina: 61, trecho: "A parte autora juntou os documentos de fls. 20 a 45" },
        ),
      ),
    );
    expect(r.alegacoes.map((a) => a.pagina)).toEqual([60]);
    expect(r.removidas.decisao_sem_verbo).toBe(1);
  });
});

describe("critério 4 — armadilha: inicial não tem defesa nem decisão", () => {
  it("defesa inventada sai; defesa fica 'descartada' (o modelo apontou), decisão fica 'não consta'", async () => {
    const r = await leAlegacoes(
      TJMG,
      modelo(
        itens(pedido(34, VALOR), {
          tipo: "defesa",
          lado: "reu",
          texto: "A ré alega que o compartilhamento de senha sempre foi proibido.",
          pagina: 26,
          trecho: "A ré sustenta que o compartilhamento de senha sempre foi vedado pelos termos de uso",
        }),
      ),
    );
    expect(r.alegacoes.map((a) => a.tipo)).toEqual(["pedido"]);
    expect(r.naoConsta).toEqual(["causa_de_pedir", "decisao"]);
    expect(r.descartados).toEqual(["defesa"]);
  });

  it("modelo que não responde não vira 'nada alegado': as páginas ficam marcadas como não lidas, com o motivo", async () => {
    const r = await leAlegacoes(TJMG, modelo(new Error("403 Forbidden")));
    expect(r.alegacoes).toEqual([]);
    expect(r.blocosNaoLidos).toEqual([{ primeira: 1, ultima: 34, motivo: "Error: 403 Forbidden" }]);
  });

  it("resposta que não é JSON também é bloco não lido, com o motivo", async () => {
    const r = await leAlegacoes(TJMG, modelo("Claro! Aqui estão os pedidos: ..."));
    expect(r.blocosNaoLidos.map((b) => b.motivo)).toEqual(["resposta do modelo fora do formato"]);
  });
});

describe("as páginas que entram", () => {
  it("página sem texto (escaneada) não vai ao modelo e aparece como não lida", async () => {
    const chamadas: string[] = [];
    const r = await leAlegacoes([p34, { numero: 35, texto: "  \n " }], async ({ user }) => {
      chamadas.push(user);
      return { texto: itens() };
    });
    expect(r.paginasSemTexto).toEqual([35]);
    expect(chamadas.join("")).not.toContain("PÁGINA 35");
  });

  it("páginas fora de ordem são lidas em ordem; a faixa não lida diz as páginas certas", async () => {
    const r = await leAlegacoes([p34, p1, ...TJMG.filter((p) => p.numero !== 1 && p.numero !== 34)], modelo(new Error("x")));
    expect(r.blocosNaoLidos.map((b) => [b.primeira, b.ultima])).toEqual([[1, 34]]);
  });

  it("número de página repetido é erro alto, não página ambígua", async () => {
    await expect(leAlegacoes([p34, { ...p1, numero: 34 }], modelo())).rejects.toThrow(/página 34 repetida/);
  });
});

describe("critério 1: processo grande em blocos, com estimativa antes de chamar", () => {
  const grande: Pagina[] = Array.from({ length: 400 }, (_, i) => ({ numero: i + 1, texto: p34.texto.repeat(5) }));

  it("toda página em exatamente um bloco, na ordem, e cada bloco cabe no teto", () => {
    const blocos = blocosDePaginas(grande);
    expect(blocos.length).toBeGreaterThan(1);
    expect(blocos.flat().map((p) => p.numero)).toEqual(grande.map((p) => p.numero));
    for (const b of blocos) expect(b.reduce((s, p) => s + tokensDe(p.texto), 0)).toBeLessThanOrEqual(TOKENS_POR_BLOCO);
  });

  it("página maior que o teto vira um bloco sozinha, sem se perder", () => {
    const gigante = { numero: 7, texto: "x".repeat(TOKENS_POR_BLOCO * 4) };
    expect(blocosDePaginas([p1, gigante, p34]).map((b) => b.map((p) => p.numero))).toEqual([[1], [7], [34]]);
  });

  it("a estimativa sai sem chamar o modelo, e 400 páginas cabem em 10 minutos", () => {
    const e = estimaLeitura(grande);
    expect(e.blocos).toBe(blocosDePaginas(grande).length);
    expect(e.minutos).toBeLessThanOrEqual(10);
  });

  it("no máximo 3 blocos ao mesmo tempo, e a resposta volta na ordem dos blocos", async () => {
    let emVoo = 0;
    let pico = 0;
    const saida = await emLotes([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 5 * (8 - n)));
      emVoo -= 1;
      return n * 10;
    });
    expect(pico).toBe(3);
    expect(saida).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it("item que cita página de OUTRO bloco sai: o modelo não viu aquela página", async () => {
    const paginas: Pagina[] = [p1, ...Array.from({ length: 30 }, (_, i) => ({ numero: 100 + i, texto: "y".repeat(TOKENS_POR_BLOCO * 3) })), p34];
    const chamadas: string[] = [];
    const chamar: ChamadaDoModelo = async ({ user }) => {
      chamadas.push(user);
      return { texto: itens(pedido(34, VALOR)) }; // todo bloco cita a página 34 — só o que a contém pode
    };
    const r = await leAlegacoes(paginas, chamar);
    expect(chamadas.length).toBeGreaterThan(2);
    expect(r.alegacoes).toHaveLength(1);
    expect(r.removidas.trecho_nao_literal).toBe(chamadas.length - 1);
  });
});

describe("a resposta do modelo", () => {
  it("JSON com cerca de código é lido; prosa não", () => {
    expect(jsonDoModelo('```json\n{"itens": []}\n```')).toEqual({ itens: [] });
    expect(jsonDoModelo("Aqui está: {}")).toBeNull();
  });
});

/*
 * Mutações (21/10/2026), contra este arquivo e o da resposta gravada, todas
 * acusadas: sem teto/piso de palavras do trecho; sem conferir os números do
 * texto; sem os pedaços de data; "algum número" no lugar de "todo número";
 * página repetida aceita; páginas sem ordenar; página sem texto mandada ao
 * modelo; página certa sem conferir o trecho; decisão sem verbo de decisão;
 * "descartado" virando "não consta"; motivo da falha perdido; repetição sem
 * contagem. Rodadas anteriores (âncora, blocos, simultaneidade, corrida, "nada
 * alegado") continuam cobertas aqui.
 */
