/**
 * Cliente do DataJud (API pública do CNJ).
 *
 * É um Elasticsearch. Medido em 18/08/2026 — ver `docs/advtec/FONTES-DE-DADOS.md`:
 *
 *   POST /api_publica_tjsp/_search  sem chave  ->  401
 *   POST /api_publica_tjsp/_search  com chave  ->  200, agregação funcionando
 *
 * A chave é **pública** e está publicada na documentação do próprio CNJ
 * (`datajud-wiki.cnj.jus.br/api-publica/acesso/`). Não é segredo, mas fica em
 * variável de ambiente porque pode rodar — e chave rotacionada dentro do código
 * vira deploy de emergência.
 *
 * Este módulo não interpreta nada. Não decide desfecho (E3), não calcula tempo
 * (E4) e não descarta data absurda (E2). Ele consulta e normaliza.
 */

const BASE_PADRAO = "https://api-publica.datajud.cnj.jus.br";

export type Recorte = {
  tribunal: string;
  classeCodigo?: number | null;
  assuntoCodigo?: number | null;
  orgaoJulgadorCodigo?: number | null;
  /** Teto de processos por coleta. O índice tem dezenas de milhões. */
  tamanho?: number;
};

export type ProcessoBruto = {
  id?: string;
  tribunal?: string;
  grau?: string;
  numeroProcesso?: string;
  dataAjuizamento?: string;
  nivelSigilo?: number;
  orgaoJulgador?: { codigo?: number; nome?: string } | null;
  classe?: { codigo?: number; nome?: string } | null;
  assuntos?: unknown[];
  movimentos?: unknown[];
  [k: string]: unknown;
};

export type Processo = {
  datajudId: string;
  tribunal: string;
  numeroProcesso: string | null;
  grau: string | null;
  dataAjuizamento: string | null;
  /** A string exata do CNJ, para a suposição de fuso poder ser corrigida sem recoletar. */
  dataAjuizamentoBruto: string | null;
  nivelSigilo: number | null;
  orgaoJulgadorCodigo: number | null;
  orgaoJulgadorNome: string | null;
  classeCodigo: number | null;
  classeNome: string | null;
  assuntos: unknown[];
  movimentos: unknown[];
};

export class DataJudIndisponivel extends Error {
  constructor(readonly causa: unknown) {
    super(`DataJud indisponível: ${causa instanceof Error ? causa.message : String(causa)}`);
    this.name = "DataJudIndisponivel";
  }
}

/**
 * A consulta é devolvida para ser GUARDADA junto do resultado. Sem isso, o
 * número não é conferível depois — e a base do CNJ muda todo dia.
 */
export function montaConsulta(r: Recorte): Record<string, unknown> {
  const filtros: Array<Record<string, unknown>> = [];
  if (r.classeCodigo != null) filtros.push({ term: { "classe.codigo": r.classeCodigo } });
  if (r.assuntoCodigo != null) filtros.push({ term: { "assuntos.codigo": r.assuntoCodigo } });
  if (r.orgaoJulgadorCodigo != null)
    filtros.push({ term: { "orgaoJulgador.codigo": r.orgaoJulgadorCodigo } });

  return {
    size: r.tamanho ?? 500,
    query: filtros.length ? { bool: { filter: filtros } } : { match_all: {} },
    sort: [{ dataAjuizamento: { order: "desc" } }],
  };
}

/**
 * O DataJud NÃO devolve ISO 8601 no `_source`. Medido contra a API real em
 * 18/08/2026, TJSP:
 *
 *     dataAjuizamento: "20260629120145"    // YYYYMMDDHHMMSS
 *
 * A fixture deste repositório usava ISO e os testes passavam — a coluna do banco
 * é `timestamptz`, e essa string quebraria o insert na primeira coleta real.
 *
 * ⚠️ **O formato do CNJ não declara fuso.** Interpretamos como UTC porque a
 * coluna é `timestamptz` e alguma decisão precisa ser tomada; a suposição NÃO
 * foi confirmada com o CNJ. Se estiver errada, são 3 horas em toda data. Por
 * isso a string original é guardada em `data_ajuizamento_bruto`: corrigir passa
 * a ser um `update`, e não uma recoleta.
 *
 * A faixa é validada. A versão anterior devolvia a string crua quando não
 * reconhecia o formato, e "20261345999999" virava "2026-13-45T99:99:99.000Z" —
 * que o Postgres recusa, derrubando o INSERT DO LOTE INTEIRO por causa de uma
 * linha. Data que não dá para interpretar vira `null`; o bruto continua lá, e o
 * defeito aparece no dado em vez de derrubar a coleta.
 */
