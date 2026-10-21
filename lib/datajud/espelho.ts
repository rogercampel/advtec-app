/**
 * Espelha um recorte do DataJud no banco do escritório.
 *
 * A regra que rege este módulo: **fidelidade**. O que a fonte mandou entra como
 * veio, inclusive o que é obviamente lixo — medido, existe processo com
 * `dataAjuizamento` em 1888. Limpar aqui esconderia o tamanho da sujeira, e a
 * spec 0007 exige que o número de descartados apareça no resultado. Quem
 * descarta, contando, é a E2.
 *
 * O que este módulo garante é outra coisa: que a estatística seja **conferível**
 * depois. Por isso a consulta enviada e a data da coleta são gravadas junto.
 */

import { consulta as consultaDataJud, DataJudIndisponivel, type Buscador, type Processo, type Recorte } from "./api";

export type LinhaProcesso = {
  organization_id: string;
  recorte_id: string;
  datajud_id: string;
  tribunal: string;
  numero_processo: string | null;
  grau: string | null;
  data_ajuizamento: string | null;
  data_ajuizamento_bruto: string | null;
  nivel_sigilo: number | null;
  orgao_julgador_codigo: number | null;
  orgao_julgador_nome: string | null;
  classe_codigo: number | null;
  classe_nome: string | null;
  assuntos: unknown[];
  movimentos: unknown[];
};

export type ClienteEspelho = {
  upsertProcessos(linhas: LinhaProcesso[]): Promise<{ gravados: number; erro?: string }>;
  marcaColeta(
    recorteId: string,
    quando: Date,
    consultaEnviada: Record<string, unknown>,
    totais: { total: number | null; truncado: boolean },
  ): Promise<void>;
};

export type ResultadoEspelho = {
  recorteId: string;
  vistos: number;
  gravados: number;
  descartadosSemId: number;
  /** Data plausível de ler, mas absurda (medido: 1888). Sujeira DELES. */
  comDataImpossivel: number;
  /**
   * Data que não deu para interpretar: o bruto veio, o interpretado saiu nulo.
   *
   * Contado separado de `comDataImpossivel` de propósito, e os dois são
   * problemas diferentes: 1888 é dado velho do CNJ, e ilegível é **formato que
   * mudou**. Se o CNJ trocar o layout da data, este número vai a 100% de uma
   * vez — e é assim que a E6 (alarme de falha de coleta) descobre, em vez de a
   * jurimetria emagrecer em silêncio.
   */
  comDataIlegivel: number;
  /** Quantos o CNJ tem para o filtro. Comparar com `vistos` mostra se truncou. */
  total: number | null;
  truncado: boolean;
  falha?: string;
};

/** Antes de 1990 não existe processo eletrônico. Aqui só CONTA — não descarta. */
export const ANO_MINIMO_PLAUSIVEL = 1990;

/**
 * O bruto chegou e o interpretado não saiu.
 *
 * Existe porque `paraIso` passou a devolver `null` para o que não reconhece —
 * antes devolvia a string crua, que envenenava o `insert` em `timestamptz`. O
 * conserto certo criou um buraco de contagem: "data estranha", "N/A" e "sem
 * data" **eram contadas** como impossíveis e passaram a sumir caladas. Achado
 * na convergência em 19/08/2026, contra a spec 0007, critério 2.
 */
export function dataIlegivel(iso: string | null, bruto: string | null): boolean {
  return iso === null && (bruto ?? "").trim() !== "";
}

export function dataImpossivel(iso: string | null, anoMinimo = ANO_MINIMO_PLAUSIVEL): boolean {
  if (!iso) return false;
  const ano = Number(iso.slice(0, 4));
  if (!Number.isFinite(ano)) return true;
  return ano < anoMinimo || ano > new Date().getFullYear() + 1;
}

export function paraLinha(p: Processo, organizationId: string, recorteId: string): LinhaProcesso {
  return {
    organization_id: organizationId,
    recorte_id: recorteId,
    datajud_id: p.datajudId,
    tribunal: p.tribunal,
    numero_processo: p.numeroProcesso,
    grau: p.grau,
    data_ajuizamento: p.dataAjuizamento,
    data_ajuizamento_bruto: p.dataAjuizamentoBruto,
    nivel_sigilo: p.nivelSigilo,
    orgao_julgador_codigo: p.orgaoJulgadorCodigo,
    orgao_julgador_nome: p.orgaoJulgadorNome,
    classe_codigo: p.classeCodigo,
    classe_nome: p.classeNome,
    assuntos: p.assuntos,
    movimentos: p.movimentos,
  };
}

/** O mesmo `_id` não pode vir duas vezes no lote — o upsert recusaria o lote inteiro. */
export function deduplicaLote(linhas: LinhaProcesso[]): LinhaProcesso[] {
  const vistas = new Map<string, LinhaProcesso>();
  for (const l of linhas) if (!vistas.has(l.datajud_id)) vistas.set(l.datajud_id, l);
  return [...vistas.values()];
}

export async function espelha(
  organizationId: string,
  recorteId: string,
  recorte: Recorte,
  cliente: ClienteEspelho,
  opcoes: { chave?: string; base?: string; fetchImpl?: Buscador; agora?: Date } = {},
): Promise<ResultadoEspelho> {
  const agora = opcoes.agora ?? new Date();

  let r: Awaited<ReturnType<typeof consultaDataJud>>;
  try {
    r = await consultaDataJud(recorte, opcoes);
  } catch (e) {
    return {
      recorteId,
      vistos: 0,
      gravados: 0,
      descartadosSemId: 0,
      comDataImpossivel: 0,
      comDataIlegivel: 0,
      total: null,
      truncado: false,
      falha: e instanceof DataJudIndisponivel ? e.message : String(e),
    };
  }

  const linhas = deduplicaLote(r.processos.map((p) => paraLinha(p, organizationId, recorteId)));
  const comDataImpossivel = linhas.filter((l) => dataImpossivel(l.data_ajuizamento)).length;
  const comDataIlegivel = linhas.filter((l) =>
    dataIlegivel(l.data_ajuizamento, l.data_ajuizamento_bruto),
  ).length;

  const { gravados, erro } = await cliente.upsertProcessos(linhas);

  // A consulta e a data ficam gravadas no recorte. Sem esse par, o número que o
  // advogado viu ontem não é reproduzível hoje — e a base do CNJ muda todo dia.
  //
  // SÓ quando o upsert deu certo. A versão anterior marcava a coleta mesmo com
  // erro, e `ultima_coleta_em` passava a dizer "coletado" com zero linhas
  // gravadas — que é pior que não ter data nenhuma, porque parece verdade.
  if (!erro) {
    await cliente.marcaColeta(recorteId, agora, r.consulta, {
      total: r.total,
      truncado: r.truncado,
    });
  }

  return {
    recorteId,
    vistos: r.processos.length,
    gravados,
    descartadosSemId: r.descartados,
    comDataImpossivel,
    comDataIlegivel,
    total: r.total,
    truncado: r.truncado,
    falha: erro,
  };
}
