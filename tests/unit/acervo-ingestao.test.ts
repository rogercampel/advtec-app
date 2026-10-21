import { describe, expect, it } from "vitest";

import { ALVO_CARACTERES, fatia, hashDoTexto, normaliza } from "@/lib/acervo/fatiar";
import {
  DIMENSAO_CONTRATO,
  estimaTokens,
  ingere,
  paraLinha,
  type ClienteAcervo,
  type Documento,
  type LinhaChunk,
} from "@/lib/acervo/ingerir";

/**
 * Ticket 0002.E1 — um PDF entra, vira pedaços com embedding, e a busca acha.
 *
 * Três garantias, e cada uma existe por um defeito que ela evita:
 *
 *  1. **A página não se perde.** A spec 0002 (critério 4) exige documento e
 *     página em toda resposta, e a 0005 recusa citação sem origem. Se a página
 *     morre no fatiador, nenhuma etapa adiante reconstrói.
 *
 *  2. **O mesmo arquivo não duplica** (critério 2). O hash é do texto
 *     NORMALIZADO — senão o mesmo PDF com quebra de linha diferente entra de
 *     novo, e a deduplicação não vale nada.
 *
 *  3. **Dimensão errada falha alto.** Vetor de tamanho diferente de 1536 entra
 *     no banco sem erro e degrada a busca em SILÊNCIO. É o pior defeito
 *     possível aqui, porque não aparece em lugar nenhum.
 *
 * MUTAÇÃO (18/08/2026), feita e conferida:
 *
 *  - removida a normalização de `hashDoTexto` → vermelho em **"hash é do texto
 *    NORMALIZADO"**. O teste "quebra de linha diferente não gera pedaço novo"
 *    continuou verde, porque `fatia()` já normaliza as páginas antes de hashear
 *    — ou seja, a proteção tem duas camadas e só a de baixo é coberta por
 *    aquele teste. Anotado porque a suposição inicial estava errada.
 *  - removida a checagem de dimensão de `paraLinha` → vermelho em **"vetor de
 *    768 é recusado"**.
 */

const PAGINAS = [
  { numero: 1, texto: "Trata-se de reclamação trabalhista ajuizada em face da empresa." },
  { numero: 2, texto: "O reclamante pretende o reconhecimento de vínculo de emprego." },
];

const DOC: Documento = { id: "doc-1", nome: "inicial-trabalhista.pdf" };

function vetor(n = DIMENSAO_CONTRATO): number[] {
  return Array.from({ length: n }, (_, i) => (i % 7) / 10);
}

function acervoEmMemoria(existentes: string[] = []) {
  const banco: LinhaChunk[] = [];
  const jaTem = new Set(existentes);
  const cliente: ClienteAcervo = {
    // Filtra por VERSÃO, como o banco. A primeira versão deste fake devolvia o
    // conjunto inteiro e fazia a versão nova nascer "já existente" — o fake
    // mentia, e o teste que o pegou foi o de numeração independente.
    async hashesExistentes(_organizationId, kbVersionId) {
      return new Set(
        banco.filter((l) => l.kb_version_id === kbVersionId).map((l) => l.content_hash),
      );
    },
    // Como no banco: a próxima posição livre sai do que já está gravado, e não
    // de um contador que reinicia a cada chamada.
    async proximaPosicao(sourceId, kbVersionId) {
      const usadas = banco
        .filter((l) => l.knowledge_source_id === sourceId && l.kb_version_id === kbVersionId)
        .map((l) => l.position);
      return usadas.length ? Math.max(...usadas) + 1 : 0;
    },
    async inserirChunks(linhas) {
      banco.push(...linhas);
      for (const l of linhas) jaTem.add(l.content_hash);
      return { inseridos: linhas.length };
    },
  };
  return { banco, cliente };
}

const deps = (o: Partial<Parameters<typeof ingere>[4]> = {}) => ({
  extrair: async () => PAGINAS,
  embedar: async (textos: string[]) => textos.map(() => vetor()),
  cliente: acervoEmMemoria().cliente,
  ...o,
});

