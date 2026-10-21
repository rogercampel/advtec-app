/**
 * Coleta do DJEN e gravação, sem duplicar.
 *
 * A janela de busca é sobreposta de propósito: buscar só "hoje" perde o que a
 * fonte publicou com atraso, e publicação perdida é prazo perdido. A
 * sobreposição só é segura porque `(organization_id, djen_id)` é única — ver a
 * migration 9001.
 *
 * Este módulo NÃO lê prazo e NÃO decide urgência. Ele só garante que nada que a
 * fonte mandou se perca, e que nada entre duas vezes.
 */

import { buscaPorOab, DjenIndisponivel, type Buscador, type Publicacao } from "./comunica";

export type OabMonitorada = {
  numero: string;
  uf: string;
};

/** O mínimo do cliente de banco que esta coleta usa. */
export type ClienteGravacao = {
  upsertPublicacoes(
    organizationId: string,
    linhas: LinhaPublicacao[],
  ): Promise<{ gravadas: number; erro?: string }>;
};

export type LinhaPublicacao = {
  organization_id: string;
  djen_id: number;
  numero_processo: string | null;
  tipo_comunicacao: string | null;
  sigla_tribunal: string | null;
  nome_orgao: string | null;
  data_disponibilizacao: string;
  texto: string;
  link: string | null;
  payload: Record<string, unknown>;
  /**
   * Por quais OABs monitoradas esta publicação entrou. ARRAY, e não par de
   * colunas: a mesma publicação pode intimar dois advogados do escritório.
   */
  oabs: Array<{ numero: string; uf: string }>;
};

export type ResultadoColeta = {
  organizationId: string;
  oabsConsultadas: number;
  publicacoesVistas: number;
  gravadas: number;
  descartadasSemTexto: number;
  falhas: Array<{ oab: string; motivo: string }>;
};

export function paraLinha(
  p: Publicacao,
  organizationId: string,
  oab: OabMonitorada,
): LinhaPublicacao {
  return {
    organization_id: organizationId,
    djen_id: p.djenId,
    numero_processo: p.numeroProcesso,
    tipo_comunicacao: p.tipoComunicacao,
    sigla_tribunal: p.siglaTribunal,
    nome_orgao: p.nomeOrgao,
    data_disponibilizacao: p.dataDisponibilizacao,
    texto: p.texto,
    link: p.link,
    payload: p.payload,
    oabs: [{ numero: oab.numero, uf: oab.uf.toUpperCase() }],
  };
}

/**
 * Duas OABs do mesmo escritório podem ser intimadas na mesma publicação. Sem
 * isto, o upsert receberia a mesma chave duas vezes no mesmo lote — o Postgres
 * recusa (`ON CONFLICT DO UPDATE command cannot affect row a second time`), e a
 * coleta inteira falharia por causa de um caso que é normal no fórum.
 *
 * A versão anterior guardava só a PRIMEIRA ocorrência e jogava fora a segunda
 * OAB. Evitava o crash e perdia a informação: num produto de prazo, **quem foi
 * intimado** decide quem tem de agir. Agora as OABs são somadas na mesma linha.
 *
 * A chave inclui a organização porque esta função é exportada. Hoje `coleta`
 * chama com um escritório só, mas chave sem inquilino é a que descarta linha
 * alheia no dia em que alguém passar um lote misto.
 */
export function deduplicaLote(linhas: LinhaPublicacao[]): LinhaPublicacao[] {
  const vistas = new Map<string, LinhaPublicacao>();
  for (const l of linhas) {
    const chave = `${l.organization_id}:${l.djen_id}`;
    const ja = vistas.get(chave);
    if (!ja) {
      vistas.set(chave, { ...l, oabs: [...l.oabs] });
      continue;
    }
    for (const o of l.oabs) {
      if (!ja.oabs.some((x) => x.numero === o.numero && x.uf === o.uf)) ja.oabs.push(o);
    }
  }
  return [...vistas.values()];
}

/**
 * Janela sobreposta: hoje menos `diasDeFolga`, até hoje — **no fuso de
 * Brasília**, não em UTC.
 *
 * `toISOString()` devolve a data em UTC. Rodando às 21h de Brasília, "hoje" já
 * virou amanhã em UTC e a janela inteira desliza um dia. Num produto de prazo,
 * um dia de deslize é a publicação que ninguém viu.
 *
 * O teste anterior fixava 12:00:00Z — o único horário em que o desvio não
 * aparece.
 */
const FUSO_FORO = "America/Sao_Paulo";

/** `en-CA` porque ele formata como `YYYY-MM-DD`, que é o que a API espera. */
export function diaNoForo(quando: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_FORO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(quando);
}

export function janela(hoje: Date, diasDeFolga = 3): { de: string; ate: string } {
  const inicio = new Date(hoje.getTime() - diasDeFolga * 24 * 60 * 60 * 1000);
  return { de: diaNoForo(inicio), ate: diaNoForo(hoje) };
}

export async function coleta(
  organizationId: string,
  oabs: OabMonitorada[],
  gravacao: ClienteGravacao,
  opcoes: { hoje?: Date; diasDeFolga?: number; base?: string; fetchImpl?: Buscador } = {},
): Promise<ResultadoColeta> {
  const { de, ate } = janela(opcoes.hoje ?? new Date(), opcoes.diasDeFolga);

  const linhas: LinhaPublicacao[] = [];
  const falhas: ResultadoColeta["falhas"] = [];
  let descartadasSemTexto = 0;

  for (const oab of oabs) {
    try {
      const r = await buscaPorOab(
        { numero: oab.numero, uf: oab.uf, de, ate },
        { base: opcoes.base, fetchImpl: opcoes.fetchImpl },
      );
      descartadasSemTexto += r.descartadas;
      for (const p of r.publicacoes) linhas.push(paraLinha(p, organizationId, oab));
    } catch (e) {
      // Uma OAB que falha não derruba as outras. Quem transforma falha em
      // alarme é a E6 — aqui a falha só precisa sobreviver ao laço.
      falhas.push({
        oab: `${oab.numero}/${oab.uf}`,
        motivo: e instanceof DjenIndisponivel ? e.message : String(e),
      });
    }
  }

  const unicas = deduplicaLote(linhas);
  const { gravadas, erro } = await gravacao.upsertPublicacoes(organizationId, unicas);
  if (erro) falhas.push({ oab: "gravação", motivo: erro });

  return {
    organizationId,
    oabsConsultadas: oabs.length,
    publicacoesVistas: linhas.length,
    gravadas,
    descartadasSemTexto,
    falhas,
  };
}
