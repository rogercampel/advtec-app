import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { Buscador } from "@/lib/acervo/busca-por-problema";
import { fatia } from "@/lib/acervo/fatiar";
import {
  AVISO_DA_MINUTA,
  escreveMinuta,
  FALTOU_RETIRADOS,
  FALTOU_TEXTO_NOVO,
  frasesInteirasDe,
  grafiaDoAcervo,
  MARCA_DO_RETIRADO,
  motivoDoTexto,
  SEM_BASE,
  unidades,
  type Minuta,
} from "@/lib/acervo/minuta";

/**
 * Ticket 0005.E1 (#33) — minuta a partir do acervo, com citação SÓ pelo acervo
 * (decisão do dono, 21/10/2026, depois de três revisões derrubarem travas por regra).
 *
 *   - critério 2: todo bloco aponta trecho do acervo ou sai marcado como novo;
 *   - critério 3: matéria sem base → "sem base"; e "sem base" só quando o modelo
 *     não apoiou nada — se a trava retirou texto, a minuta sai com as marcas;
 *   - critério 4: citação só entra como FRASES INTEIRAS de um trecho, com a
 *     página. Pedaço não: "Súmula 30" tirado de "Súmula 302", tese sem o "Não";
 *   - critério 5 (0005.E4): toda minuta traz o que faltou, e a lista vazia só
 *     sai quando todo bloco tem origem;
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

/**
 * Acervo curto e conhecido, para os testes de citação. Começa com uma frase de
 * sobra: o começo do trecho não é começo de frase (o trecho é pedaço cortado).
 */
const ACERVO = [
  "Do caso.",
  "Aplica-se a Súmula 302 do STJ ao caso. Conforme o REsp 1.234.567/SP, a cláusula arbitral é nula.",
  "Não é verdade que\na cláusula arbitral é válida. Incidem as Súmulas 297, 479 do STJ.",
  "1. DO CABIMENTO DA AÇÃO\nA ação civil pública é cabível.",
  'Assim, in verbis: "a lei exige manifestação escrita." A Lei n . º 8.078/90 atribui legitimação.',
  "A cláusula arbitral\nimposta ao consumidor é nula de pleno direito.",
].join("\n");
const hitsDe = (content: string) => [{ ...HITS[0]!, content }];

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
/** O segundo bloco de uma minuta "Do mérito." + `texto`, sobre o acervo curto. */
async function segundoBloco(texto: string) {
  return (await blocosDe(resposta([DO_MERITO, { texto, fontes: ["T1"] }]), buscador(hitsDe(ACERVO)))).blocos[1]!.texto;
}

