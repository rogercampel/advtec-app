import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Pagina } from "@/lib/acervo/fatiar";
import { linhaDoTempo } from "@/lib/acervo/linha-do-tempo";
import { metadadoDaPeca } from "@/lib/acervo/metadado";
import { quemEQuem } from "@/lib/acervo/quem-e-quem";

/**
 * Leitura de peças REAIS — tickets 0003.E2 (#29, quem é quem) e 0003.E3 (linha
 * do tempo), e o tipo da peça da 0002.
 *
 * O fixture são páginas de duas iniciais PÚBLICAS, baixadas dos sites oficiais
 * do TJMG e do MPRJ em 21/10/2026. Os gabaritos abaixo foram conferidos à mão
 * contra o texto do PDF, não contra a saída do código.
 *
 * ATENÇÃO: as regras foram AJUSTADAS nessas duas peças, então os gabaritos
 * reais provam que o formato delas é lido, não que o de qualquer peça é. Os
 * casos sintéticos de borda (JUSTIÇA GRATUITA, contestação que cita "ajuizar",
 * "R$ 50 mil", "j. 10/03/2021", "relatório médico") vieram de um segundo leitor
 * sem contexto, e cada um derrubou a versão anterior do código. A validação de
 * verdade é a do piloto (spec 0003, "gabarito feito à mão").
 *
 * O que as peças reais mostraram e o texto sintético não mostrava:
 *   - a maioria das datas de uma petição é de jurisprudência citada;
 *   - o PDF quebra a linha no meio da frase ("DJ de\n04/10/2002");
 *   - "vem propor:" com dois-pontos, "EXMO." abreviado, "27 janeiro de 2006" sem "de".
 *
 * Mutações: ver o fim do arquivo.
 */

type Peca = { id: string; paginas: Pagina[] };
const { pecas } = JSON.parse(readFileSync("tests/fixtures/pecas-publicas.json", "utf8")) as { pecas: Peca[] };
const peca = (id: string) => pecas.find((p) => p.id === id)!.paginas;
const TJMG = peca("tjmg-acp-netflix");
const MPRJ = peca("mprj-acp-brascan");
const HOJE = new Date("2026-10-21T12:00:00Z");
const pag = (numero: number, texto: string) => ({ numero, texto });

describe("linha do tempo em peça real: jurisprudência citada não é fato do caso", () => {
  it.each([
    ["TJMG", TJMG, "2023-06-21", "Belo Horizonte, 21 de junho de 2023.", 34],
    ["MPRJ", MPRJ, "2006-01-27", "Rio de Janeiro, 27 janeiro de 2006.", 12],
  ])("%s: o único fato datado é a assinatura da inicial", (_, paginas, data, trecho, pagina) => {
    const r = linhaDoTempo(paginas, { hoje: HOJE });
    expect(r.eventos).toEqual([{ data, trecho, pagina }]);
    expect(r.citacoes).toBeGreaterThanOrEqual(5);
  });
});

