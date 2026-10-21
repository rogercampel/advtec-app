import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { Buscador } from "@/lib/acervo/busca-por-problema";
import { AVISO_DA_MINUTA, escreveMinuta, FALTOU_RETIRADOS, MARCA_DO_RETIRADO, SEM_BASE, unidades, type Minuta } from "@/lib/acervo/minuta";

/**
 * Ticket 0005.E1 (#33) — minuta a partir do acervo, com citação SÓ pelo acervo.
 *
 * Sobre respostas REAIS do gpt-6-luna (fixture gravada em 21/10/2026), com o
 * acervo de medida = as páginas das duas peças públicas:
 *   - critério 2: todo bloco aponta trecho do acervo ou sai marcado como novo;
 *   - critério 3: matéria sem base → "sem base", nunca peça bem escrita e vazia;
 *   - critério 4: citação só entra como frase literal de um trecho, com a página.
 *     Medido: o Luna devolveu um "[CITA T6: …]" com a lei trocada — frase que
 *     não existe em trecho nenhum — e ela não sai;
 *   - critério 7: a minuta se declara rascunho;
 *   - critério 9: a busca é da organização de quem pede.
 */

const { pecas } = JSON.parse(readFileSync("tests/fixtures/pecas-publicas.json", "utf8")) as {
  pecas: Array<{ id: string; paginas: Array<{ numero: number; texto: string }> }>;
};
type Gravada = "tipico" | "armadilha" | "citacao_forcada" | "citacao_em_texto_livre";
const gravada = JSON.parse(readFileSync("tests/fixtures/minuta-luna-gravada.json", "utf8")) as { respostas: Record<Gravada, string> };

const nome = (id: string) => (id === "tjmg-acp-netflix" ? "ACP Netflix.pdf" : "ACP Brascan.pdf");
const HITS = pecas.flatMap((p) =>
  p.paginas.map((pg) => ({
    content: pg.texto,
    similarity: 0.8,
    metadata: { documento: p.id, nome: nome(p.id), pagina_inicial: pg.numero, pagina_final: pg.numero },
  })),
);
const ORG = "22222222-2222-4222-8222-222222222222";

function buscador(results = HITS) {
  return vi.fn<Buscador>(async () => ({ ok: true, results }) as unknown as Awaited<ReturnType<Buscador>>);
}
const responde = (texto: string) => vi.fn(async () => ({ texto }));
const minuta = (texto: string, buscar = buscador()) =>
  escreveMinuta({ buscar, organizationId: ORG, fontesDoAcervo: ["fonte"], pedido: "Petição inicial de ACP de consumo.", chamar: responde(texto) });
const resposta = (blocos: Array<{ texto: string; fontes: string[] }>, faltou: string[] = []) => JSON.stringify({ blocos, faltou });
const tudo = (m: Minuta) => JSON.stringify(m);
const DO_MERITO = { texto: "Do mérito.", fontes: ["T1"] };
async function blocosDe(texto: string, buscar = buscador()) {
  const m = await minuta(texto, buscar);
  if (m.situacao !== "minuta") throw new Error(m.situacao);
  return m;
}
/** Frase de T1 (p. 1 da ACP Netflix), para citar de verdade. */
const FRASE_DE_T1 = "INSTITUTO DEFESA COLETIVA, pessoa jurídica de direito privado, associação sem";

