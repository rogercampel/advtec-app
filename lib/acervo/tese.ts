/**
 * Agrupamento por tese — ticket 0004.E2.
 *
 * "Trechos que sustentam o mesmo argumento vêm juntos, como uma tese só, e não
 * como oito resultados repetidos." (spec 0004) Critério 2: trechos do mesmo
 * argumento aparecem agrupados, não repetidos.
 *
 * ═══ O CRITÉRIO DE "MESMO ARGUMENTO" ═══
 *
 * Em escritório, o mesmo argumento é quase sempre o MESMO PARÁGRAFO reaproveitado
 * de peça em peça, com nome de parte e data trocados. Isso se mede por texto:
 * shingles de 3 palavras e Jaccard sobre a sombra (sem acento, sem pontuação e
 * SEM NÚMEROS, para "R$ 1.000" e "R$ 5.000", ou duas datas, não separarem o
 * mesmo parágrafo). Dois trechos com Jaccard ≥ `SEMELHANCA_MINIMA` caem na mesma tese,
 * de forma transitiva (componente conexa).
 *
 * ponytail: paráfrase com outras palavras NÃO agrupa — isso pede embedding, que
 * é chamada paga e fica para quando houver medição. Agrupar a mais seria pior
 * que agrupar a menos: tese errada esconde trecho.
 *
 * A ordem é a da busca: a tese do trecho mais bem colocado vem primeiro, e
 * dentro dela o representante é o primeiro trecho (o mais relevante).
 */
import type { TrechoDaPeca } from "./busca-por-problema";
import { sombra } from "./metadado";

export const SEMELHANCA_MINIMA = 0.6;
const TAMANHO_DO_SHINGLE = 3;

export type Tese = {
  /** O trecho mais bem colocado da tese — o que a tela mostra. */
  representante: TrechoDaPeca;
  /** Todos, inclusive o representante, na ordem da busca. Cada um com a sua origem. */
  trechos: TrechoDaPeca[];
  /** Processos distintos das peças desta tese (para a E4 contar desfecho). */
  processos: string[];
};

export function shingles(texto: string): Set<string> {
  const palavras = sombra(texto)
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const s = new Set<string>();
  if (palavras.length < TAMANHO_DO_SHINGLE) {
    if (palavras.length) s.add(palavras.join(" "));
    return s;
  }
  for (let i = 0; i + TAMANHO_DO_SHINGLE <= palavras.length; i++) s.add(palavras.slice(i, i + TAMANHO_DO_SHINGLE).join(" "));
  return s;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let comum = 0;
  for (const x of a) if (b.has(x)) comum += 1;
  return comum / (a.size + b.size - comum);
}

export function agrupaPorTese(trechos: TrechoDaPeca[]): Tese[] {
  const sh = trechos.map((t) => shingles(t.texto));
  // União-busca: o grupo de cada trecho, transitivo.
  const pai = trechos.map((_, i) => i);
  const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i]!)));
  // ponytail: O(n²) pares — a busca devolve dezenas de trechos, não milhares.
  for (let i = 0; i < trechos.length; i++) {
    for (let j = i + 1; j < trechos.length; j++) {
      if (jaccard(sh[i]!, sh[j]!) >= SEMELHANCA_MINIMA) {
        const [a, b] = [raiz(i), raiz(j)];
        if (a !== b) pai[Math.max(a, b)] = Math.min(a, b); // a raiz é sempre o mais bem colocado
      }
    }
  }
  const grupos = new Map<number, TrechoDaPeca[]>();
  trechos.forEach((t, i) => grupos.set(raiz(i), [...(grupos.get(raiz(i)) ?? []), t]));
  return [...grupos.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, ts]) => ({
      representante: ts[0]!,
      trechos: ts,
      processos: [...new Set(ts.map((t) => t.processo).filter((p): p is string => p !== null))],
    }));
}
