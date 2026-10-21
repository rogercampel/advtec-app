/**
 * Cliente do DJEN (API Comunica do CNJ).
 *
 * Pública, sem chave. Medido em 18/08/2026 — ver `docs/advtec/FONTES-DE-DADOS.md`:
 *
 *     GET /api/v1/comunicacao?numeroOab=100000&ufOab=SP  ->  200, count = 2712
 *
 * Este módulo só fala HTTP e normaliza o formato. Ele não decide nada sobre
 * prazo: quem lê o texto é a etapa E3, e quem conta é a E4. Aqui a única regra
 * é não perder o que a fonte mandou.
 */

const BASE_PADRAO = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";

/** O que a API devolve por item, no que nos interessa. */
export type ComunicacaoBruta = {
  id: number;
  data_disponibilizacao: string;
  siglaTribunal?: string | null;
  tipoComunicacao?: string | null;
  nomeOrgao?: string | null;
  texto?: string | null;
  numero_processo?: string | null;
  link?: string | null;
  [k: string]: unknown;
};

export type Publicacao = {
  djenId: number;
  dataDisponibilizacao: string;
  siglaTribunal: string | null;
  tipoComunicacao: string | null;
  nomeOrgao: string | null;
  numeroProcesso: string | null;
  texto: string;
  link: string | null;
  payload: Record<string, unknown>;
};

export type ConsultaPorOab = {
  numero: string;
  uf: string;
  /** ISO `YYYY-MM-DD`. Janela sobreposta de propósito: a fonte publica com atraso. */
  de?: string;
  ate?: string;
  itensPorPagina?: number;
};

export class DjenIndisponivel extends Error {
  constructor(readonly causa: unknown) {
    super(`DJEN indisponível: ${causa instanceof Error ? causa.message : String(causa)}`);
    this.name = "DjenIndisponivel";
  }
}

export function montaUrl(c: ConsultaPorOab, base = BASE_PADRAO): string {
  const p = new URLSearchParams({
    numeroOab: c.numero,
    ufOab: c.uf.toUpperCase(),
    itensPorPagina: String(c.itensPorPagina ?? 100),
  });
  if (c.de) p.set("dataDisponibilizacaoInicio", c.de);
  if (c.ate) p.set("dataDisponibilizacaoFim", c.ate);
  return `${base}?${p.toString()}`;
}

/**
 * Item sem `texto` é descartado, e o motivo é o critério de aceite 2: a
 * publicação tem de continuar legível com a fonte fora do ar. Guardar linha sem
 * teor é guardar uma promessa de ir buscar depois — exatamente o que não pode.
 */
export function normaliza(item: ComunicacaoBruta): Publicacao | null {
  const texto = (item.texto ?? "").trim();
  if (!texto) return null;
  if (typeof item.id !== "number") return null;
  if (!item.data_disponibilizacao) return null;

  return {
    djenId: item.id,
    dataDisponibilizacao: item.data_disponibilizacao.slice(0, 10),
    siglaTribunal: item.siglaTribunal ?? null,
    tipoComunicacao: item.tipoComunicacao ?? null,
    nomeOrgao: item.nomeOrgao ?? null,
    numeroProcesso: item.numero_processo ?? null,
    texto,
    link: item.link ?? null,
    payload: item as Record<string, unknown>,
  };
}

export type Buscador = (url: string) => Promise<Response>;

export async function buscaPorOab(
  consulta: ConsultaPorOab,
  opcoes: { base?: string; fetchImpl?: Buscador } = {},
): Promise<{ publicacoes: Publicacao[]; descartadas: number; total: number }> {
  const url = montaUrl(consulta, opcoes.base ?? BASE_PADRAO);
  const buscar = opcoes.fetchImpl ?? ((u: string) => fetch(u));

  let resposta: Response;
  try {
    resposta = await buscar(url);
  } catch (causa) {
    throw new DjenIndisponivel(causa);
  }
  if (!resposta.ok) throw new DjenIndisponivel(`HTTP ${resposta.status}`);

  const corpo = (await resposta.json()) as { items?: ComunicacaoBruta[]; count?: number };
  const itens = corpo.items ?? [];
  const publicacoes: Publicacao[] = [];
  let descartadas = 0;

  for (const item of itens) {
    const p = normaliza(item);
    if (p) publicacoes.push(p);
    else descartadas += 1;
  }

  return { publicacoes, descartadas, total: corpo.count ?? itens.length };
}