describe("sobre a resposta real do Luna", () => {
  it("pedido típico: todo bloco com trecho do acervo ou marcado como novo (critério 2)", async () => {
    const m = await blocosDe(gravada.respostas.tipico);
    expect(m.blocos.length).toBeGreaterThan(5);
    const ids = new Set(m.fontes.map((f) => f.id));
    for (const b of m.blocos) {
      expect(b.novo).toBe(b.fontes.length === 0);
      for (const f of b.fontes) expect(ids.has(f)).toBe(true);
    }
    expect(m.blocos.some((b) => !b.novo)).toBe(true);
  });

  it("toda citação que sai é frase literal do trecho, com documento e página (critério 4)", async () => {
    const m = await blocosDe(gravada.respostas.tipico);
    const citadas = m.blocos.flatMap((b) => [...b.texto.matchAll(/“([^”]+)” \((ACP (?:Netflix|Brascan)\.pdf), p\. (\d+)\)/g)]);
    expect(citadas.length).toBeGreaterThan(0);
    const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
    for (const [, frase, doc, pg] of citadas) {
      const pagina = HITS.find((h) => h.metadata.nome === doc && h.metadata.pagina_inicial === Number(pg))!;
      expect(norm(pagina.content)).toContain(norm(frase!));
    }
  });

  it("o '[CITA T6: …]' que o Luna inventou (lei trocada, frase de trecho nenhum) não sai", async () => {
    expect(gravada.respostas.tipico).toContain("8.078/90 (Código de Defesa do Consumidor) atribui ao Ministério Público"); // o modelo de fato tentou
    const m = await blocosDe(gravada.respostas.tipico);
    expect(tudo(m)).not.toContain("atribui ao Ministério Público legitimação");
    expect(m.removidas.cita_invalida).toBeGreaterThan(0);
  });

  it("a minuta se declara rascunho e traz o que faltou (critério 7)", async () => {
    const m = await blocosDe(gravada.respostas.tipico);
    expect(m.aviso).toBe(AVISO_DA_MINUTA);
    expect(m.aviso).toMatch(/RASCUNHO/);
    expect(m.faltou.length).toBeGreaterThan(0);
  });

  it("armadilha: contestação trabalhista sobre acervo de consumo sai 'sem base' (critério 3)", async () => {
    expect(await minuta(gravada.respostas.armadilha)).toMatchObject({ situacao: "sem_base", mensagem: SEM_BASE });
  });

  it.each(["citacao_forcada", "citacao_em_texto_livre"] as const)("%s: o REsp e a súmula inventados não aparecem em forma nenhuma", async (qual) => {
    const m = await minuta(gravada.respostas[qual]);
    expect(tudo(m)).not.toMatch(/1\.?999\.?999|s[uú]mula\s*(n[oº.]?\s*)?999/i);
    if (m.situacao === "minuta") for (const b of m.blocos) expect(b.texto.split("[").length).toBe(b.texto.split("]").length);
  });

  it("a versão em texto livre do Luna (REsp escrito direto) teve mesmo o REsp retirado", async () => {
    expect(gravada.respostas.citacao_em_texto_livre).toMatch(/1\.999\.999/);
    const m = await blocosDe(gravada.respostas.citacao_em_texto_livre);
    expect(m.removidas.numero_no_texto + m.removidas.cara_de_citacao).toBeGreaterThan(0);
    expect(m.faltou).toContain(FALTOU_RETIRADOS);
  });
});

describe("citação só pelo acervo: [CITA Tn: …]", () => {
  it("frase literal do trecho entra entre aspas, com documento e página", async () => {
    const m = await blocosDe(resposta([{ texto: `Da legitimidade. [CITA T1: "${FRASE_DE_T1}"]`, fontes: ["T1"] }]));
    expect(m.blocos[0]!.texto).toBe(`Da legitimidade. “${FRASE_DE_T1}” (ACP Netflix.pdf, p. 1)`);
  });

  it("frase copiada do PDF atravessando quebra de linha também vale (medido no Luna)", async () => {
    const hits = [{ ...HITS[0]!, content: "A cláusula arbitral\nimposta ao consumidor é nula de pleno direito." }];
    const m = await blocosDe(resposta([{ texto: '[CITA T1: "A cláusula arbitral\nimposta ao consumidor é nula"]', fontes: ["T1"] }]), buscador(hits));
    expect(m.blocos[0]!.texto).toBe("“A cláusula arbitral imposta ao consumidor é nula” (ACP Netflix.pdf, p. 1)");
  });

  it.each([
    ["trecho que não existe", `[CITA T99: "${FRASE_DE_T1}"]`],
    ["frase que não está no trecho apontado", '[CITA T1: "Conforme o REsp 1.999.999/SP, a cláusula é nula."]'],
    ["frase com uma palavra trocada", `[CITA T1: "${FRASE_DE_T1.replace("privado", "público")}"]`],
    ["curta demais", '[CITA T1: "INSTITUTO"]'],
    ["fora do formato", "[CITA T1 INSTITUTO DEFESA COLETIVA]"],
  ])("%s: não entra, vira a marca", async (_, cita) => {
    const m = await blocosDe(resposta([DO_MERITO, { texto: cita, fontes: ["T1"] }]));
    expect(m.blocos[1]!.texto).toBe(MARCA_DO_RETIRADO);
    expect(m.removidas.cita_invalida).toBe(1);
  });
});

