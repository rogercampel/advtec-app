import { describe, expect, it } from "vitest";

import { digitoVerificadorOk, formata, processoDaPeca } from "@/lib/acervo/processo-da-peca";

/**
 * Ticket 0004.E3 — amarração da peça com o processo.
 *
 * Os três números reais abaixo vieram do DJEN (TJSP, 19/10/2026), na medição que
 * conferiu o algoritmo do dígito verificador: 50 de 50 passaram
 * (`.context/MEDIDO.md`). Número de processo é público.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - aceitar qualquer DV (tirar a conferência);
 *   - escolher o PRIMEIRO número válido do documento, ignorando o cabeçalho;
 *   - escolher o primeiro quando há dois candidatos fora do cabeçalho (em vez de `null`).
 */

const REAIS = ["1002288-81.2025.8.26.0565", "0000939-36.2024.8.26.0358", "0006889-43.2023.8.26.0590"];
const so = (n: string) => n.replace(/\D/g, "");
const pag = (numero: number, texto: string) => ({ numero, texto });

describe("dígito verificador (Res. CNJ 65/2008)", () => {
  it.each(REAIS)("%s, real, passa", (n) => expect(digitoVerificadorOk(so(n))).toBe(true));

  it("o mesmo número com o DV trocado não passa", () => {
    expect(digitoVerificadorOk(so("1002288-82.2025.8.26.0565"))).toBe(false);
  });

  it("os números inventados das fixtures do projeto não passam — e é bom que não passem", () => {
    expect(digitoVerificadorOk(so("0001234-56.2026.8.26.0100"))).toBe(false);
  });

  it("formata os 20 dígitos", () => expect(formata(so(REAIS[0]!))).toBe(REAIS[0]));
});

describe("o processo da peça", () => {
  it("o do cabeçalho vence o precedente citado no corpo", () => {
    const r = processoDaPeca([
      pag(1, `EXCELENTÍSSIMO SENHOR JUIZ DA 2ª VARA CÍVEL\nProcesso nº ${REAIS[0]}\nCONTESTAÇÃO`),
      pag(2, `Conforme decidido nos autos ${REAIS[1]}, a pretensão está prescrita.`),
    ]);
    expect(r).toMatchObject({ numero: REAIS[0], pagina: 1, onde: "cabecalho" });
    expect(r?.trecho).toContain("Processo nº");
  });

  it("sem pontuação, ou com espaço, também casa", () => {
    expect(processoDaPeca([pag(1, `Autos ${so(REAIS[2]!)}`)])?.numero).toBe(REAIS[2]);
    expect(processoDaPeca([pag(1, "Autos 0000939 - 36 . 2024 . 8 . 26 . 0358")])?.numero).toBe(REAIS[1]);
  });

  it("fora do cabeçalho, vale se for o único número válido do documento", () => {
    const r = processoDaPeca([pag(1, "CONTRATO DE HONORÁRIOS"), pag(3, `referente aos autos ${REAIS[1]}`)]);
    expect(r).toMatchObject({ numero: REAIS[1], pagina: 3, onde: "unico_no_documento" });
  });

  it("dois candidatos e nenhum no cabeçalho: null — não se adivinha", () => {
    const longe = "x".repeat(1600);
    expect(processoDaPeca([pag(1, `${longe} ${REAIS[0]} e ${REAIS[1]}`)])).toBeNull();
  });

  it("número com DV errado não amarra, nem como único", () => {
    expect(processoDaPeca([pag(1, "Processo nº 1002288-82.2025.8.26.0565")])).toBeNull();
  });

  it("parte de um número mais longo (código de barras) não casa", () => {
    expect(processoDaPeca([pag(1, `boleto 9${so(REAIS[0]!)}7`)])).toBeNull();
  });

  it("peça sem número nenhum: null", () => {
    expect(processoDaPeca([pag(1, "PARECER sobre a cláusula de não concorrência")])).toBeNull();
  });
});

describe("a ingestão grava o processo em cada pedaço", () => {
  it("metadata.processo vem preenchido quando dá para amarrar, e null quando não", async () => {
    const { ingere, DIMENSAO_CONTRATO } = await import("@/lib/acervo/ingerir");
    const gravadas: Array<{ metadata: Record<string, unknown> }> = [];
    const paginas: Record<string, Array<{ numero: number; texto: string }>> = {
      com: [pag(1, `Processo nº ${REAIS[0]}\nCONTESTAÇÃO. ${"O autor não comprovou o dano. ".repeat(20)}`)],
      sem: [pag(1, `PARECER. ${"Sobre a cláusula de não concorrência. ".repeat(20)}`)],
    };
    await ingere("org", "src", "v1", [{ id: "com", nome: "com.pdf" }, { id: "sem", nome: "sem.pdf" }], {
      extrair: async (doc) => paginas[doc.id]!,
      embedar: async (textos) => textos.map(() => Array(DIMENSAO_CONTRATO).fill(0.01)),
      cliente: {
        hashesExistentes: async () => new Set(),
        proximaPosicao: async () => 0,
        inserirChunks: async (linhas) => {
          gravadas.push(...linhas);
          return { inseridos: linhas.length };
        },
      },
    });
    const porDoc = (id: string) => gravadas.filter((l) => l.metadata.documento === id).map((l) => l.metadata.processo);
    expect(porDoc("com").length).toBeGreaterThan(0);
    expect(new Set(porDoc("com"))).toEqual(new Set([REAIS[0]]));
    expect(new Set(porDoc("sem"))).toEqual(new Set([null]));
  });
});