export function paraIso(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  const t = String(bruto).trim();

  const compacto = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/.exec(t);
  if (compacto) {
    const [, a, m, d, h = "00", mi = "00", se = "00"] = compacto;
    // `string | undefined` porque o TS não sabe que os grupos 1-3 do regex são
    // obrigatórios. `?? ""` vira NaN, e NaN reprova toda comparação de faixa —
    // que é o lado seguro.
    const n = (x: string | undefined) => Number(x ?? "");
    const faixaOk =
      n(m) >= 1 && n(m) <= 12 &&
      n(d) >= 1 && n(d) <= 31 &&
      n(h) <= 23 && n(mi) <= 59 && n(se) <= 59;
    if (!faixaOk) return null;
    return `${a}-${m}-${d}T${h}:${mi}:${se}.000Z`;
  }

  // ISO já válido passa; qualquer outra coisa vira null em vez de veneno.
  return Number.isNaN(Date.parse(t)) ? null : t;
}

export function normaliza(hit: { _id?: string; _source?: ProcessoBruto }): Processo | null {
  const s = hit._source;
  const id = hit._id ?? (typeof s?.id === "string" ? s.id : null);
  if (!s || !id) return null;

  return {
    datajudId: String(id),
    tribunal: s.tribunal ?? "",
    numeroProcesso: s.numeroProcesso ?? null,
    grau: s.grau ?? null,
    dataAjuizamento: paraIso(s.dataAjuizamento),
    dataAjuizamentoBruto: s.dataAjuizamento ?? null,
    nivelSigilo: typeof s.nivelSigilo === "number" ? s.nivelSigilo : null,
    orgaoJulgadorCodigo: s.orgaoJulgador?.codigo ?? null,
    orgaoJulgadorNome: s.orgaoJulgador?.nome ?? null,
    classeCodigo: s.classe?.codigo ?? null,
    classeNome: s.classe?.nome ?? null,
    assuntos: Array.isArray(s.assuntos) ? s.assuntos : [],
    movimentos: Array.isArray(s.movimentos) ? s.movimentos : [],
  };
}

export type Buscador = (url: string, init: RequestInit) => Promise<Response>;

export type ResultadoConsulta = {
  processos: Processo[];
  descartados: number;
  consulta: Record<string, unknown>;
  /**
   * `hits.total` — quantos o CNJ tem para esse filtro, e não quantos vieram.
   * `null` quando a resposta não traz o campo.
   */
  total: number | null;
  /** A página cortou: existe mais lá do que aqui. Estatística sobre isto é enviesada. */
  truncado: boolean;
};

export async function consulta(
  recorte: Recorte,
  opcoes: { chave?: string; base?: string; fetchImpl?: Buscador } = {},
): Promise<ResultadoConsulta> {
  const chave = opcoes.chave ?? process.env.DATAJUD_API_KEY;
  if (!chave) throw new DataJudIndisponivel("DATAJUD_API_KEY não configurada");

  const corpo = montaConsulta(recorte);
  const url = `${opcoes.base ?? BASE_PADRAO}/api_publica_${recorte.tribunal}/_search`;
  const buscar = opcoes.fetchImpl ?? ((u: string, i: RequestInit) => fetch(u, i));

  let resposta: Response;
  try {
    resposta = await buscar(url, {
      method: "POST",
      headers: { Authorization: `APIKey ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
  } catch (causa) {
    throw new DataJudIndisponivel(causa);
  }
  if (!resposta.ok) throw new DataJudIndisponivel(`HTTP ${resposta.status}`);

  const json = (await resposta.json()) as {
    hits?: {
      hits?: Array<{ _id?: string; _source?: ProcessoBruto }>;
      // O Elasticsearch devolve `total` como número (v6) ou objeto (v7+).
      total?: number | { value?: number };
    };
  };
  const hits = json.hits?.hits ?? [];

  const bruto = json.hits?.total;
  const total =
    typeof bruto === "number" ? bruto : typeof bruto?.value === "number" ? bruto.value : null;

  const processos: Processo[] = [];
  let descartados = 0;
  for (const h of hits) {
    const p = normaliza(h);
    if (p) processos.push(p);
    else descartados += 1;
  }

  // Sem isto, `vistos` lê como "quantos processos o órgão tem" e é só o tamanho
  // da página. A spec 0007 cita órgão com 2.653.656 processos; o espelho guarda
  // 500 e ninguém fica sabendo que truncou.
  const truncado = total != null && total > hits.length;

  return { processos, descartados, consulta: corpo, total, truncado };
}