describe("texto próprio do modelo não pode ter cara de citação", () => {
  // Formas que derrubaram as duas versões anteriores da trava (dois segundos leitores, 21/10/2026).
  it.each([
    "Conforme o REsp n.º 1.999.999/SP, a cláusula é nula.",
    "Aplica-se o Tema 1.234 do STJ.",
    "Incidem as Súmulas 297 e 479.",
    "No processo 1234567-89.2020.8.26.0100 a tese foi acolhida.",
    "REsp 139.",
    "Súmula 21.",
    "Conforme o HC 999 e o MS 1.438, a cláusula é nula.",
    "O Supremo, no RE 12 e no ARE 74, afastou a tese.",
    "Na Apelação Cível do TJ-SP, a questão foi decidida.",
    "Nesse sentido, decisum do TJ/MG.",
    "Assim decidiu o S.T.J., no caso.",
    "Conforme o S.T.J., a cláusula é nula.",
    "O Excelso Supremo afastou a cláusula.",
    "Corte Cidadã.",
    "Em precedente da Terceira Turma, de relatoria da Min. Nancy Andrighi, a cláusula foi anulada.",
    "O STJ, em recurso repetitivo, pacificou que a cláusula é nula.",
    "O Pretório Excelso, no Habeas Corpus, assentou a tese.",
    "A tese do Tema mil e noventa e um se aplica ao caso.",
    "Como decidiu Nancy Andrighi, a cláusula é abusiva.",
    "Voto do Des. Fulano de Tal.",
    "[A COMPLETAR: citar o HC 1 999 999 do Pretório Excelso]",
    "No R​Esp, o S​TJ pacificou a questão.",
    "Belo Horizonte, 21 de outubro de 2026.",
  ])("%s → marca", async (frase) => {
    const m = await blocosDe(resposta([DO_MERITO, { texto: frase, fontes: ["T1"] }]));
    expect(m.blocos[1]!.texto).toBe(MARCA_DO_RETIRADO);
  });

  it("citação partida em dois blocos não passa", async () => {
    const m = await minuta(resposta([DO_MERITO, { texto: "Conforme decidiu o STJ no REsp", fontes: ["T1"] }, { texto: "1.999.999/SP, a cláusula é nula.", fontes: ["T1"] }]));
    expect(tudo(m)).not.toMatch(/STJ no REsp|1\.?999/);
  });

  it("o resto do julgado não fica: 'Nesse julgado, a Corte afirmou…' sai junto", async () => {
    const m = await minuta(resposta([DO_MERITO, { texto: "O STJ julgou o REsp 1.999.999/SP. Nesse julgado, a Corte afirmou que a cláusula arbitral é nula.", fontes: ["T1"] }]));
    expect(tudo(m)).not.toMatch(/Nesse julgado|1\.?999/);
  });

  it("frase do modelo que é cópia do acervo (6+ palavras) passa, com o que ela tiver", async () => {
    const hits = [{ ...HITS[0]!, content: "Nesse sentido, o STJ fixou no REsp 1.234.567/SP que a cláusula é nula." }];
    const m = await blocosDe(resposta([{ texto: "Nesse sentido, o STJ fixou no REsp 1.234.567/SP que a cláusula é nula.", fontes: ["T1"] }]), buscador(hits));
    expect(m.blocos[0]!.texto).toContain("REsp 1.234.567/SP");
  });

  it("prefixo curto de citação do acervo não é cópia: 'REsp 1.234.' não vale pelo 'REsp 1.234.567'", async () => {
    const hits = [{ ...HITS[0]!, content: "Do mérito. Conforme o REsp 1.234.567/SP, a cláusula é nula." }];
    const m = await blocosDe(resposta([DO_MERITO, { texto: "REsp 1.234.", fontes: ["T1"] }]), buscador(hits));
    expect(m.blocos[1]!.texto).toBe(MARCA_DO_RETIRADO);
  });

  it("cópia conta por palavra inteira: frase longa que termina no começo de um número do acervo não é cópia", async () => {
    const hits = [{ ...HITS[0]!, content: "Do mérito. Conforme decidiu a corte no julgamento do REsp 1234567, a cláusula é nula." }];
    const m = await blocosDe(resposta([DO_MERITO, { texto: "Conforme decidiu a corte no julgamento do REsp 123.", fontes: ["T1"] }]), buscador(hits));
    expect(m.blocos[1]!.texto).toBe(MARCA_DO_RETIRADO);
  });

  it("texto comum de peça fica", async () => {
    const frases = [
      "Requer seja o pedido julgado procedente, com a condenação da ré.",
      "Conforme relatório do PROCON, houve cobrança indevida.",
      "A ré impôs a cláusula abusiva ao consumidor.",
      "Nestes termos, pede deferimento.",
      "1. DOS FATOS",
      "a) a citação da ré para responder à presente ação.",
    ];
    const m = await blocosDe(resposta(frases.map((texto) => ({ texto, fontes: ["T1"] }))));
    expect(m.blocos.map((b) => b.texto)).toEqual(frases);
  });

  it("o custo escolhido: artigo de lei e endereçamento a desembargador fora de citação viram lacuna", async () => {
    const m = await blocosDe(resposta([DO_MERITO, { texto: "Nos termos do art. 300 do CPC, requer a tutela de urgência.", fontes: ["T1"] }, { texto: "Excelentíssimo Senhor Desembargador Relator.", fontes: ["T1"] }]));
    expect(m.blocos.slice(1).map((b) => b.texto)).toEqual([MARCA_DO_RETIRADO, MARCA_DO_RETIRADO]);
  });
});

