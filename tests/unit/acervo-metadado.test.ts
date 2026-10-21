import { describe, expect, it } from "vitest";

import { DIMENSAO_CONTRATO, ingere, type ClienteAcervo, type Documento, type LinhaChunk } from "@/lib/acervo/ingerir";
import {
  AREAS,
  TIPOS_DE_PECA,
  ZONA_DO_CABECALHO,
  corrige,
  extraiArea,
  extraiTipoDePeca,
  metadadoDaPeca,
  sombra,
  validaCorrecao,
} from "@/lib/acervo/metadado";

/**
 * Ticket 0002.E3 — metadado jurídico. "Tipo de peça e área extraídos e
 * corrigíveis", gravados em `ai_chunks.metadata` (spec 0002, mudança 2).
 *
 * O CORPUS É SINTÉTICO. Não havia peça real de escritório em 12/10/2026; as
 * frases abaixo são vocabulário forense corrente, escritas para o teste. O
 * que este arquivo prova é a mecânica — trecho, dúvida que vira `null`,
 * correção que vence. Se o padrão acerta peça de verdade, só os 20 documentos
 * do piloto dizem.
 *
 * MUTAÇÕES (12/10/2026): 23 feitas, uma por vez, cada uma conferida como
 * aplicada antes de rodar; 23 acusadas. Por regra apagada:
 *  - sombra sem tirar acento; frase sem `\b`; espaço da frase sem casar quebra
 *    de linha.
 *  - tipo: procurado no texto inteiro; vence o último; sem a guarda de
 *    réplica; sem pular página em branco; peça em juízo virando contrato;
 *    inicial só com "a presente".
 *  - área: um sinal decide; empate decide; sinal contado por página; trecho
 *    que não é o primeiro.
 *  - correção: tipo, área, campo desconhecido e forma errada sem validar;
 *    área sem minúscula e sem grafia canônica; correção que não vence (tipo,
 *    área).
 *  - ingestão: metadado fora do pedaço; correção ignorada.
 *
 * Na primeira rodada a mutação da quebra de linha SOBREVIVEU: o teste só
 * conferia `valor`, e a alternativa curta "apelacao" casava sozinha. Passou a
 * conferir o trecho inteiro.
 */

const pag = (texto: string, numero = 1) => [{ numero, texto }];

describe("a sombra de comparação", () => {
  it("tira acento e caixa sem mudar o comprimento", () => {
    const s = "CONTESTAÇÃO à Ação";
    expect(sombra(s)).toBe("contestacao a acao");
    expect(sombra(s)).toHaveLength(s.length);
  });
});