describe("a página não se perde no fatiador", () => {
  it("cada pedaço declara a faixa de páginas que atravessa", () => {
    const pedacos = fatia(PAGINAS, { alvo: 60, sobreposicao: 10 });
    expect(pedacos.length).toBeGreaterThan(1);
    for (const p of pedacos) {
      expect(p.paginaInicial).toBeGreaterThanOrEqual(1);
      expect(p.paginaFinal).toBeGreaterThanOrEqual(p.paginaInicial);
    }
  });

  it("um pedaço que cruza a virada de página registra as duas", () => {
    const pedacos = fatia(PAGINAS, { alvo: ALVO_CARACTERES });
    const cruzou = pedacos.find((p) => p.paginaFinal > p.paginaInicial);
    expect(cruzou).toBeDefined();
  });

  it("a página chega ao metadata da linha, que é o que a busca devolve", () => {
    const p = fatia(PAGINAS)[0]!;
    const l = paraLinha(p, vetor(), DOC, "org-1", "src-1", "v1", 0);
    expect(l.metadata.pagina_inicial).toBe(1);
    expect(l.metadata.nome).toBe("inicial-trabalhista.pdf");
  });
});

describe("o mesmo arquivo não duplica", () => {
  it("hash é do texto NORMALIZADO — espaço e quebra de linha não contam", () => {
    expect(hashDoTexto("dano   moral\n\ncomprovado")).toBe(hashDoTexto("dano moral comprovado"));
    expect(normaliza("  a \n b  ")).toBe("a b");
  });

  it("ingerir duas vezes não cria pedaço novo", async () => {
    const { banco, cliente } = acervoEmMemoria();
    const d = deps({ cliente });

    const um = await ingere("org-1", "src-1", "v1", [DOC], d);
    expect(um.pedacosNovos).toBeGreaterThan(0);
    const total = banco.length;

    const dois = await ingere("org-1", "src-1", "v1", [DOC], d);
    expect(dois.pedacosNovos).toBe(0);
    expect(dois.pedacosJaExistentes).toBeGreaterThan(0);
    expect(banco.length).toBe(total);
  });

  it("quebra de linha diferente não gera pedaço novo", async () => {
    const { banco, cliente } = acervoEmMemoria();
    await ingere("org-1", "src-1", "v1", [DOC], deps({ cliente }));
    const antes = banco.length;

    await ingere("org-1", "src-1", "v1", [DOC], deps({
      cliente,
      extrair: async () => PAGINAS.map((p) => ({ ...p, texto: p.texto.replace(/ /g, "\n  ") })),
    }));
    expect(banco.length).toBe(antes);
  });

  it("trecho repetido dentro do MESMO lote entra uma vez só", async () => {
    const { banco, cliente } = acervoEmMemoria();
    const gemeo: Documento = { id: "doc-2", nome: "copia.pdf" };
    await ingere("org-1", "src-1", "v1", [DOC, gemeo], deps({ cliente }));
    const hashes = banco.map((l) => l.content_hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("dimensão errada falha alto, não em silêncio", () => {
  it("vetor de 768 é recusado", () => {
    const p = fatia(PAGINAS)[0]!;
    expect(() => paraLinha(p, vetor(768), DOC, "org-1", "src-1", "v1", 0)).toThrow(/1536/);
  });

  it("1536 passa — é o pin de contrato do CRM", () => {
    const p = fatia(PAGINAS)[0]!;
    expect(paraLinha(p, vetor(), DOC, "org-1", "src-1", "v1", 0).embedding).toHaveLength(1536);
  });
});

describe("falha aparece, não some", () => {
  it("PDF sem camada de texto é recusado com o motivo", async () => {
    const { banco, cliente } = acervoEmMemoria();
    const r = await ingere("org-1", "src-1", "v1", [DOC], deps({
      cliente,
      extrair: async () => [{ numero: 1, texto: "   " }],
    }));
    expect(banco).toHaveLength(0);
    expect(r.falhas[0]!.motivo).toContain("sem camada de texto");
  });

  it("documento corrompido não derruba o lote — os outros entram", async () => {
    const { banco, cliente } = acervoEmMemoria();
    const ruim: Documento = { id: "ruim", nome: "corrompido.pdf" };
    const r = await ingere("org-1", "src-1", "v1", [ruim, DOC], deps({
      cliente,
      extrair: async (d) => {
        if (d.id === "ruim") throw new Error("PDF ilegível");
        return PAGINAS;
      },
    }));
    expect(r.falhas).toHaveLength(1);
    expect(banco.length).toBeGreaterThan(0);
  });

  it("embedding que falha vira falha contada, não pedaço perdido em silêncio", async () => {
    const { banco, cliente } = acervoEmMemoria();
    const r = await ingere("org-1", "src-1", "v1", [DOC], deps({
      cliente,
      embedar: async () => {
        throw new Error("429 rate limit");
      },
    }));
    expect(banco).toHaveLength(0);
    expect(r.falhas[0]!.motivo).toContain("429");
  });

  it("embedding com quantidade errada de vetores é recusado", async () => {
    // A peça precisa ser longa o bastante para virar VÁRIOS pedaços — senão
    // devolver um vetor está certo e o desencontro nunca acontece. A primeira
    // versão deste teste usava a fixture curta e reprovava o código por engano.
    const longo = Array.from({ length: 6 }, (_, i) => ({
      numero: i + 1,
      texto: `Página ${i + 1}. ` + "Do vínculo de emprego e das horas extras. ".repeat(60),
    }));
    const { banco, cliente } = acervoEmMemoria();
    const r = await ingere("org-1", "src-1", "v1", [DOC], deps({
      cliente,
      extrair: async () => longo,
      embedar: async () => [vetor()],
    }));
    expect(banco).toHaveLength(0);
    expect(r.falhas[0]!.motivo).toMatch(/vetores para/);
  });
});

describe("orçamento", () => {
  it("estima tokens para o teto de gasto poder avisar antes", () => {
    expect(estimaTokens("a".repeat(4000))).toBe(1000);
    expect(estimaTokens("")).toBe(1);
  });
});

/**
 * `ai_chunks` tem `unique (knowledge_source_id, kb_version_id, position)`.
 *
 * `Pedaco.posicao` reinicia em zero a cada documento. Dois PDFs na mesma leva
 * davam `0,1,2` e `0,1,2`, e a colisão derruba o INSERT INTEIRO — não a linha.
 * Nenhum dos 14 testes anteriores podia ver isso: o cliente falso era um array
 * com `push`, e array não tem constraint. Achado por revisor sem contexto.
 */
describe("a posição não colide", () => {
  const longo = (marca: string, paginas = 4) =>
    Array.from({ length: paginas }, (_, i) => ({
      numero: i + 1,
      texto: `${marca} página ${i + 1}. ` + "Do vínculo de emprego e das horas extras. ".repeat(60),
    }));

  it("dois documentos no MESMO lote não repetem posição", async () => {
    const { banco, cliente } = acervoEmMemoria();
    const a: Documento = { id: "a", nome: "a.pdf" };
    const b: Documento = { id: "b", nome: "b.pdf" };
    await ingere("org-1", "src-1", "v1", [a, b], {
      cliente,
      extrair: async (d) => longo(d.id),
      embedar: async (t) => t.map(() => vetor()),
    });
    const pos = banco.map((l) => l.position);
    expect(pos.length).toBeGreaterThan(2);
    expect(new Set(pos).size).toBe(pos.length);
  });

  it("a segunda ingestão CONTINUA a numeração, não recomeça", async () => {
    const { banco, cliente } = acervoEmMemoria();
    const d = { cliente, embedar: async (t: string[]) => t.map(() => vetor()) };
    await ingere("org-1", "src-1", "v1", [{ id: "a", nome: "a.pdf" }], {
      ...d,
      extrair: async () => longo("primeiro"),
    });
    const ate = Math.max(...banco.map((l) => l.position));
    await ingere("org-1", "src-1", "v1", [{ id: "b", nome: "b.pdf" }], {
      ...d,
      extrair: async () => longo("segundo"),
    });
    const depois = banco.filter((l) => l.position > ate);
    expect(depois.length).toBeGreaterThan(0);
    expect(new Set(banco.map((l) => l.position)).size).toBe(banco.length);
  });

  it("versões diferentes numeram de forma independente", async () => {
    const { cliente } = acervoEmMemoria();
    const d = {
      cliente,
      extrair: async () => longo("x"),
      embedar: async (t: string[]) => t.map(() => vetor()),
    };
    await ingere("org-1", "src-1", "v1", [{ id: "a", nome: "a.pdf" }], d);
    const r = await ingere("org-1", "src-1", "v2", [{ id: "b", nome: "b.pdf" }], d);
    expect(r.pedacosNovos).toBeGreaterThan(0);
  });
});

/**
 * A página tem de sobreviver ao fatiador — critério 4 da spec 0002, e base da
 * 0005, que recusa citação sem origem.
 *
 * Os três testes originais de página passavam com `paginaInicial` cravado em 1:
 * a fixture curta virava UM pedaço só, e um pedaço só sempre começa na página
 * 1. Eram enfeite verde. Aqui o documento é longo o bastante para o segundo
 * pedaço começar depois da virada.
 */
describe("a página sobrevive de verdade, e não por acidente de fixture", () => {
  it("existe pedaço que COMEÇA numa página diferente da primeira", () => {
    const paginas = Array.from({ length: 5 }, (_, i) => ({
      numero: i + 1,
      texto: `Página ${i + 1}. ` + "Do reconhecimento de vínculo empregatício. ".repeat(50),
    }));
    const pedacos = fatia(paginas);
    const iniciais = new Set(pedacos.map((p) => p.paginaInicial));
    // Cravar `paginaInicial` em 1 deixa este conjunto com um elemento só.
    expect(iniciais.size).toBeGreaterThan(1);
    expect(Math.max(...pedacos.map((p) => p.paginaFinal))).toBeGreaterThan(1);
  });
});

/**
 * Falha de embedding não pode fazer conteúdo sumir calado.
 *
 * Se os hashes do documento que falhou ficassem no lote, um documento seguinte
 * com o mesmo conteúdo — peça modelo copiada, que é o caso normal num
 * escritório — cairia em "já existente", sairia sem falha registrada, e não
 * seria indexado. O acervo ficaria com um buraco que ninguém vê.
 */
describe("falha não engole o documento seguinte", () => {
  it("documento igual ao que falhou no embedding AINDA entra", async () => {
    const { banco, cliente } = acervoEmMemoria();
    let primeira = true;
    const r = await ingere(
      "org-1",
      "src-1",
      "v1",
      [
        { id: "modelo", nome: "modelo.pdf" },
        { id: "copia", nome: "copia.pdf" },
      ],
      {
        cliente,
        extrair: async () => PAGINAS,
        embedar: async (t) => {
          if (primeira) {
            primeira = false;
            throw new Error("429 rate limit");
          }
          return t.map(() => vetor());
        },
      },
    );
    expect(r.falhas).toHaveLength(1);
    expect(banco.length).toBeGreaterThan(0);
  });

  it("erro na gravação vira falha contada, não exceção que leva a lista junto", async () => {
    const cliente: ClienteAcervo = {
      async hashesExistentes() {
        return new Set<string>();
      },
      async proximaPosicao() {
        return 0;
      },
      async inserirChunks() {
        throw new Error("deadlock detected");
      },
    };
    const r = await ingere("org-1", "src-1", "v1", [DOC], {
      cliente,
      extrair: async () => PAGINAS,
      embedar: async (t) => t.map(() => vetor()),
    });
    expect(r.pedacosNovos).toBe(0);
    expect(r.falhas.some((f) => f.motivo.includes("deadlock"))).toBe(true);
  });
});