describe("a forma do texto", () => {
  it("a marca fica no lugar da frase, e duas seguidas viram uma", async () => {
    const m = await blocosDe(resposta([{ texto: "Da nulidade. Ver o REsp 1.999.999/SP. E o Tema 1.234 do STJ. Assim, é nula.", fontes: ["T1"] }]));
    expect(m.blocos[0]!.texto).toBe(`Da nulidade. ${MARCA_DO_RETIRADO} Assim, é nula.`);
  });

  it("a quebra de parágrafo fica", async () => {
    const m = await blocosDe(resposta([{ texto: "Nestes termos,\nPede deferimento.\n\n[A COMPLETAR: local e data]", fontes: ["T1"] }]));
    expect(m.blocos[0]!.texto).toBe("Nestes termos,\nPede deferimento.\n\n[A COMPLETAR: local e data]");
  });

  it("a pontuação colada no '[A COMPLETAR…]' continua colada (medido no Luna)", async () => {
    const m = await blocosDe(resposta([{ texto: "EXMO. SR. DR. JUIZ DE DIREITO DA [A COMPLETAR: vara e comarca].", fontes: ["T1"] }]));
    expect(m.blocos[0]!.texto).toBe("EXMO. SR. DR. JUIZ DE DIREITO DA [A COMPLETAR: vara e comarca].");
  });

  it("caractere invisível sai do texto", async () => {
    const m = await blocosDe(resposta([{ texto: "A ré​ impôs a cláusula.", fontes: ["T1"] }]));
    expect(m.blocos[0]!.texto).toBe("A ré impôs a cláusula.");
  });

  it("as unidades: abreviatura de citação não corta a frase, e o colchete vai inteiro", () => {
    expect(unidades("REsp 1/SP, Rel. Min. Fulana, j. 10/10/2021. Outra frase. [A COMPLETAR: x. Y] Fim.")).toEqual([
      "REsp 1/SP, Rel. Min. Fulana, j. 10/10/2021.",
      "Outra frase.",
      "[A COMPLETAR: x. Y]",
      "Fim.",
    ]);
  });
});