describe("linha do tempo: citação só com evidência local; na dúvida o fato entra", () => {
  const datas = (texto: string) => linhaDoTempo([pag(1, texto)], { hoje: HOJE });

  it.each([
    ["formato TJSP com ponto e vírgula", "Nesse sentido: (TJSP; Apelação Cível 1000000-00.2020.8.26.0100; Relator (a): Fulano; Órgão Julgador: 3ª Câmara de Direito Privado; Data do Julgamento: 10/03/2021; Data de Registro: 11/03/2021).", 2],
    ['"j." abreviado', "Nesse sentido: (TJSP, Ap. 1000000-00.2020, Rel. Des. Fulano, j. 10/03/2021). Assim, procede o pedido.", 1],
    ["ementa sem parênteses", "AgRg no AREsp 123/SP, Rel. Ministro Fulano, Quarta Turma, julgado em 24/09/2013, DJe 01/10/2013.", 2],
    ["data de lei", "Aplica-se a Lei nº 8.078, de 11 de setembro de 1990, ao caso.", 1],
    ["só entre parênteses, sem 'j.' nem 'DJe'", "(REsp 1.234/SP, Rel. Min. Fulano, Terceira Turma, 15/05/2019).", 1],
  ])("%s: sai como citação", (_, texto, n) => {
    const r = datas(texto);
    expect(r.eventos).toEqual([]);
    expect(r.citacoes).toBe(n);
  });

  it.each([
    ["relatório médico", "Conforme relatório médico publicado em 12/03/2024, o autor ficou incapacitado.", "2024-03-12"],
    ["Câmara Municipal", "O autor foi exonerado pela Câmara Municipal de Betim em 10/03/2023, sem processo.", "2023-03-10"],
    ["julgamento do próprio caso", "O agravo de instrumento interposto pelo autor foi julgado em 10/02/2024 e provido.", "2024-02-10"],
    ["fato logo depois de citação", "(STJ, REsp 1/SP, Rel. Min. Fulano, DJe 10/10/2020)\nEm 15/03/2023, a ré negativou o nome do autor.", "2023-03-15"],
  ])("%s: é fato do caso e fica", (_, texto, data) => {
    expect(datas(texto).eventos.map((e) => e.data)).toEqual([data]);
  });

  it("frase quebrada pelo PDF vira um trecho só, sem a quebra", () => {
    const r = datas("Em 10 de março de 2024 o autor pediu\no cancelamento do plano.");
    expect(r.eventos[0]?.trecho).toBe("Em 10 de março de 2024 o autor pediu o cancelamento do plano.");
  });
});

describe("tipo da peça em capa real", () => {
  it.each([
    ["TJMG", TJMG],
    ["MPRJ (vem propor:)", MPRJ],
  ])("%s é petição inicial", (_, paginas) => {
    expect(metadadoDaPeca(paginas).tipo_peca?.valor).toBe("peticao_inicial");
  });

  it('"EXMO." conta como endereçamento: a inicial que cita contrato não vira contrato', () => {
    const capa = pag(1, "EXMO. SR. DR. JUIZ DE DIREITO DA 1ª VARA CÍVEL\nFULANO DE TAL, brasileiro, vem cobrar o valor do contrato de locação.");
    expect(metadadoDaPeca([capa]).tipo_peca?.valor).not.toBe("contrato");
  });
});

describe("critério 1 da spec 0003: quem é quem, extraído e com página", () => {
  it("TJMG — gabarito conferido à mão", () => {
    const q = quemEQuem(TJMG);
    expect(q.juizo).toMatchObject({ valor: "____ VARA CÍVEL DA COMARCA DE BELO HORIZONTE – MINAS GERAIS", pagina: 1 });
    expect(q.autor).toMatchObject({ valor: "INSTITUTO DEFESA COLETIVA", pagina: 1 });
    expect(q.classe).toMatchObject({ valor: "AÇÃO CIVIL PÚBLICA COM PEDIDO LIMINAR", pagina: 1 });
    expect(q.reu).toMatchObject({ valor: "NETFLIX ENTRETENIMENTO BRASIL LTDA", pagina: 1 });
    expect(q.valor_da_causa).toMatchObject({ valor: "R$19.500.000,00", pagina: 34 });
    expect(q.advogados.map((a) => [a.valor, a.oab, a.pagina])).toEqual([
      ["LILLIAN JORGE SALGADO", "OAB/MG 84.841", 34],
      ["LANAY MONTEIRO DE CASTRO MAIA", "OAB/MG 193.135", 34],
    ]);
  });

  it("MPRJ — gabarito conferido à mão (ementa antes do endereçamento, referência antes do autor)", () => {
    const q = quemEQuem(MPRJ);
    expect(q.juizo).toMatchObject({ valor: "VARA EMPRESARIAL DA COMARCA DA CAPITAL DO RIO DE JANEIRO", pagina: 1 });
    expect(q.autor).toMatchObject({ valor: "O MINISTÉRIO PÚBLICO DO ESTADO DO RIO DE JANEIRO", pagina: 1 });
    expect(q.classe).toMatchObject({ valor: "AÇÃO CIVIL PÚBLICA com pedido liminar", pagina: 1 });
    expect(q.reu).toMatchObject({ valor: "BRASCAN IMOBILIÁRIA INCORPORAÇÃO S.A", pagina: 1 });
    expect(q.valor_da_causa).toMatchObject({ valor: "R$100.000,00", pagina: 12 });
    expect(q.advogados).toEqual([]); // promotor não tem OAB
  });

  it("todo campo achado está, literal, na página que ele aponta", () => {
    for (const paginas of [TJMG, MPRJ]) {
      const q = quemEQuem(paginas);
      const campos = [q.juizo, q.autor, q.classe, q.reu, q.valor_da_causa, ...q.advogados];
      for (const c of campos) {
        const texto = paginas.find((p) => p.numero === c!.pagina)!.texto.replace(/\s+/g, " ");
        expect(texto).toContain(c!.trecho);
        expect(c!.trecho).toContain(c!.valor);
      }
    }
  });
});