describe("tipo de peça — sai do cabeçalho, com o trecho que o fundamenta", () => {
  it("reconhece o título explícito PETIÇÃO INICIAL sem depender do verbo propor", () => {
    expect(extraiTipoDePeca(pag("PETIÇÃO INICIAL — AÇÃO DE DIVÓRCIO COM PEDIDO DE GUARDA", 4))).toEqual({
      valor: "peticao_inicial", trecho: "PETIÇÃO INICIAL", pagina: 4,
    });
  });
  it.each([
    ["peticao_inicial", "FULANO DE TAL, brasileiro, vem propor a presente AÇÃO DE COBRANÇA em face de BELTRANO.", "propor a presente AÇÃO"],
    ["peticao_inicial", "FULANO vem, respeitosamente, ajuizar AÇÃO DE ALIMENTOS contra BELTRANO.", "ajuizar AÇÃO"],
    ["contestacao", "BELTRANO, nos autos da ação que lhe move FULANO, vem apresentar CONTESTAÇÃO, pelos fatos a seguir.", "CONTESTAÇÃO"],
    ["recurso", "FULANO, inconformado com a sentença, vem interpor RECURSO DE APELAÇÃO.", "RECURSO DE APELAÇÃO"],
    ["recurso", "AGRAVO DE INSTRUMENTO com pedido de efeito suspensivo.", "AGRAVO DE INSTRUMENTO"],
    ["contrato", "CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS. Pelo presente instrumento...", "CONTRATO DE"],
    ["parecer", "PARECER JURÍDICO. Consulta formulada pela diretoria.", "PARECER"],
  ])("%s", (tipo, texto, trecho) => {
    expect(extraiTipoDePeca(pag(texto, 7))).toEqual({ valor: tipo, trecho, pagina: 7 });
  });

  it("o trecho é recorte LITERAL do texto, acento e caixa preservados", () => {
    const texto = "Vem apresentar Contestação aos pedidos.";
    const a = extraiTipoDePeca(pag(texto));
    expect(texto).toContain(a!.trecho);
    expect(a!.trecho).toBe("Contestação");
  });

  it("casa mesmo com a linha quebrada no meio da expressão", () => {
    // o trecho inteiro, não só "APELAÇÃO": é a frase que tem de atravessar a quebra.
    expect(extraiTipoDePeca(pag("vem interpor RECURSO\nDE   APELAÇÃO"))).toMatchObject({
      valor: "recurso",
      trecho: "RECURSO\nDE   APELAÇÃO",
    });
  });

  it("peça endereçada a juízo não vira contrato nem parecer por citar um", () => {
    expect(
      extraiTipoDePeca(pag("EXCELENTÍSSIMO SENHOR JUIZ. FULANO vem cobrar o valor do contrato de locação firmado.")),
    ).toBeNull();
    expect(
      extraiTipoDePeca(pag("AO JUÍZO da 3ª Vara Cível. Em atenção ao parecer do Ministério Público, FULANO diz.")),
    ).toBeNull();
    // e o endereçamento não atrapalha o que É peça de juízo
    expect(
      extraiTipoDePeca(pag("EXCELENTÍSSIMO SENHOR JUIZ. BELTRANO vem apresentar CONTESTAÇÃO ao contrato de mútuo."))
        ?.valor,
    ).toBe("contestacao");
  });

  it("vale o que aparece PRIMEIRO: parecer sobre contrato é parecer", () => {
    expect(extraiTipoDePeca(pag("PARECER. Consulta sobre o contrato de locação firmado."))?.valor).toBe("parecer");
    expect(extraiTipoDePeca(pag("vem propor a presente AÇÃO DE RESCISÃO DE CONTRATO DE LOCAÇÃO"))?.valor).toBe(
      "peticao_inicial",
    );
  });

  it("réplica à contestação NÃO é contestação — fica para o advogado", () => {
    expect(extraiTipoDePeca(pag("FULANO vem apresentar RÉPLICA À CONTESTAÇÃO de fls. 40."))).toBeNull();
    expect(extraiTipoDePeca(pag("CONTRARRAZÕES ao recurso de apelação interposto."))).toBeNull();
  });

  it("menção fora do cabeçalho não define o tipo", () => {
    const enchimento = "Dos fatos narrados. ".repeat(Math.ceil(ZONA_DO_CABECALHO / 20) + 5);
    expect(enchimento.length).toBeGreaterThan(ZONA_DO_CABECALHO);
    expect(extraiTipoDePeca(pag(enchimento + " conforme a contestação apresentada."))).toBeNull();
    // e só a primeira página com texto conta
    expect(
      extraiTipoDePeca([
        { numero: 1, texto: "Memorando interno do escritório." },
        { numero: 2, texto: "CONTESTAÇÃO" },
      ]),
    ).toBeNull();
  });

  it("pula página em branco para achar o cabeçalho", () => {
    expect(
      extraiTipoDePeca([
        { numero: 1, texto: "   " },
        { numero: 2, texto: "CONTESTAÇÃO" },
      ]),
    ).toEqual({ valor: "contestacao", trecho: "CONTESTAÇÃO", pagina: 2 });
  });

  it("sem título reconhecível não inventa tipo", () => {
    expect(extraiTipoDePeca(pag("Ata da reunião de sócios de 3 de março."))).toBeNull();
    expect(extraiTipoDePeca([])).toBeNull();
  });
});

