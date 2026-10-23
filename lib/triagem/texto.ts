/**
 * Texto do cliente para casar padrão — AdvTec, spec 0001.E3.
 *
 * Todo padrão da triagem é escrito em ASCII minúsculo e casa contra a saída
 * desta função. Padrão com acento aqui dentro nunca casa (o mesmo cuidado de
 * `lib/oab/travas.ts`), e `\b` do JavaScript não enxerga vogal acentuada.
 *
 * Diferença para `normalizaParaCasar`: esta guarda o MAPA de volta para o texto
 * original, para devolver o trecho como o cliente escreveu (com acento, caixa
 * e pontuação) — é isso que o advogado lê na ficha.
 */

export type TextoNormalizado = {
  /** Sem acento, minúsculo. Espaços NÃO são colapsados (o mapa seguiria quebrado). */
  texto: string;
  /** `origem[i]` = posição, no texto original, do caractere `i` do normalizado. */
  origem: number[];
  original: string;
};

export function normalizaComMapa(original: string): TextoNormalizado {
  let texto = "";
  const origem: number[] = [];
  let i = 0;
  for (const letra of original) {
    const limpa = letra.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    for (let k = 0; k < limpa.length; k++) origem.push(i);
    texto += limpa;
    i += letra.length;
  }
  return { texto, origem, original };
}

/** O pedaço do texto original que corresponde a [inicio, fim) do normalizado. */
export function trechoOriginal(n: TextoNormalizado, inicio: number, fim: number): string {
  if (fim <= inicio) return "";
  const de = n.origem[inicio] ?? 0;
  const ultimo = n.origem[fim - 1] ?? n.original.length - 1;
  // o último caractere original pode ter mais de uma unidade (emoji): avança até o fim dele
  const ate = ultimo + (String.fromCodePoint(n.original.codePointAt(ultimo) ?? 32).length || 1);
  return n.original.slice(de, ate).replace(/\s+/g, " ").trim();
}

/** Sem acento, minúsculo, só letras e números separados por um espaço. Para nomes. */
export function soAlfanumerico(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