describe("sobre a resposta real do Luna", () => {
  it("pedido típico: todo bloco com trecho do acervo ou marcado como novo (critério 2)", async () => {
    const m = await blocosDe(gravada.respostas.tipico);
    expect(m.blocos.length).toBeGreaterThan(5);
    const ids = new Set(m.fontes.map((f) => f.id));
    for (const b of m.blocos) {
      expect(b.novo).toBe(b.fontes.length === 0);
      for (const f of b.fontes) expect(ids.has(f)).toBe(true);
    }
  });

  it("as citações do Luna entram, e cada uma é frase inteira da página que ela cita (critério 4)", async () => {
    const m = await blocosDe(gravada.respostas.tipico);
    // Custo declarado da 0005.E3: a do T8 vinha depois de "in verbis:" — dois-pontos não abre frase.
    expect(m.removidas.cita_invalida).toBe(1);
    const citadas = m.blocos.flatMap((b) => [...b.texto.matchAll(/“([^”]+)” \((ACP (?:Netflix|Brascan)\.pdf), p\. (\d+)\)/g)]);
    expect(citadas.length).toBe((gravada.respostas.tipico.match(/\[CITA/g) ?? []).length - 1);
    for (const [, frase, doc, pg] of citadas) {
      const pagina = HITS.find((h) => h.metadata.nome === doc && h.metadata.pagina_inicial === Number(pg))!;
      expect(frasesInteirasDe(frase!, pagina.content)).toBe(true);
    }
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

  it.each(["citacao_forcada", "citacao_em_texto_livre"] as const)("%s: o REsp e a súmula inventados — que o Luna escreveu — não aparecem", async (qual) => {
    expect(gravada.respostas[qual]).toMatch(/1\.999\.999/);
    const m = await minuta(gravada.respostas[qual]);
    expect(tudo(m)).not.toMatch(/1\.?999\.?999|s[uú]mula\s*(n[oº.]?\s*)?999/i);
    if (m.situacao === "minuta") for (const b of m.blocos) expect(b.texto.split("[").length).toBe(b.texto.split("]").length);
  });
});

describe("citação só pelo acervo: [CITA Tn: frases inteiras]", () => {
  it.each([
    ["uma frase", "Aplica-se a Súmula 302 do STJ ao caso.", "Aplica-se a Súmula 302 do STJ ao caso."],
    ["duas frases seguidas", "Aplica-se a Súmula 302 do STJ ao caso. Conforme o REsp 1.234.567/SP, a cláusula arbitral é nula.", "Aplica-se a Súmula 302 do STJ ao caso. Conforme o REsp 1.234.567/SP, a cláusula arbitral é nula."],
    ["sem o ponto final (o ponto vem do acervo)", "Conforme o REsp 1.234.567/SP, a cláusula arbitral é nula", "Conforme o REsp 1.234.567/SP, a cláusula arbitral é nula."],
    ["depois de título, na linha de baixo", "A ação civil pública é cabível.", "A ação civil pública é cabível."],
    ["com o espaçamento do PDF (sai como está no acervo)", "A Lei n.º 8.078/90 atribui legitimação.", "A Lei n . º 8.078/90 atribui legitimação."],
    ["atravessando a quebra de linha do PDF", "A cláusula arbitral imposta ao consumidor é nula de pleno direito.", "A cláusula arbitral imposta ao consumidor é nula de pleno direito."],
    ["em caixa diferente (sai a caixa do acervo)", "aplica-se a súmula 302 do stj ao caso.", "Aplica-se a Súmula 302 do STJ ao caso."],
  ])("%s: entra entre aspas, com documento e página", async (_, frase, noAcervo) => {
    expect(await segundoBloco(`[CITA T1: "${frase}"]`)).toBe(`“${noAcervo}” (ACP Netflix.pdf, p. 1)`);
  });

  it("a pontuação é a do acervo: pergunta não vira afirmação", async () => {
    const m = await blocosDe(
      resposta([DO_MERITO, { texto: '[CITA T1: "A cláusula arbitral é válida."]', fontes: ["T1"] }]),
      buscador(hitsDe("Do caso. A cláusula arbitral é válida? Evidentemente que não.")),
    );
    expect(m.blocos[1]!.texto).toBe("“A cláusula arbitral é válida?” (ACP Netflix.pdf, p. 1)");
  });

  it("a quebra de linha DENTRO do [CITA] também vale (medido no Luna)", async () => {
    expect(await segundoBloco('[CITA T1: "A cláusula arbitral\nimposta ao consumidor é nula de pleno direito."]')).toMatch(/^“A cláusula arbitral imposta/);
  });

  // As formas que a terceira revisão usou para passar julgado falso "verificado".
  it.each([
    ["pedaço que corta o número ('Súmula 30' de 'Súmula 302')", '[CITA T1: "Aplica-se a Súmula 30"]'],
    ["frase que começa no meio de outra", '[CITA T1: "Súmula 302 do STJ ao caso."]'],
    ["frase que começa no meio de palavra", '[CITA T1: "plica-se a Súmula 302 do STJ ao caso."]'],
    ["'frase' que acaba num ponto de milhar", '[CITA T1: "Conforme o REsp 1."]'],
    ["tese sem o 'Não' que a negava (a quebra do PDF não é começo de frase)", '[CITA T1: "a cláusula arbitral é válida."]'],
    ["pontuação trocada no número ('297, 479' → '297.479')", '[CITA T1: "Incidem as Súmulas 297.479 do STJ."]'],
    ["palavra trocada", '[CITA T1: "Aplica-se a Súmula 303 do STJ ao caso."]'],
    ["trecho que não existe", '[CITA T99: "Aplica-se a Súmula 302 do STJ ao caso."]'],
    ["uma palavra só (não é frase inteira)", '[CITA T1: "Aplica-se."]'],
    ["depois de dois-pontos ('in verbis:') — 0005.E3: só a frase inteira, desde antes dos dois-pontos", '[CITA T1: "a lei exige manifestação escrita."]'],
    ["fora do formato", "[CITA T1 Aplica-se a Súmula 302]"],
  ])("%s: não entra, vira a marca", async (_, cita) => {
    expect(await segundoBloco(cita)).toBe(MARCA_DO_RETIRADO);
  });

  it("texto colado depois de um [CITA] válido passa pela regra do texto próprio", async () => {
    expect(await segundoBloco('[CITA T1: "Aplica-se a Súmula 302 do STJ ao caso."] (Tema seis).')).toBe(
      `“Aplica-se a Súmula 302 do STJ ao caso.” (ACP Netflix.pdf, p. 1) ${MARCA_DO_RETIRADO}`,
    );
  });

  it("[CITA] dentro de '[A COMPLETAR: …]' sai citado, sem colchete sobrando", async () => {
    const t = await segundoBloco('[A COMPLETAR: conferir [CITA T1: "Aplica-se a Súmula 302 do STJ ao caso."]]');
    expect(t).toContain("“Aplica-se a Súmula 302 do STJ ao caso.” (ACP Netflix.pdf, p. 1)");
    expect(t.split("[").length).toBe(t.split("]").length);
  });
});

describe("texto próprio do modelo: a rede", () => {
  it.each([
    // algarismo
    "Conforme o REsp n.º 1.999.999/SP, a cláusula é nula.",
    "Aplica-se o Tema 1.234 do STJ.",
    "Súmula 21.",
    "No processo 1234567-89.2020.8.26.0100 a tese foi acolhida.",
    "Belo Horizonte, 21 de outubro de 2026.",
    "Nos termos do art. 300 do CPC, requer a tutela de urgência.",
    "[A COMPLETAR: citar o HC 1 999 999 do Pretório Excelso]",
    // sem algarismo: uma família de cada
    "O Pretório afastou a tese.",
    "Conforme a jurisprudência, a cláusula é nula.",
    "Os julgados afastam a cláusula.",
    "Nesse julgado, a Corte afirmou que a cláusula é nula.",
    "Rel. Fulana de Tal, a cláusula é nula.",
    "Aplica-se ao caso o Tema seis.",
    "Conforme o Tema DCCCLXXIX, a cláusula é nula.",
    "Como leciona a melhor doutrina, a cláusula é nula.",
    "No caso Netflix contra Procon, a cláusula foi anulada.",
    "O artigo sétimo do CDC protege o consumidor.",
    "O Tribunal de Justiça de São Paulo decidiu igual.",
    "A Seção de Direito Privado reconheceu a nulidade.",
    "Conforme o S.T.J., a cláusula é nula.",
    "Conforme o S T J, a cláusula é nula.",
    "Conforme o SТJ, a cláusula é nula.",
    "No R​Esp, o S​TJ pacificou a questão.",
    "Como votou o Ministro Fulano, a cláusula é nula.",
    "No RE nove, a tese caiu.",
  ])("%s → marca", async (frase) => {
    expect(await segundoBloco(frase)).toBe(MARCA_DO_RETIRADO);
  });

  // Falsos positivos que a terceira revisão achou: com eles, uma apelação inteira saía "sem base".
  it.each([
    "Interpõe a presente APELAÇÃO CÍVEL em face da sentença.",
    "EGRÉGIO TRIBUNAL DE JUSTIÇA DO ESTADO DE MINAS GERAIS",
    "Colenda Câmara Cível,",
    "Excelentíssimo Senhor Desembargador Relator.",
    "Opõe EMBARGOS DE DECLARAÇÃO contra o acórdão embargado.",
    "AGRAVO DE INSTRUMENTO com pedido de efeito suspensivo.",
    "MANDADO DE SEGURANÇA contra ato do Secretário.",
    "Após o trânsito em julgado da sentença, requer o arquivamento.",
    "A ré decidiu cancelar o contrato.",
    "A ré entendeu por bem cobrar a multa.",
    "O banco consolidou a propriedade do imóvel.",
    "O material informativo não esclarecia a cláusula.",
    "O enunciado da cláusula é claro.",
    "A turma de formandos contratou o serviço.",
    "A cláusula é nula de pleno direito.",
    "Requer seja o pedido julgado procedente, com a condenação da ré.",
    "Conforme relatório do PROCON, houve cobrança indevida.",
    "O órgão de defesa do consumidor entende que houve abuso.",
    "Nestes termos, pede deferimento.",
    "1. DOS FATOS",
    "a) a citação da ré para responder à presente ação.",
  ])("%s → fica", async (frase) => {
    expect(await segundoBloco(frase)).toBe(frase);
  });

  it("limite declarado: atribuição só pelo nome, sem título nem tribunal, não é pega", () => {
    expect(motivoDoTexto("Como decidiu Nancy Andrighi, a cláusula é abusiva.")).toBeNull();
  });

  it("cópia do acervo SEM [CITA] não tem passe: sairia sem aspas nem fonte (fato de outro cliente virava fato do caso)", async () => {
    expect(await segundoBloco("Conforme o REsp 1.234.567/SP, a cláusula arbitral é nula.")).toBe(MARCA_DO_RETIRADO);
    const m = await blocosDe(
      resposta([DO_MERITO, { texto: "A autora contratou o plano em 10/03/2019, pagando R$ 49,90 mensais.", fontes: ["T1"] }]),
      buscador(hitsDe("Do caso. A autora contratou o plano em 10/03/2019, pagando R$ 49,90 mensais. Fim.")),
    );
    expect(m.blocos[1]!.texto).toBe(MARCA_DO_RETIRADO);
  });

  it("numeração de seção só começa linha depois de fim de frase: 'o Tema\\n12. Logo' não esconde o número", async () => {
    const t = await segundoBloco("Aplica-se ao caso o Tema\n12. Logo, a cláusula é nula.");
    expect(t).not.toMatch(/12/);
  });

  it("citação partida em dois blocos não passa", async () => {
    const m = await minuta(resposta([DO_MERITO, { texto: "Conforme decidiu o STJ no REsp", fontes: ["T1"] }, { texto: "1.999.999/SP, a cláusula é nula.", fontes: ["T1"] }]));
    expect(tudo(m)).not.toMatch(/STJ no REsp|1\.?999/);
  });
});

describe("0005.E3 — frase inteira que, sozinha, troca quem afirma", () => {
  // Os casos da quarta revisão: a frase existe inteira no acervo, mas o começo dela
  // era falso — vinha depois de dois-pontos, de abreviatura ou de título que continua.
  it.each([
    ["depois de 'Alega a ré:'", "o consumidor não tem direito à devolução.", "Do caso. Alega a ré: o consumidor não tem direito à devolução. Fim."],
    ["depois de 'de que:'", "a cláusula arbitral é válida.", "Do caso. Não procede o argumento de que: a cláusula arbitral é válida. Fim."],
    ["depois de 'S.A.'", "de que a multa é devida.", "Do caso. Alegação da Netflix S.A. de que a multa é devida. Fim."],
    ["depois de 'Min.'", "Fulano, para quem a cláusula é válida.", "Do caso. Vencido o Min. Fulano, para quem a cláusula é válida. Fim."],
    ["depois de 'inc.'", "IV do art. 51 aos contratos entre empresas.", "Do caso. Não se aplica o inc. IV do art. 51 aos contratos entre empresas. Fim."],
    ["depois de título que termina em 'QUE'", "a cobrança é devida.", "Do caso.\nNÃO PROCEDE A ALEGAÇÃO DE QUE\na cobrança é devida. Fim."],
  ])("%s: não é frase inteira", (_, frase, texto) => {
    expect(frasesInteirasDe(frase, texto)).toBe(false);
  });

  // Revisão Sonnet da E3: o que a primeira versão recusava sem motivo.
  it.each([
    ["frase que termina em 'Ltda.'", "A ré é Netflix Ltda.", "Do caso. A ré é Netflix Ltda. A ré contestou. Fim."],
    ["a frase depois de 'Ltda.'", "A ré contestou.", "Do caso. A ré é Netflix Ltda. A ré contestou. Fim."],
    ["frase que termina em 'S.A.'", "A ré é Netflix S.A.", "Do caso. A ré é Netflix S.A. A ré contestou. Fim."],
    ["frase que termina em 'art. 5º.'", "A multa decorre do art. 5º.", "Do caso. A multa decorre do art. 5º. A ré contestou. Fim."],
    ["depois de título 'ANEXO A'", "A ação é cabível.", "Do caso.\nANEXO A\nA ação é cabível. Fim."],
    ["depois de título que termina em palavra com acento ('ÓRGÃOS': o \\b veria o conectivo 'os')", "A ação é cabível.", "Do caso.\nDA COMPETÊNCIA DOS ÓRGÃOS\nA ação é cabível. Fim."],
    ["depois de linha que termina em 'Ltda.'", "A ré contestou.", "Do caso. Contra a Netflix Ltda.\nA ré contestou. Fim."],
  ])("%s: é frase inteira", (_, frase, texto) => {
    expect(frasesInteirasDe(frase, texto)).toBe(true);
  });

  it.each([
    ["'Ltda.' no meio da frase (minúscula depois) não fecha", "e contestou.", "Do caso. A Netflix Ltda. e contestou. Fim."],
    ["letra solta antes de maiúscula continua sem fechar (inicial de nome)", "Silva, para quem a cláusula é válida.", "Do caso. Vencido o Min. J. Silva, para quem a cláusula é válida. Fim."],
  ])("%s", (_, frase, texto) => {
    expect(frasesInteirasDe(frase, texto)).toBe(false);
  });

  it.each([
    ["a frase inteira, desde antes dos dois-pontos", "Alega a ré: o consumidor não tem direito à devolução.", "Do caso. Alega a ré: o consumidor não tem direito à devolução. Fim."],
    ["a frase com 'S.A.' no meio", "Alegação da Netflix S.A. de que a multa é devida.", "Do caso. Alegação da Netflix S.A. de que a multa é devida. Fim."],
    ["depois de título de verdade", "A ação civil pública é cabível.", "Do caso.\nDO CABIMENTO DA AÇÃO\nA ação civil pública é cabível. Fim."],
  ])("%s: continua citável", (_, frase, texto) => {
    expect(frasesInteirasDe(frase, texto)).toBe(true);
  });
});

describe("o trecho é PEDAÇO de `fatia`, cortado em qualquer ponto (quarta revisão)", () => {
  const pedacos = pecas.flatMap((p) => fatia(p.paginas));
  /** Frases "de verdade" para o teste: corta só antes de maiúscula, e descarta o que acaba em abreviatura ("art.", "V."). */
  const frasesDe = (t: string) => t.split(/(?<=[.!?])\s+(?=\p{Lu})/u);
  const abreviada = (f: string) => /\b\p{L}{1,4}\.$/u.test(f);

  it("em todo pedaço real, o fragmento do começo e o do fim (cortado) não passam como frase inteira", () => {
    expect(pedacos.length).toBeGreaterThan(5);
    let cortesNoFim = 0;
    for (const p of pedacos) {
      const frases = frasesDe(p.texto);
      expect(frasesInteirasDe(frases[0]!, p.texto)).toBe(false);
      if (!/[.;:!?]$/.test(p.texto)) {
        cortesNoFim++;
        expect(frasesInteirasDe(frases.at(-1)!, p.texto)).toBe(false);
      }
    }
    expect(cortesNoFim).toBeGreaterThan(0);
  });

  it("frase do meio do pedaço real continua citável", () => {
    const meio = pedacos
      .flatMap((p) => {
        const frases = frasesDe(p.texto);
        // Fragmento que começa depois de abreviatura ("Dra.", "Rel.", "V.") não é frase: 0005.E3 o recusa.
        return frases.slice(1, -1).flatMap((f, i) => (abreviada(frases[i]!) ? [] : [[f, p.texto] as const]));
      })
      .filter(([f]) => f.length > 40 && !abreviada(f));
    expect(meio.length).toBeGreaterThan(10);
    for (const [f, t] of meio) expect(frasesInteirasDe(f, t)).toBe(true);
  });

  it("o corte depois de 'Não é verdade que' não deixa citar a tese sem o 'Não'", async () => {
    const m = await blocosDe(
      resposta([DO_MERITO, { texto: '[CITA T1: "a cláusula arbitral imposta ao consumidor é válida."]', fontes: ["T1"] }]),
      buscador(hitsDe("a cláusula arbitral imposta ao consumidor é válida. A ré contestou o pedido.")),
    );
    expect(m.blocos[1]!.texto).toBe(MARCA_DO_RETIRADO);
  });

  it("frase cortada no fim do pedaço não vira frase inteira", async () => {
    const m = await blocosDe(
      resposta([DO_MERITO, { texto: '[CITA T1: "Nos termos da jurisprudência pacífica."]', fontes: ["T1"] }]),
      buscador(hitsDe("Do caso. Nos termos da jurisprudência pacífica do tribunal")),
    );
    expect(m.blocos[1]!.texto).toBe(MARCA_DO_RETIRADO);
  });

  // Revisão Sonnet: a grafia era procurada de novo por regex e saía da PRIMEIRA ocorrência parecida.
  it.each([
    ["frase repetida: sai a ocorrência validada, não a pergunta de antes", "A cláusula é válida.", "Do caso. Dizem que a cláusula é válida? Mas não. A cláusula é válida.", "A cláusula é válida."],
    ["frase repetida: não sai o pedaço da frase negada", "A cláusula é válida.", "Do caso. Não é verdade que a cláusula é válida segundo a ré. Fim. A cláusula é válida.", "A cláusula é válida."],
    ["prefixo de frase mais longa só vale onde é frase inteira", "Aplica-se a Súmula 30.", "Do caso. Aplica-se a Súmula 302 do STJ. Fim. Aplica-se a Súmula 30.", "Aplica-se a Súmula 30."],
    ["aspa de fechamento não vaza para a citação", "a cláusula é válida", 'Do caso. "A cláusula é válida." Depois.', "A cláusula é válida."],
    ["'İ' (dois caracteres em minúscula) não derruba a citação", "İstanbul é cidade.", "Do caso. İstanbul é cidade. Fim.", "İstanbul é cidade."],
    ["emoji antes da frase não desloca o recorte", "A cláusula é válida.", "Do caso. Isso 😀 é feio. A cláusula é válida. Fim.", "A cláusula é válida."],
    ["três emojis antes da frase", "A cláusula é válida.", "Do caso. 😀😀😀 Feio. A cláusula é válida. Fim.", "A cláusula é válida."],
    ["emoji dentro da frase sai inteiro", "A cláusula 😀 é válida.", "Do caso. A cláusula 😀 é válida. Fim.", "A cláusula 😀 é válida."],
    ["aspa de fechamento antes do ponto não sobra", "A cláusula é válida.", 'Do caso. "A cláusula é válida". Depois.', "A cláusula é válida."],
    ["aspa curva de fechamento antes do ponto não sobra", "A cláusula é válida.", "Do caso. “A cláusula é válida”. Depois.", "A cláusula é válida."],
    ["aspa com par dentro da citação fica", "A ré alegou que a cláusula é válida.", 'Do caso. A ré alegou "que a cláusula é válida". Depois.', 'A ré alegou "que a cláusula é válida".'],
    ["aspa curva com par dentro da citação fica", "A ré alegou que a cláusula é válida.", "Do caso. A ré alegou “que a cláusula é válida”. Depois.", "A ré alegou “que a cláusula é válida”."],
  ])("%s", (_, frase, texto, esperado) => {
    expect(grafiaDoAcervo(frase, texto)).toBe(esperado);
  });

  it("muitos espaços e aspas seguidos não travam a busca", () => {
    const t0 = Date.now();
    grafiaDoAcervo("a b c d e f g h i j", `x. a${" ".repeat(50)}${'"'.repeat(50)}${"b.".repeat(2000)}`);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("a grafia do acervo é achada mesmo com o espaçamento e as aspas do PDF", () => {
    expect(grafiaDoAcervo("a lei n.º 8.078/90 atribui legitimação", 'Antes. "A Lei n . º 8.078/90 atribui legitimação." Depois.')).toBe("A Lei n . º 8.078/90 atribui legitimação.");
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

  it("as unidades: abreviatura não corta a frase; o colchete vai inteiro", () => {
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

  it("'sem base' só quando o modelo não apoia nada no acervo (critério 3)", async () => {
    expect(await minuta(resposta([{ texto: "CONTESTAÇÃO TRABALHISTA.", fontes: [] }, { texto: "Das horas extras.", fontes: [] }]))).toMatchObject({ situacao: "sem_base" });
  });

  it("havia base e a trava retirou tudo: a minuta sai com as marcas, nunca 'sem base' (seria mentir)", async () => {
    const m = await blocosDe(resposta([{ texto: "Conforme o REsp n.º 1.999.999/SP.", fontes: ["T1"] }]));
    expect(m.blocos).toEqual([{ texto: MARCA_DO_RETIRADO, fontes: ["T1"], novo: false }]);
    expect(m.faltou).toContain(FALTOU_RETIRADOS);
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

  it("o que faltou passa pela mesma regra: o item fica, com a marca no lugar do que saiu", async () => {
    const m = await blocosDe(resposta([DO_MERITO], ["Falta o acórdão do Tema 1.234 do STJ. Falta a procuração.", "Qualificação das partes."]));
    expect(m.faltou).toEqual([`${MARCA_DO_RETIRADO} Falta a procuração.`, "Qualificação das partes.", FALTOU_RETIRADOS]);
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

describe("0005.E4 — a lista do que faltou não depende do modelo lembrar (critério 5)", () => {
  const LACUNA = "[A COMPLETAR: qualificação do autor]";

  it("bloco sem fonte entra na lista: texto novo é onde o advogado mais precisa olhar", async () => {
    const m = await blocosDe(resposta([DO_MERITO, { texto: "Dos pedidos.", fontes: [] }]));
    expect(m.faltou).toEqual([FALTOU_TEXTO_NOVO]);
  });

  it("lacuna deixada no texto e esquecida na lista entra nela", async () => {
    const m = await blocosDe(resposta([DO_MERITO, { texto: `Autor: ${LACUNA}.`, fontes: ["T1"] }]));
    expect(m.faltou).toEqual(["qualificação do autor"]);
  });

  it("lacuna que o modelo já listou não entra duas vezes, nem a repetida no texto", async () => {
    const texto = `Autor: ${LACUNA}. Réu: ${LACUNA}.`;
    expect((await blocosDe(resposta([DO_MERITO, { texto, fontes: ["T1"] }], ["Qualificação do autor."]))).faltou).toEqual(["Qualificação do autor."]);
    expect((await blocosDe(resposta([DO_MERITO, { texto, fontes: ["T1"] }]))).faltou).toEqual(["qualificação do autor"]);
  });

  it("a marca do trecho retirado não vira item próprio: já está no aviso dos retirados", async () => {
    const m = await blocosDe(resposta([DO_MERITO, { texto: "Conforme o REsp n.º 1.999.999/SP.", fontes: ["T1"] }]));
    expect(m.faltou).toEqual([FALTOU_RETIRADOS]);
  });

  it("lacuna em qualquer grafia entra na lista, e nunca como item em branco (revisão Sonnet)", async () => {
    const faltouDe = async (texto: string) => (await blocosDe(resposta([DO_MERITO, { texto, fontes: ["T1"] }]))).faltou;
    expect(await faltouDe("Autor: [A COMPLETAR : endereço].")).toEqual(["endereço"]);
    expect(await faltouDe("Autor: [PREENCHER: endereço].")).toEqual(["PREENCHER: endereço"]);
    expect(await faltouDe("Contra [NOME DO RÉU].")).toEqual(["NOME DO RÉU"]);
    expect(await faltouDe("Autor: [A COMPLETAR].")).toEqual(["[A COMPLETAR]"]);
    expect(await faltouDe("Autor: [A COMPLETAR:].")).toEqual(["[A COMPLETAR:]"]);
    expect((await faltouDe("Autor: [A COMPLETAR: endereço")).join()).toContain("endereço");
  });

  it("a marca de retirado escrita pelo próprio modelo, sem nada retirado, entra na lista", async () => {
    expect((await blocosDe(resposta([DO_MERITO, { texto: `Autor: ${MARCA_DO_RETIRADO}.`, fontes: ["T1"] }]))).faltou).toHaveLength(1);
  });

  it("repetido é o mesmo item, não item que contém o outro (revisão Sonnet)", async () => {
    const autor = await blocosDe(resposta([DO_MERITO, { texto: "Autor: [A COMPLETAR: autor].", fontes: ["T1"] }], ["Qualificação do autor e do réu."]));
    expect(autor.faltou).toEqual(["Qualificação do autor e do réu.", "autor"]);
    // O aviso dos retirados fala de "data" e "lei": não pode engolir essas lacunas.
    const retirado = await blocosDe(resposta([DO_MERITO, { texto: "Conforme o REsp n.º 1.999.999/SP. Em [A COMPLETAR: data], pela [A COMPLETAR: lei].", fontes: ["T1"] }]));
    expect(retirado.faltou).toEqual([FALTOU_RETIRADOS, "data", "lei"]);
    // Colchete no item que o MODELO pôs na lista não vira um segundo item.
    expect((await blocosDe(resposta([DO_MERITO], ["Falta o [NOME DO RÉU]."]))).faltou).toEqual(["Falta o [NOME DO RÉU]."]);
  });

  it("tudo com origem e nada a completar: a lista vazia é a resposta certa", async () => {
    expect((await blocosDe(resposta([DO_MERITO, { texto: "Dos pedidos.", fontes: ["T1"] }]))).faltou).toEqual([]);
  });

  it("varredura: em toda minuta, lista vazia só quando todo bloco tem fonte e nenhum colchete ficou no texto", async () => {
    const casos = [
      ...Object.values(gravada.respostas),
      resposta([DO_MERITO, { texto: "Dos pedidos.", fontes: [] }]),
      resposta([DO_MERITO, { texto: `Autor: ${LACUNA}.`, fontes: ["T1"] }]),
      resposta([DO_MERITO, { texto: "Conforme o REsp n.º 1.999.999/SP.", fontes: ["T9"] }]),
      resposta([DO_MERITO, { texto: "Dos pedidos.", fontes: ["T1"] }]),
      ...["[A COMPLETAR]", "[A COMPLETAR : x]", "[A COMPLETAR: x", "[PREENCHER: x]", "[NOME DO RÉU]", "[A COMPLETAR:]", MARCA_DO_RETIRADO].map((l) =>
        resposta([DO_MERITO, { texto: `Autor: ${l}.`, fontes: ["T1"] }]),
      ),
    ];
    let minutas = 0;
    let vazias = 0;
    for (const r of casos) {
      const m = await minuta(r);
      if (m.situacao !== "minuta") continue;
      minutas++;
      if (m.faltou.length > 0) continue;
      vazias++;
      // O oráculo não usa `novo` (que o próprio código calcula): lê `fontes` e o texto.
      expect({ r, blocos: m.blocos.filter((b) => b.fontes.length === 0 || b.texto.includes("[")) }).toEqual({ r, blocos: [] });
    }
    expect(minutas).toBeGreaterThanOrEqual(12);
    expect(vazias).toBeGreaterThanOrEqual(1);
  });

});

/*
 * Mutações: `node scripts/mutar-minuta.mjs` tira cada regra de lib/acervo/minuta.ts
 * (inclusive cada linha de LINHAS_DE_CITACAO), roda este arquivo e restaura.
 */