describe("área — contagem de sinais distintos, e dúvida vira null", () => {
  it("dois sinais da mesma área decidem, e o trecho é o primeiro em ordem de leitura", () => {
    const paginas = [
      { numero: 1, texto: "Excelentíssimo Juiz da 2ª Vara do Trabalho de Campinas." },
      { numero: 2, texto: "O reclamante pede o pagamento das verbas rescisórias." },
    ];
    expect(extraiArea(paginas)).toEqual({ valor: "trabalhista", trecho: "Vara do Trabalho", pagina: 1 });
  });

  it.each([
    ["consumidor", "Há relação de consumo, e o Código de Defesa do Consumidor se aplica ao fornecedor."],
    ["familia", "Ação de divórcio cumulada com guarda e alimentos."],
    ["previdenciario", "O INSS negou a aposentadoria ao segurado."],
    ["tributario", "A execução fiscal cobra crédito tributário de ICMS."],
    ["penal", "A denúncia narra crime do Código Penal, apurado em inquérito policial."],
  ])("%s", (area, texto) => {
    expect(extraiArea(pag(texto))?.valor).toBe(area);
  });

  it("toda área declarada tem ao menos um caso acima ou abaixo", () => {
    expect(AREAS).toEqual(["trabalhista", "consumidor", "familia", "previdenciario", "tributario", "penal"]);
  });

  it("um sinal só não decide", () => {
    expect(extraiArea(pag("O consumidor final paga o preço de tabela."))).toBeNull();
  });

  it("o mesmo sinal repetido conta uma vez", () => {
    expect(
      extraiArea([
        { numero: 1, texto: "O reclamante disse." },
        { numero: 2, texto: "O reclamante voltou." },
        { numero: 3, texto: "O reclamante saiu." },
      ]),
    ).toBeNull();
  });

  it("empate entre duas áreas é dúvida", () => {
    const texto = "O reclamante pede verbas rescisórias. O INSS negou a aposentadoria.";
    expect(extraiArea(pag(texto))).toBeNull();
  });

  it("sigla curta não casa dentro de palavra", () => {
    // "ipi" dentro de "principio", "iss" dentro de "emissao": sem a borda, viraria tributário.
    expect(extraiArea(pag("O princípio da emissão e o contribuinte."))).toBeNull();
  });

  it("acento não esconde o sinal", () => {
    expect(extraiArea(pag("RECLAMAÇÃO TRABALHISTA. Vínculo empregatício negado."))?.valor).toBe("trabalhista");
  });
});

describe("correção — vem de fora, então é validada", () => {
  it("aceita os tipos do contrato, inclusive `outro`", () => {
    for (const t of TIPOS_DE_PECA) expect(validaCorrecao({ tipo_peca: t })).toEqual({ tipo_peca: t });
  });

  it("recusa tipo fora do contrato", () => {
    expect(() => validaCorrecao({ tipo_peca: "sentenca" })).toThrow(/tipo de peça inválido/);
    expect(() => validaCorrecao({ tipo_peca: null })).toThrow(/tipo de peça inválido/);
  });

  it("a área é texto do escritório: limpa, minúscula, com teto", () => {
    expect(validaCorrecao({ area: "  Direito   Bancário " })).toEqual({ area: "direito bancário" });
    // área conhecida cai na MESMA grafia que a extração usa
    expect(validaCorrecao({ area: "Família" })).toEqual({ area: "familia" });
    expect(() => validaCorrecao({ area: "   " })).toThrow(/área inválida/);
    expect(() => validaCorrecao({ area: "x".repeat(61) })).toThrow(/área inválida/);
    expect(() => validaCorrecao({ area: 7 })).toThrow(/área inválida/);
  });

  it("recusa campo desconhecido e forma errada", () => {
    expect(() => validaCorrecao({ tipo: "recurso" })).toThrow(/campo desconhecido: tipo/);
    expect(() => validaCorrecao("recurso")).toThrow(/objeto/);
    expect(() => validaCorrecao(["recurso"])).toThrow(/objeto/);
  });

  it("ausente é sem correção", () => {
    expect(validaCorrecao(undefined)).toEqual({});
    expect(validaCorrecao(null)).toEqual({});
  });
});