describe("o que o código garante, sem depender do modelo", () => {
  it("nada no acervo: 'sem base', e o modelo nem é chamado (critério 3)", async () => {
    const chamar = responde("{}");
    const m = await escreveMinuta({ buscar: buscador([]), organizationId: ORG, fontesDoAcervo: ["fonte"], pedido: "x", chamar });
    expect(m).toMatchObject({ situacao: "sem_base", mensagem: SEM_BASE });
    expect(chamar).not.toHaveBeenCalled();
  });

  it("minuta sem nenhum bloco apoiado no acervo é 'sem base', mesmo escrita pelo modelo (critério 3)", async () => {
    expect(await minuta(resposta([{ texto: "CONTESTAÇÃO TRABALHISTA.", fontes: [] }, { texto: "Das horas extras.", fontes: [] }]))).toMatchObject({ situacao: "sem_base" });
    expect(await minuta(resposta([{ texto: "Conforme o REsp n.º 1.999.999/SP.", fontes: ["T1"] }]))).toMatchObject({ situacao: "sem_base" });
  });

  it("a busca é a da organização de quem pede, e o modelo só vê os trechos que ela devolveu (critério 9)", async () => {
    const buscar = buscador(HITS.slice(0, 2));
    const chamar = responde(resposta([{ texto: "Texto.", fontes: ["T1"] }]));
    await escreveMinuta({ buscar, organizationId: ORG, fontesDoAcervo: ["fonte"], pedido: "Peça.", chamar });
    expect(buscar.mock.calls[0]![0]).toMatchObject({ organizationId: ORG, fontes: ["fonte"] });
    const enviado = (chamar.mock.calls[0] as unknown as [{ user: string }])[0].user;
    expect(enviado).toContain("[T2]");
    expect(enviado).not.toContain("[T3]");
  });

  it("fonte que o modelo inventou não vale: o bloco sai como texto novo, e a remoção é contada (critério 2)", async () => {
    const m = await blocosDe(resposta([{ texto: "Do direito.", fontes: ["T99", "T1"] }, { texto: "Dos pedidos.", fontes: ["T42"] }]));
    expect(m.blocos).toEqual([
      { texto: "Do direito.", fontes: ["T1"], novo: false },
      { texto: "Dos pedidos.", fontes: [], novo: true },
    ]);
    expect(m.removidas.fonte_inexistente).toBe(2);
  });

  it("o que faltou passa pela mesma regra, e diz que houve retirada", async () => {
    const m = await blocosDe(resposta([DO_MERITO], ["Falta juntar o acórdão do Tema 1.234 do STJ e do processo 1234567-89.2020.8.26.0100.", "Qualificação das partes."]));
    expect(m.faltou).toEqual(["Qualificação das partes.", FALTOU_RETIRADOS]);
  });

  it("modelo dizendo que os trechos não servem: 'sem base', com o motivo", async () => {
    expect(await minuta(resposta([], ["os trechos são de outra matéria"]))).toEqual({ situacao: "sem_base", mensagem: SEM_BASE, faltou: ["os trechos são de outra matéria"] });
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
 * Mutações (21/10/2026): 23 de 23 acusadas — `node scripts/mutar-minuta.mjs` tira
 * cada regra de lib/acervo/minuta.ts, roda este arquivo e restaura.
 */
