/**
 * Amarração da peça com o processo — ticket 0004.E3.
 *
 * "Extrair número de processo das peças do acervo." É o que deixa a 0004.E4
 * cruzar a tese com o desfecho no DataJud ("você já usou isso em 7 casos, e 5
 * terminaram procedentes").
 *
 * ═══ AS DUAS REGRAS QUE FALHAM FECHADO ═══
 *
 * 1. Só número com DÍGITO VERIFICADOR certo (Res. CNJ 65/2008): `DD = 98 −
 *    (NNNNNNN·AAAA·J·TR·OOOO·00 mod 97)`. Medido em 20/10/2026: 50 de 50
 *    números reais do DJEN passam (`.context/MEDIDO.md`). Número com DV errado é
 *    erro de digitação ou outro tipo de número — amarrar com ele seria pôr o
 *    desfecho de um processo alheio na tese do escritório.
 * 2. Peça cita OUTROS processos (precedentes, conexos). O da peça é o que está
 *    no CABEÇALHO da primeira página com texto. Fora dele, só vale se for o ÚNICO
 *    número válido do documento inteiro. Dois candidatos e nenhum no cabeçalho →
 *    `null`: sem processo, a peça não entra em estatística de desfecho, e o
 *    advogado pode corrigir.
 */
import type { Pagina } from "./fatiar";
import { ZONA_DO_CABECALHO } from "./metadado";

export type ProcessoDaPeca = {
  /** Formatado: NNNNNNN-DD.AAAA.J.TR.OOOO. */
  numero: string;
  pagina: number;
  /** Trecho em volta, para o advogado conferir de onde saiu. */
  trecho: string;
  onde: "cabecalho" | "unico_no_documento";
};

/** Com ou sem pontuação, com espaço ou não entre os blocos. */
const CANDIDATO = /\b(\d{7})\s?-?\s?(\d{2})\s?\.?\s?(\d{4})\s?\.?\s?(\d)\s?\.?\s?(\d{2})\s?\.?\s?(\d{4})\b/g;

export function digitoVerificadorOk(digitos: string): boolean {
  if (!/^\d{20}$/.test(digitos)) return false;
  const esperado = 98 - Number(BigInt(digitos.slice(0, 7) + digitos.slice(9) + "00") % 97n);
  return digitos.slice(7, 9) === String(esperado).padStart(2, "0");
}

export function formata(d: string): string {
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

type Achado = { digitos: string; pagina: number; indice: number; texto: string };

function achados(paginas: Pagina[]): Achado[] {
  const saida: Achado[] = [];
  for (const p of paginas) {
    for (const m of p.texto.matchAll(CANDIDATO)) {
      const digitos = m.slice(1, 7).join("");
      if (digitoVerificadorOk(digitos)) saida.push({ digitos, pagina: p.numero, indice: m.index, texto: p.texto });
    }
  }
  return saida;
}

const trechoEmVolta = (a: Achado) => a.texto.slice(Math.max(0, a.indice - 40), a.indice + 25 + 40).trim();

export function processoDaPeca(paginas: Pagina[]): ProcessoDaPeca | null {
  const todos = achados(paginas);
  if (todos.length === 0) return null;

  const primeira = paginas.find((p) => p.texto.trim() !== "");
  const noCabecalho = todos.find((a) => a.pagina === primeira?.numero && a.indice < ZONA_DO_CABECALHO);
  if (noCabecalho) {
    return { numero: formata(noCabecalho.digitos), pagina: noCabecalho.pagina, trecho: trechoEmVolta(noCabecalho), onde: "cabecalho" };
  }

  const distintos = new Set(todos.map((a) => a.digitos));
  if (distintos.size === 1) {
    const a = todos[0]!;
    return { numero: formata(a.digitos), pagina: a.pagina, trecho: trechoEmVolta(a), onde: "unico_no_documento" };
  }
  return null;
}