describe("a correção vence a extração, campo a campo", () => {
  const INICIAL_TRABALHISTA = pag(
    "FULANO vem propor a presente RECLAMAÇÃO TRABALHISTA. O reclamante foi dispensado sem verbas rescisórias.",
    3,
  );

  it("sem correção, os dois campos saem como extraídos, com trecho e página", () => {
    expect(metadadoDaPeca(INICIAL_TRABALHISTA)).toEqual({
      tipo_peca: { valor: "peticao_inicial", origem: "extraido", trecho: "propor a presente RECLAMAÇÃO", pagina: 3 },
      area: { valor: "trabalhista", origem: "extraido", trecho: "RECLAMAÇÃO TRABALHISTA", pagina: 3 },
    });
  });

  it("corrigir um campo não mexe no outro", () => {
    const m = metadadoDaPeca(INICIAL_TRABALHISTA, { tipo_peca: "recurso" });
    expect(m.tipo_peca).toEqual({ valor: "recurso", origem: "corrigido" });
    expect(m.area?.origem).toBe("extraido");
  });

  it("a correção preenche o que a extração deixou vazio", () => {
    const m = metadadoDaPeca(pag("Ata da reunião."), { tipo_peca: "outro", area: "societário" });
    expect(m).toEqual({
      tipo_peca: { valor: "outro", origem: "corrigido" },
      area: { valor: "societário", origem: "corrigido" },
    });
  });

  it("correção inválida LANÇA — não é ignorada em silêncio", () => {
    expect(() => metadadoDaPeca(INICIAL_TRABALHISTA, { tipo_peca: "sentenca" })).toThrow(/tipo de peça inválido/);
  });

  it("corrige() serve ao metadado já gravado, sem reextrair", () => {
    const gravado = metadadoDaPeca(INICIAL_TRABALHISTA);
    const depois = corrige(gravado, { area: "previdenciário" });
    expect(depois.area).toEqual({ valor: "previdenciario", origem: "corrigido" });
    expect(depois.tipo_peca).toEqual(gravado.tipo_peca);
    expect(depois).toEqual(metadadoDaPeca(INICIAL_TRABALHISTA, { area: "previdenciário" }));
  });

  it("corrige() também recusa correção inválida recebida diretamente", () => {
    const gravado = metadadoDaPeca(INICIAL_TRABALHISTA);
    expect(() => corrige(gravado, { tipo_peca: "sentenca" } as unknown as Parameters<typeof corrige>[1])).toThrow(/tipo de peça inválido/);
    expect(() => corrige(gravado, { area: " " })).toThrow(/área inválida/);
  });
});

