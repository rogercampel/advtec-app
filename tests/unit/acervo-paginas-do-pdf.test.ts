import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MOTIVO_SEM_TEXTO, lePaginasDoPdf } from "@/lib/acervo/paginas-do-pdf";

/**
 * Ticket 0003.E1 — texto por página, com o número REAL da página.
 *
 * Critério 1: 400 páginas sem estourar memória nem passar de 10 minutos.
 * Critério 5: PDF sem camada de texto → recusa com motivo, não resumo vazio.
 * E a regra que a E1 inteira existe para proteger: folha sem texto no MEIO dos
 * autos não desloca a numeração das seguintes.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - numerar pela posição em `paginas` (como a base faz ao pular vazias);
 *   - não registrar `paginasSemTexto`;
 *   - devolver leitura vazia em vez de recusar o escaneado.
 */

/**
 * PDF mínimo escrito à mão: uma página por item; `null` = página sem texto
 * (o que uma folha escaneada é, para o pdf.js). Sem dependência nova.
 */
function pdf(paginas: Array<string | null>): Buffer {
  const objs: string[] = [];
  const add = (s: string) => objs.push(s) - 1 + 1; // número do objeto (1-based)
  const catalogo = add("");
  const raiz = add("");
  const fonte = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  for (const texto of paginas) {
    const stream = texto === null ? "" : `BT /F1 12 Tf 72 720 Td (${texto.replace(/[()\\]/g, "")}) Tj ET`;
    const conteudo = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(`<< /Type /Page /Parent ${raiz} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fonte} 0 R >> >> /Contents ${conteudo} 0 R >>`),
    );
  }
  objs[catalogo - 1] = `<< /Type /Catalog /Pages ${raiz} 0 R >>`;
  objs[raiz - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let corpo = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(corpo.length);
    corpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = corpo.length;
  corpo += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) corpo += `${String(off).padStart(10, "0")} 00000 n \n`;
  corpo += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corpo, "latin1");
}

describe("a página é a do arquivo", () => {
  it("folha sem texto no meio não desloca a numeração das seguintes", async () => {
    const r = await lePaginasDoPdf(pdf(["Peticao inicial", "Procuracao", null, "Contestacao"]));
    expect(r.totalDePaginas).toBe(4);
    expect(r.paginasSemTexto).toEqual([3]);
    expect(r.paginas).toEqual([
      { numero: 1, texto: "Peticao inicial" },
      { numero: 2, texto: "Procuracao" },
      { numero: 4, texto: "Contestacao" },
    ]);
  });

  it("PDF real de várias páginas do original (fixture da base)", async () => {
    const r = await lePaginasDoPdf(readFileSync("tests/fixtures/sample-multipagina.pdf"));
    expect(r.totalDePaginas).toBeGreaterThan(1);
    expect(r.paginas.map((p) => p.numero)).toEqual([...r.paginas.map((p) => p.numero)].sort((a, b) => a - b));
    for (const p of r.paginas) expect(p.texto.length).toBeGreaterThan(0);
  });
});

describe("critério 5: escaneado sem camada de texto é recusa com motivo", () => {
  it("todas as páginas sem texto", async () => {
    await expect(lePaginasDoPdf(pdf([null, null]))).rejects.toMatchObject({ motivo: "sem_texto", message: MOTIVO_SEM_TEXTO });
  });

  it("a fixture sem texto da base também", async () => {
    await expect(lePaginasDoPdf(readFileSync("tests/fixtures/sample-sem-texto.pdf"))).rejects.toMatchObject({ motivo: "sem_texto" });
  });

  it("corrompido é falha com motivo, não exceção crua", async () => {
    await expect(lePaginasDoPdf(readFileSync("tests/fixtures/sample-corrompido.pdf"))).rejects.toMatchObject({ motivo: "falha" });
  });
});

describe("critério 1: processo volumoso", () => {
  it("400 páginas: todas lidas, numeradas, em bem menos de 10 minutos e sem estourar a memória", async () => {
    const paginas = Array.from({ length: 400 }, (_, i) => `Folha ${i + 1} dos autos`);
    const antes = process.memoryUsage().heapUsed;
    const inicio = Date.now();
    const r = await lePaginasDoPdf(pdf(paginas));
    const ms = Date.now() - inicio;
    const crescimentoMb = (process.memoryUsage().heapUsed - antes) / 1024 / 1024;
    expect(r.totalDePaginas).toBe(400);
    expect(r.paginas).toHaveLength(400);
    expect(r.paginas[399]).toEqual({ numero: 400, texto: "Folha 400 dos autos" });
    expect(ms).toBeLessThan(600_000);
    expect(crescimentoMb).toBeLessThan(300);
  }, 600_000);
});
