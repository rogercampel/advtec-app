/**
 * LEITURA DO PAINEL — como o painel lê o banco sem mentir (spec 0001.E5).
 *
 * Três defeitos que a primeira versão tinha, e o que aqui os impede:
 *
 *   1. ERRO VIRAVA ZERO. `const { data } = ...` descartava o `error`; timeout ou
 *      negação de RLS devolvia lista vazia e a tela mostrava "0 de 0" como medido.
 *      Agora toda resposta com `error` (ou sem `data`) é `estado: "erro"`, e quem
 *      calcula trata a etapa como "não medido — erro ao ler", nunca como zero.
 *   2. O FIM DA LEITURA ERA ADIVINHADO. "Página menor que 1000 = acabou" falha
 *      quando o PostgREST da instalação tem `max_rows` menor (a página volta curta
 *      com dados de sobra, e a leitura parava calada). Agora o critério é o
 *      `count` exato do próprio PostgREST (`{ count: "exact" }`): lê-se do ponto
 *      em que parou (`de = linhas já lidas`) até somar o total. Sem `count` na
 *      resposta não há como provar que a leitura está completa: `parcial`.
 *   3. O TETO ESCONDIA O RECENTE. Bater no teto devolve `estado: "parcial"`, e a
 *      etapa afetada vira "não medido" — o número parcial NÃO é mostrado.
 *
 * A ordem é a do chamador e tem de ser TOTAL (`created_at, id`): paginar por
 * `range` sobre uma ordem com empates repete ou pula linha na fronteira. Mesmo
 * assim as linhas são deduplicadas por `id`.
 */

export const TAMANHO_DA_PAGINA = 1000;
/** Acima disto a leitura é `parcial` e a etapa não é medida. */
export const TETO_DE_LINHAS = 10_000;
/** Teto de chamadas por leitura: com `max_rows` minúsculo, não girar para sempre. */
const CHAMADAS_NO_MAXIMO = 200;

export type EstadoDaLeitura = "ok" | "parcial" | "erro";
export type Leitura<T> = { linhas: T[]; estado: EstadoDaLeitura };

export type RespostaDePagina<T> = { data: T[] | null; error?: unknown; count?: number | null };
export type Pagina<T> = (de: number, ate: number) => PromiseLike<RespostaDePagina<T>>;

export const leituraVazia = <T>(): Leitura<T> => ({ linhas: [], estado: "ok" });

export async function lerEmPaginas<T extends { id: string }>(
  pagina: Pagina<T>,
  opcoes: { teto?: number; tamanho?: number } = {},
): Promise<Leitura<T>> {
  const teto = opcoes.teto ?? TETO_DE_LINHAS;
  const tamanho = opcoes.tamanho ?? TAMANHO_DA_PAGINA;
  const porId = new Map<string, T>();
  let lidas = 0;
  let total: number | null = null;

  for (let chamada = 0; chamada < CHAMADAS_NO_MAXIMO; chamada += 1) {
    let r: RespostaDePagina<T>;
    try {
      r = await pagina(lidas, lidas + tamanho - 1);
    } catch {
      return { linhas: [], estado: "erro" };
    }
    if (r.error || r.data === null || r.data === undefined) return { linhas: [], estado: "erro" };
    if (typeof r.count === "number") total = r.count;

    for (const linha of r.data) porId.set(linha.id, linha);
    lidas += r.data.length;

    if (total === null) return { linhas: [...porId.values()], estado: "parcial" }; // sem count não se prova que acabou
    if (total > teto) return { linhas: [...porId.values()], estado: "parcial" };
    if (lidas >= total || r.data.length === 0) return { linhas: [...porId.values()], estado: "ok" };
  }
  return { linhas: [...porId.values()], estado: "parcial" };
}

const GRAVIDADE: Record<EstadoDaLeitura, number> = { ok: 0, parcial: 1, erro: 2 };
export const piorEstado = (...estados: EstadoDaLeitura[]): EstadoDaLeitura =>
  estados.reduce<EstadoDaLeitura>((a, b) => (GRAVIDADE[b] > GRAVIDADE[a] ? b : a), "ok");

/**
 * Lê por lotes de ids (`in (...)` não aguenta milhares de ids na URL). O estado é o pior de todos os lotes;
 * erro em um lote derruba a leitura inteira (metade de um número é palpite).
 */
export async function lerPorLotes<T extends { id: string }>(
  ids: readonly string[],
  tamanhoDoLote: number,
  ler: (lote: string[]) => Promise<Leitura<T>>,
): Promise<Leitura<T>> {
  const unicos = [...new Set(ids)];
  const porId = new Map<string, T>();
  let estado: EstadoDaLeitura = "ok";
  for (let i = 0; i < unicos.length; i += tamanhoDoLote) {
    const r = await ler(unicos.slice(i, i + tamanhoDoLote));
    estado = piorEstado(estado, r.estado);
    if (r.estado === "erro") return { linhas: [], estado: "erro" };
    for (const linha of r.linhas) porId.set(linha.id, linha);
    // o teto vale para a soma dos lotes, não só para cada um
    if (porId.size > TETO_DE_LINHAS) return { linhas: [...porId.values()], estado: "parcial" };
  }
  return { linhas: [...porId.values()], estado };
}
