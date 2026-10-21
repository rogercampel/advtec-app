/**
 * Texto por página — ticket 0003.E1 (leitura de processo volumoso).
 *
 * "PDF entra e vira texto com o número da página preservado em cada trecho. Sem
 * isso, nada mais é possível." (spec 0003) Toda afirmação do resumo vai citar
 * página (critério 2) — então a página daqui tem de ser a página DO ARQUIVO.
 *
 * Por que não `extractPdfText` da base (`lib/ai/rag/extractors/pdf.ts`): ela
 * junta as páginas num texto só e PULA as vazias. Para o RAG, tudo bem; aqui,
 * pular a página 3 (uma folha escaneada no meio dos autos) faria a página 4
 * virar "3", e toda citação depois dela apontaria a folha errada.
 *
 * O texto de cada página sai como a base o monta (`hasEOL` do pdf.js, medido na
 * issue #238 do original). Página sem texto não some: vai em `paginasSemTexto`.
 * PDF inteiro sem texto (escaneado, sem camada de texto) é RECUSA com motivo —
 * critério 5 —, nunca um resumo vazio.
 *
 * Memória (critério 1): uma página por vez, com `page.cleanup()` ao fim de cada
 * uma e `destroy()` na tarefa de carregamento. Medido no teste com 400 páginas.
 */
import type * as PdfjsDist from "pdfjs-dist";

import { PdfExtractError } from "@/lib/ai/rag/extractors/pdf";

import type { Pagina } from "./fatiar";

export type LeituraDoPdf = {
  /** Só as páginas com texto, cada uma com o número REAL no arquivo. */
  paginas: Pagina[];
  totalDePaginas: number;
  /** Folhas sem camada de texto (escaneadas no meio dos autos). Nada pode citá-las como lidas. */
  paginasSemTexto: number[];
};

export const MOTIVO_SEM_TEXTO =
  "o PDF não tem camada de texto (provavelmente é digitalização): precisa passar por OCR antes da leitura";

export async function lePaginasDoPdf(buffer: Buffer | Uint8Array): Promise<LeituraDoPdf> {
  let tarefa: PdfjsDist.PDFDocumentLoadingTask | null = null;
  try {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof PdfjsDist;
    tarefa = pdfjs.getDocument({ data: new Uint8Array(buffer) });
    const doc = await tarefa.promise;
    const paginas: Pagina[] = [];
    const paginasSemTexto: number[] = [];
    for (let numero = 1; numero <= doc.numPages; numero++) {
      const page = await doc.getPage(numero);
      const content = await page.getTextContent();
      const texto = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join("")
        .trim();
      page.cleanup();
      if (texto) paginas.push({ numero, texto });
      else paginasSemTexto.push(numero);
    }
    if (paginas.length === 0) throw new PdfExtractError(MOTIVO_SEM_TEXTO, undefined, "sem_texto");
    return { paginas, totalDePaginas: doc.numPages, paginasSemTexto };
  } catch (err) {
    if (err instanceof PdfExtractError) throw err;
    throw new PdfExtractError("não foi possível ler este PDF (corrompido ou protegido)", err, "falha");
  } finally {
    // No pdf.js 6 quem libera o documento (e o worker) é a tarefa de carregamento.
    await tarefa?.destroy().catch(() => undefined);
  }
}