describe("o que não está escrito sai null, não palpite", () => {
  it("contestação: quem abre a capa é o réu, então autor e réu ficam vazios", () => {
    const capa = pag(
      1,
      "EXCELENTÍSSIMO SENHOR JUIZ DE DIREITO DA 2ª VARA CÍVEL DE CONTAGEM\n\nFULANO DE TAL, já qualificado nos autos da ação que lhe move BELTRANO, vem apresentar CONTESTAÇÃO.",
    );
    const q = quemEQuem([capa]);
    expect(q.juizo?.valor).toBe("2ª VARA CÍVEL DE CONTAGEM");
    expect(q.autor).toBeNull();
    expect(q.reu).toBeNull();
    expect(q.classe).toBeNull();
  });

  it("valor da causa: só a fórmula do autor, com centavos; dois valores diferentes → null", () => {
    const valor = (...textos: string[]) => quemEQuem(textos.map((t, i) => pag(i + 1, t))).valor_da_causa?.valor ?? null;
    expect(valor("honorários de 20% sobre o valor da causa, dado o valor inestimável.")).toBeNull();
    expect(valor("Dá-se à causa o valor de R$ 50 mil.")).toBeNull(); // viraria "R$ 50"
    expect(valor("Dá-se à causa o valor de R$ 500.000,00.", "Requer seja atribuído à causa o valor de R$ 20.000,00.")).toBe(
      "R$ 500.000,00",
    ); // o pedido do réu na contestação não é o valor da causa
    expect(valor("Dá-se à causa o valor de R$ 10.000,00.", "EMENDA. Retifica-se. Valor da causa: R$ 25.000,00.")).toBeNull();
    expect(valor("Dá-se à causa o valor de R$ 10.000,00.", "Dá-se à causa o valor de R$ 10.000,00.")).toBe("R$ 10.000,00");
  });

  const capa = (corpo: string) =>
    quemEQuem([pag(1, `EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 2ª VARA CÍVEL DA COMARCA DE CURITIBA - PR\n${corpo}`)]);
  const INICIAL = "vem propor a presente AÇÃO DE INDENIZAÇÃO em face de BANCO X S.A., pessoa jurídica.";

  it("faixa de destaque no topo não vira juízo nem autor", () => {
    for (const faixa of ["\nJUSTIÇA GRATUITA\n\n", "URGENTE – PEDIDO LIMINAR\n"]) {
      const q = capa(`${faixa}JOÃO DA SILVA, brasileiro, ${INICIAL}`);
      expect(q.juizo?.valor).toBe("2ª VARA CÍVEL DA COMARCA DE CURITIBA - PR");
      expect(q.autor?.valor).toBe("JOÃO DA SILVA");
    }
  });

  it("nome do autor quebrado em duas linhas sai null, não pela metade", () => {
    const q = capa(`MARIA APARECIDA DOS SANTOS\nOLIVEIRA, brasileira, ${INICIAL}`);
    expect(q.juizo?.valor).toBe("2ª VARA CÍVEL DA COMARCA DE CURITIBA - PR");
    expect(q.autor).toBeNull();
  });

  it("'juízo' no corpo não é endereçamento; 'JUIZ(A)' e 'AO JUÍZO DE DIREITO' são", () => {
    const corpo = "\nMARIA DA SILVA, brasileira, vem propor a presente AÇÃO DE COBRANÇA em face de JOSÉ SOUZA, brasileiro, pois o juízo da comarca de Campinas é competente.";
    expect(quemEQuem([pag(1, `EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DE DIREITO DA 5ª VARA CÍVEL DA COMARCA DE CAMPINAS/SP\n${corpo}`)]).juizo?.valor).toBe(
      "5ª VARA CÍVEL DA COMARCA DE CAMPINAS/SP",
    );
    expect(quemEQuem([pag(1, `AO JUÍZO DE DIREITO DA 3ª VARA CÍVEL DA COMARCA DE LONDRINA - PR\n${corpo}`)]).juizo?.valor).toBe(
      "3ª VARA CÍVEL DA COMARCA DE LONDRINA - PR",
    );
    expect(quemEQuem([pag(1, corpo)]).juizo).toBeNull();
  });

  it("classe é o nome da ação, sem o rito e o fundamento que vêm depois da vírgula", () => {
    const q = capa(`JOÃO DA SILVA, brasileiro, vem propor a presente AÇÃO DE INDENIZAÇÃO POR DANOS MORAIS, pelo procedimento comum, com fundamento nos arts. 186 e 927 do Código Civil, em face de BANCO X S.A., pessoa jurídica.`);
    expect(q.classe?.valor).toBe("AÇÃO DE INDENIZAÇÃO POR DANOS MORAIS");
    expect(q.reu?.valor).toBe("BANCO X S.A.");
  });

  it("o que vem depois de 'propor' e não é nome de ação não vira classe", () => {
    const q = capa(`PETIÇÃO INICIAL\nJOÃO DA SILVA, brasileiro, vem propor em caráter de urgência, AÇÃO DE COBRANÇA em face de BANCO X S.A., pessoa jurídica.`);
    expect(q.classe).toBeNull();
  });

  it("contestação que cita 'ajuizar a presente ação em face de' não troca os papéis", () => {
    const q = quemEQuem([
      pag(
        1,
        "EXCELENTÍSSIMO SENHOR JUIZ DE DIREITO DA 2ª VARA CÍVEL DE CONTAGEM\n\nFULANO DE TAL, já qualificado nos autos da ação que lhe move BELTRANO, vem apresentar CONTESTAÇÃO. O autor resolveu ajuizar a presente AÇÃO DE COBRANÇA em face de FULANO DE TAL, alegando dívida inexistente.",
      ),
    ]);
    expect(q.autor).toBeNull();
    expect(q.reu).toBeNull();
    expect(q.classe).toBeNull();
  });

  it("cargo na linha acima da OAB não vira nome de advogado", () => {
    expect(quemEQuem([pag(1, "Pede deferimento.\nJOÃO PEREIRA LIMA\nADVOGADO\nOAB/SP 123.456")]).advogados).toEqual([]);
  });

  it("sem endereçamento, sem juízo; sem texto, tudo vazio", () => {
    const q = quemEQuem([pag(1, "Relatório interno sobre a carteira de clientes.")]);
    expect(q.juizo).toBeNull();
    expect(q.autor).toBeNull();
    expect(quemEQuem([pag(1, "   ")])).toEqual({ juizo: null, autor: null, classe: null, reu: null, valor_da_causa: null, advogados: [] });
  });
});

/*
 * Mutações (21/10/2026, depois do segundo leitor): 19 de 19 derrubaram ao menos
 * um teste daqui. Linha do tempo: desligar `eCitacao`; não achatar a quebra no
 * trecho; (a) sem exigir referência de tribunal; sem (b), os parênteses; sem (c),
 * a norma; `relator` sem a borda (casa "relatório"); data por extenso exigindo
 * "de". Tipo: sem o ":?" de "vem propor:"; sem "exmo". Quem é quem: sem exigir
 * inicial; juízo sem exigir só tratamento antes de "juiz"; autor sem pular a
 * faixa; continuação do juízo sem exigir linha pendurada; nome sem exigir a
 * vírgula na mesma linha; classe sem cortar na vírgula; classe sem exigir
 * "ação/reclamação/…" no início; advogado aceitando cargo; valor com dois
 * diferentes; valor sem exigir centavos.
 */
