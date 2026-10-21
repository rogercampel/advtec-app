/**
 * Caixa de publicações não reconhecidas — ticket 0009.E2.
 *
 * O caso do escritório é o NEGÓCIO do funil (ADR 0003): o número do processo
 * mora em `crm_leads.custom_fields.numero_processo`. A caixa é calculada a cada
 * leitura (`amarra`, 0006.E2), nunca gravada — a publicação sai dela sozinha no
 * momento em que um negócio passa a ter aquele número.
 *
 * Só três caminhos tiram uma publicação da caixa, e todos deixam rastro:
 *   1. ligar a um negócio existente → o número é anotado no negócio (PATCH do
 *      lead, que mescla `custom_fields` e audita);
 *   2. criar o caso → um negócio novo com o número;
 *   3. "não é nossa" → `descartada_em/por/motivo` na publicação (migration 9005).
 */
import { amarra, type CasoDoEscritorio } from "./amarrar";

/** A chave em `crm_leads.custom_fields` que guarda o número do processo do caso. */
export const CAMPO_DO_PROCESSO = "numero_processo";

export type NegocioDoFunil = {
  id: string;
  organization_id: string;
  title: string;
  custom_fields: Record<string, unknown> | null;
};

export type PublicacaoDaCaixa = {
  id: string;
  organizationId: string;
  numeroProcesso: string | null;
  dataDisponibilizacao: string;
  tipoComunicacao: string | null;
  siglaTribunal: string | null;
  nomeOrgao: string | null;
  texto: string;
  descartadaEm: string | null;
  /** Data final digitada por alguém do escritório (0006.E5). Ausente = ninguém confirmou. */
  prazoConfirmado?: PrazoConfirmado | null;
};

export type PrazoConfirmado = { venceEm: string; confirmadoEm: string; observacao: string | null };

/** O que a caixa e a pauta leem de `djen_publicacoes` — a tela e o resumo da manhã. */
export const COLUNAS_DA_PUBLICACAO =
  "id, organization_id, numero_processo, data_disponibilizacao, tipo_comunicacao, sigla_tribunal, nome_orgao, texto, descartada_em, prazo_vence_em, prazo_confirmado_em, prazo_observacao";

export type LinhaDaPublicacao = {
  id: string;
  organization_id: string;
  numero_processo: string | null;
  data_disponibilizacao: string;
  tipo_comunicacao: string | null;
  sigla_tribunal: string | null;
  nome_orgao: string | null;
  texto: string;
  descartada_em: string | null;
  prazo_vence_em: string | null;
  prazo_confirmado_em: string | null;
  prazo_observacao: string | null;
};

export function daLinha(p: LinhaDaPublicacao): PublicacaoDaCaixa {
  return {
    id: p.id,
    organizationId: p.organization_id,
    numeroProcesso: p.numero_processo,
    dataDisponibilizacao: p.data_disponibilizacao,
    tipoComunicacao: p.tipo_comunicacao,
    siglaTribunal: p.sigla_tribunal,
    nomeOrgao: p.nome_orgao,
    texto: p.texto,
    descartadaEm: p.descartada_em,
    // O check da 9006 garante que as duas andam juntas.
    prazoConfirmado:
      p.prazo_vence_em && p.prazo_confirmado_em
        ? { venceEm: p.prazo_vence_em, confirmadoEm: p.prazo_confirmado_em, observacao: p.prazo_observacao }
        : null,
  };
}

/** Negócios que viram caso: os que têm o número do processo anotado. */
export function casosDosNegocios(negocios: NegocioDoFunil[]): CasoDoEscritorio[] {
  return negocios.flatMap((n) => {
    const numero = n.custom_fields?.[CAMPO_DO_PROCESSO];
    return typeof numero === "string" && numero.trim()
      ? [{ id: n.id, organizationId: n.organization_id, numeroProcesso: numero }]
      : [];
  });
}

export type Caixa = {
  /** Sem caso e sem descarte: alguém precisa olhar. */
  naoReconhecidas: PublicacaoDaCaixa[];
  /** Amarradas a pelo menos um negócio. */
  reconhecidas: Array<{ publicacao: PublicacaoDaCaixa; casoIds: string[] }>;
  /** Marcadas como "não é nossa" — saem da caixa, mas não somem da tela. */
  descartadas: PublicacaoDaCaixa[];
};

export function montaCaixa(publicacoes: PublicacaoDaCaixa[], negocios: NegocioDoFunil[]): Caixa {
  const ativas = publicacoes.filter((p) => !p.descartadaEm);
  const { reconhecidas, naoReconhecidas } = amarra(ativas, casosDosNegocios(negocios));
  return {
    naoReconhecidas,
    reconhecidas,
    descartadas: publicacoes.filter((p) => p.descartadaEm),
  };
}

/** Junta as leituras (recentes + confirmadas) sem repetir a publicação. */
export function semRepetir(...listas: LinhaDaPublicacao[][]): LinhaDaPublicacao[] {
  const vistas = new Map<string, LinhaDaPublicacao>();
  for (const l of listas.flat()) if (!vistas.has(l.id)) vistas.set(l.id, l);
  return [...vistas.values()];
}
