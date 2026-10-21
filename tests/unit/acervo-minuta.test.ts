import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { Buscador } from "@/lib/acervo/busca-por-problema";
import { AVISO_DA_MINUTA, escreveMinuta, FALTOU_JURISPRUDENCIA, MARCA_DO_RETIRADO, SEM_BASE, unidades, type Minuta } from "@/lib/acervo/minuta";
import { citacoesDe } from "@/lib/acervo/trava-da-tese";

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
    expect(m.blocos.flatMap((b) => citacoesDe(b.texto))).toEqual([]);
    expect(m.removidas.numero_sem_apoio + m.removidas.julgado_sem_apoio).toBeGreaterThan(0);
    // A marca fica no lugar e não sobra colchete órfão do "[A COMPLETAR: inserir o REsp …]" do modelo.
    for (const b of m.blocos) expect(b.texto.split("[").length).toBe(b.texto.split("]").length);
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

  it("citação externa: a frase sai, a marca fica NO LUGAR dela, e o que faltou diz por quê (critério 4)", async () => {
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "A cláusula é nula. Assim decidiu o REsp 1.234.567/SP. Por isso, deve ser afastada.", fontes: ["T1"] }], faltou: [] }));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos[0]!.texto).toBe(`A cláusula é nula. ${MARCA_DO_RETIRADO} Por isso, deve ser afastada.`);
    expect(tudo(m)).not.toMatch(/1\.?234\.?567/);
    expect(m.faltou).toContain(FALTOU_JURISPRUDENCIA);
  });

  // As formas que a primeira versão (uma lista de siglas) deixava passar — achadas pelo segundo leitor.
  it.each([
    ["REsp n.º 1.999.999/SP", "Conforme o REsp n.º 1.999.999/SP, a cláusula é nula."],
    ["REsp. com ponto", "Conforme o REsp. 1.999.999, a cláusula é nula."],
    ["Recurso Especial por extenso", "Decidiu-se no Recurso Especial número 1999999 que a cláusula é nula."],
    ["Tema", "Aplica-se o Tema 1.234 do STJ."],
    ["EAREsp", "Ver EAREsp 123.456."],
    ["súmulas no plural", "Incidem as Súmulas 297 e 479."],
    ["Rcl", "Na Rcl 12.345 ficou assentado o contrário."],
    ["número CNJ solto", "No processo 1234567-89.2020.8.26.0100 a tese foi acolhida."],
    ["OJ", "Aplica-se a OJ 394 da SDI-1."],
    ["Informativo", "Consta do Informativo 700."],
    ["precedente sem número", "Em precedente da Terceira Turma do STJ, de relatoria da Min. Nancy Andrighi, a cláusula foi anulada."],
    ["tribunal sem número", "O STJ, em recurso repetitivo, pacificou que a cláusula é nula."],
    ["Rel. e j. no meio", "REsp 1.999.999/SP, Rel. Min. Nancy Andrighi, j. 10/10/2021, DJe 15/10/2021: a cláusula é nula."],
    ["súmula com número do acervo, mas de outro tribunal", "Aplica-se a Súmula Vinculante 7."],
  ])("%s não passa, e nada do julgado sobra no texto", async (_, frase) => {
    const hits = [{ ...HITS[0]!, content: "A cláusula arbitral em contrato de adesão é nula. Súmula 7 do STJ." }];
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "A cláusula arbitral em contrato de adesão é nula.", fontes: ["T1"] }, { texto: frase, fontes: ["T1"] }], faltou: [] }), buscador(hits));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos[1]!.texto).toBe(MARCA_DO_RETIRADO);
  });

  it("o resto do julgado inventado não fica atribuído ao acervo: 'Nesse julgado, a Corte afirmou…' sai junto", async () => {
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "Do mérito.", fontes: ["T1"] }, { texto: "O STJ julgou o REsp 1.999.999/SP. Nesse julgado, a Corte afirmou que a cláusula arbitral é nula.", fontes: ["T1"] }], faltou: [] }));
    expect(tudo(m)).not.toMatch(/Nesse julgado|1\.?999/);
  });

  it("a pontuação colada no '[A COMPLETAR…]' do modelo continua colada (medido no Luna)", async () => {
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "EXMO. SR. DR. JUIZ DE DIREITO DA [A COMPLETAR: vara e comarca].", fontes: ["T1"] }, { texto: "[A COMPLETAR: qualificação], vem propor a ação.", fontes: ["T1"] }], faltou: [] }));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos.map((b) => b.texto)).toEqual(["EXMO. SR. DR. JUIZ DE DIREITO DA [A COMPLETAR: vara e comarca].", "[A COMPLETAR: qualificação], vem propor a ação."]);
  });

  it("duas frases retiradas seguidas viram UMA marca", async () => {
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "Da nulidade. Ver o REsp 1.999.999/SP. E o Tema 1.234 do STJ. Assim, é nula.", fontes: ["T1"] }], faltou: [] }));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos[0]!.texto).toBe(`Da nulidade. ${MARCA_DO_RETIRADO} Assim, é nula.`);
  });

  it("citação partida em dois blocos não passa", async () => {
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "Do mérito.", fontes: ["T1"] }, { texto: "Conforme decidiu o STJ no REsp", fontes: ["T1"] }, { texto: "1.999.999/SP, a cláusula é nula.", fontes: ["T1"] }], faltou: [] }));
    expect(tudo(m)).not.toMatch(/STJ no REsp|1\.?999/);
  });

  it("número inventado no que faltou também sai", async () => {
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "Do mérito.", fontes: ["T1"] }], faltou: ["Falta juntar o acórdão do Tema 1.234 do STJ e do processo 1234567-89.2020.8.26.0100.", "Qualificação das partes."] }));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.faltou).toEqual(["Qualificação das partes.", FALTOU_JURISPRUDENCIA]);
  });

  it("minuta inteira sem apoio no acervo é 'sem base', mesmo que o modelo a escreva (critério 3)", async () => {
    const tudoNovo = await minuta(JSON.stringify({ blocos: [{ texto: "CONTESTAÇÃO TRABALHISTA.", fontes: [] }, { texto: "Das horas extras.", fontes: [] }], faltou: [] }));
    expect(tudoNovo).toMatchObject({ situacao: "sem_base" });
    const soLacunas = await minuta(JSON.stringify({ blocos: [{ texto: "Conforme o REsp n.º 1.999.999/SP.", fontes: ["T1"] }], faltou: [] }));
    expect(soLacunas).toMatchObject({ situacao: "sem_base" });
  });

  it("frase da peça do acervo com a citação, copiada como está, fica", async () => {
    const hits = [{ ...HITS[0]!, content: "Nesse sentido, o STJ fixou no REsp 1.234.567/SP que a cláusula é nula." }];
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "Nesse sentido, o STJ fixou no REsp 1.234.567/SP que a cláusula é nula.", fontes: ["T1"] }], faltou: [] }), buscador(hits));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos[0]!.texto).toContain("REsp 1.234.567/SP");
  });

  it("número conferido contra o acervo lido: o que ele tem fica (noutra grafia também), o que não tem sai", async () => {
    const hits = [{ ...HITS[0]!, content: "Dos fatos do caso." }, { ...HITS[1]!, content: "Nos termos da Lei nº 7.347/1985, o valor da causa é R$ 19.500.000,00." }];
    const blocos = [
      { texto: "Dos fatos.", fontes: ["T1"] },
      { texto: "Cabe a ação pela Lei nº 7.347/85.", fontes: ["T1"] }, // medido: o Luna reescreve o ano assim
      { texto: "O dano foi de R$ 19.500.000,00.", fontes: ["T1"] },
      { texto: "O dano foi de R$ 21.300.000,00.", fontes: ["T1"] },
    ];
    const m = await minuta(JSON.stringify({ blocos, faltou: [] }), buscador(hits));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos.map((b) => b.texto)).toEqual(["Dos fatos.", "Cabe a ação pela Lei nº 7.347/85.", "O dano foi de R$ 19.500.000,00.", MARCA_DO_RETIRADO]);
  });

  it("título numerado e a ré não são confundidos com citação", async () => {
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "1. DOS FATOS. A ré impôs a cláusula.", fontes: ["T1"] }], faltou: [] }));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos[0]!.texto).toBe("1. DOS FATOS. A ré impôs a cláusula.");
  });

  it("as unidades: abreviatura de citação não corta a frase, e o colchete vai inteiro", () => {
    expect(unidades("REsp 1/SP, Rel. Min. Fulana, j. 10/10/2021. Outra frase. [A COMPLETAR: x. Y] Fim.")).toEqual([
      "REsp 1/SP, Rel. Min. Fulana, j. 10/10/2021.",
      "Outra frase.",
      "[A COMPLETAR: x. Y]",
      "Fim.",
    ]);
  });

  it("citação do acervo PARAFRASEADA não passa (falha fechado: só a frase copiada fica)", async () => {
    const hits = [{ ...HITS[0]!, content: "Conforme o REsp 1.234.567/SP, a cláusula é nula." }];
    const m = await minuta(JSON.stringify({ blocos: [{ texto: "Do mérito.", fontes: ["T1"] }, { texto: "Nos termos do REsp 1.234.567/SP, a cláusula é nula.", fontes: ["T1"] }], faltou: [] }), buscador(hits));
    if (m.situacao !== "minuta") throw new Error(m.situacao);
    expect(m.blocos[1]!.texto).toBe(MARCA_DO_RETIRADO);
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
 * Mutações (21/10/2026, trava por apoio): 13 de 13 acusadas. Pontuação solta depois do "]"; Sem a regra dos números;
 * sem a regra da menção a julgado; sem a grafia "7.347" de "7.347/1985"; números
 * curtos contando (título "1." cairia); corte de frase em "Rel."/"j."; colchete
 * "[A COMPLETAR]" cortado por dentro; marcas seguidas sem fundir; o que faltou sem
 * a trava; "sem base" só com zero blocos; fonte inventada aceita; "nada no acervo"
 * virando falha; resposta fora do formato virando "sem base".
 */
