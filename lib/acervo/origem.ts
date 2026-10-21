/**
 * Origem na resposta — ticket 0002.E4.
 *
 * "A busca devolve o trecho E de qual documento ele veio, com a página. Trecho
 * sem origem não é resposta: é palpite formatado." (spec 0002, mudança 3)
 * Critério 4: "Resposta sem origem é falha, não degradação."
 *
 * A origem já é gravada na ingestão (`paraLinha`, 0002.E1): `metadata.documento`,
 * `metadata.nome`, `metadata.pagina_inicial` e `metadata.pagina_final` em cada
 * pedaço. Este módulo é a porta de SAÍDA: todo trecho que sai da busca do acervo
 * passa por `comOrigem`, e o que não tem os quatro campos não sai — é contado,
 * para virar alarme, e nunca mostrado sem fonte.
 *
 * A busca em si é a da base (`searchKnowledge`, que já filtra por organização).
 */
import type { KnowledgeHit } from "@/lib/agent-engine/agent/search-knowledge";

export type Origem = {
  /** Id do documento no acervo (o `doc.id` da ingestão). */
  documento: string;
  /** Nome do arquivo, como o escritório o conhece. */
  nome: string;
  paginaInicial: number;
  paginaFinal: number;
};

export type TrechoComOrigem = {
  texto: string;
  similaridade: number;
  origem: Origem;
  /** "Contestação.pdf, p. 3" ou "Contestação.pdf, pp. 3–4". */
  citacao: string;
};

export type BuscaComOrigem = {
  trechos: TrechoComOrigem[];
  /** Trechos que vieram do banco sem origem completa e foram retidos. Diferente de 0 é defeito de ingestão. */
  semOrigem: number;
};

const paginaValida = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const textoValido = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** `null` quando falta qualquer peça da origem — e aí o trecho não sai. */
export function origemDoTrecho(metadata: Record<string, unknown> | null | undefined): Origem | null {
  const m = metadata ?? {};
  const { documento, nome, pagina_inicial: de, pagina_final: ate } = m as Record<string, unknown>;
  if (!textoValido(documento) || !textoValido(nome) || !paginaValida(de) || !paginaValida(ate) || ate < de) {
    return null;
  }
  return { documento, nome: nome.trim(), paginaInicial: de, paginaFinal: ate };
}

export function citacao(o: Origem): string {
  return o.paginaInicial === o.paginaFinal
    ? `${o.nome}, p. ${o.paginaInicial}`
    : `${o.nome}, pp. ${o.paginaInicial}–${o.paginaFinal}`;
}

export function comOrigem(hits: Pick<KnowledgeHit, "content" | "similarity" | "metadata">[]): BuscaComOrigem {
  const trechos: TrechoComOrigem[] = [];
  let semOrigem = 0;
  for (const h of hits) {
    const origem = origemDoTrecho(h.metadata);
    if (!origem) {
      semOrigem += 1;
      continue;
    }
    trechos.push({ texto: h.content, similaridade: h.similarity, origem, citacao: citacao(origem) });
  }
  return { trechos, semOrigem };
}