describe("o metadado chega em ai_chunks.metadata pela ingestão", () => {
  function acervoEmMemoria() {
    const banco: LinhaChunk[] = [];
    const cliente: ClienteAcervo = {
      async hashesExistentes(_org, kbVersionId) {
        return new Set(banco.filter((l) => l.kb_version_id === kbVersionId).map((l) => l.content_hash));
      },
      async proximaPosicao(sourceId, kbVersionId) {
        return banco.filter((l) => l.knowledge_source_id === sourceId && l.kb_version_id === kbVersionId).length;
      },
      async inserirChunks(linhas) {
        banco.push(...linhas);
        return { inseridos: linhas.length };
      },
    };
    return { banco, cliente };
  }

  const TEXTOS: Record<string, string> = {
    "doc-contestacao":
      "BELTRANO vem apresentar CONTESTAÇÃO. A reclamada nega o vínculo de emprego alegado pelo reclamante.",
    "doc-ata": "Ata da reunião de sócios realizada em março.",
    "doc-parecer": "PARECER. Consulta sobre crédito tributário em execução fiscal.",
  };
  const deps = (cliente: ClienteAcervo) => ({
    extrair: async (d: Documento) => [{ numero: 1, texto: TEXTOS[d.id]! }],
    embedar: async (textos: string[]) => textos.map(() => Array.from({ length: DIMENSAO_CONTRATO }, () => 0.1)),
    cliente,
  });
  const doc = (id: string, correcao?: Documento["correcao"]): Documento => ({ id, nome: `${id}.pdf`, correcao });

  it("cada pedaço carrega o tipo e a área do SEU documento", async () => {
    const { banco, cliente } = acervoEmMemoria();
    await ingere("org-1", "src-1", "v1", [doc("doc-contestacao"), doc("doc-ata"), doc("doc-parecer")], deps(cliente));

    const por = (id: string) => banco.filter((l) => l.metadata.documento === id);
    expect(por("doc-contestacao").length).toBeGreaterThan(0);
    for (const l of por("doc-contestacao")) {
      expect(l.metadata.tipo_peca).toMatchObject({ valor: "contestacao", origem: "extraido", pagina: 1 });
      expect(l.metadata.area).toMatchObject({ valor: "trabalhista", origem: "extraido" });
    }
    for (const l of por("doc-ata")) {
      expect(l.metadata.tipo_peca).toBeNull();
      expect(l.metadata.area).toBeNull();
    }
    for (const l of por("doc-parecer")) {
      expect(l.metadata.tipo_peca).toMatchObject({ valor: "parecer" });
      expect(l.metadata.area).toMatchObject({ valor: "tributario" });
    }
    // a página de origem da E1 continua lá
    expect(banco.every((l) => l.metadata.pagina_inicial === 1)).toBe(true);
  });

  it("a correção do advogado entra no pedaço, marcada como corrigida", async () => {
    const { banco, cliente } = acervoEmMemoria();
    await ingere("org-1", "src-1", "v1", [doc("doc-ata", { tipo_peca: "outro", area: "societário" })], deps(cliente));
    expect(banco[0]!.metadata.tipo_peca).toEqual({ valor: "outro", origem: "corrigido" });
    expect(banco[0]!.metadata.area).toEqual({ valor: "societário", origem: "corrigido" });
  });

  it("repete o metadado do documento em mais de um pedaço, inclusive nas páginas sem sinais", async () => {
    const { banco, cliente } = acervoEmMemoria();
    await ingere("org-1", "src-1", "v1", [doc("doc-contestacao")], {
      ...deps(cliente),
      extrair: async () => [
        { numero: 2, texto: TEXTOS["doc-contestacao"]! },
        { numero: 3, texto: "Descrição dos fatos e documentos juntados. ".repeat(200) },
      ],
    });
    expect(banco.length).toBeGreaterThan(1);
    expect(banco.some((l) => l.metadata.pagina_inicial === 3)).toBe(true);
    for (const l of banco) {
      expect(l.metadata.tipo_peca).toEqual({ valor: "contestacao", origem: "extraido", trecho: "CONTESTAÇÃO", pagina: 2 });
      expect(l.metadata.area).toEqual({ valor: "trabalhista", origem: "extraido", trecho: "reclamada", pagina: 2 });
    }
  });

  it("correção inválida vira FALHA daquele documento e não derruba o lote", async () => {
    const { banco, cliente } = acervoEmMemoria();
    const invalida = { tipo_peca: "sentenca" } as unknown as Documento["correcao"];
    const r = await ingere("org-1", "src-1", "v1", [doc("doc-ata", invalida), doc("doc-parecer")], deps(cliente));

    expect(r.falhas).toEqual([{ documento: "doc-ata", motivo: "metadado: tipo de peça inválido: sentenca" }]);
    expect(new Set(banco.map((l) => l.metadata.documento))).toEqual(new Set(["doc-parecer"]));
  });
});
