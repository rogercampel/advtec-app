/**
 * Pauta de hoje — tickets 0009.E3 e 0006.E5.
 *
 * "A pauta sugere; ela não afirma." (spec 0009) Prazo lido do texto é sempre
 * sugestão. Só vira data — "vence hoje", "vence nesta semana" — quando alguém do
 * escritório DIGITA a data final e confirma (0006.E5). O sistema não conta
 * prazo: a contagem automática (0006.E4) espera o gabarito do advogado.
 *
 * As duas regras que não se quebram:
 *   - prazo NÃO confirmado não sai da pauta com o passar dos dias (0006,
 *     critério 6; 0009, critério 4);
 *   - prazo CONFIRMADO também não some: vence daqui a um ano (talvez o ano foi
 *     digitado errado) ou venceu há semanas, continua num grupo, com o botão de
 *     corrigir. Um erro de digitação que tira a linha da tela parece resolvido.
 *
 * Grupos, disjuntos:
 *   - venceu (até JANELA_DO_VENCIDO dias atrás) / venceHoje / venceNaSemana (1 a
 *     7 dias) / venceDepois (mais de 7): só prazo confirmado — inclusive o de
 *     publicação que deixou de ter caso (o número saiu do negócio): a data já
 *     foi conferida, e perdê-la de vista é perder o prazo;
 *   - chegouDesdeOntem: publicação de caso do escritório disponibilizada ontem
 *     ou hoje (dia do foro), sem prazo confirmado;
 *   - pendentes: as mais antigas com prazo sugerido que ninguém confirmou.
 *
 * As não reconhecidas são a caixa (0009.E2, `montaCaixa`), na mesma tela.
 */
import { montaCaixa, type NegocioDoFunil, type PublicacaoDaCaixa } from "./caixa";
import { diaNoForo } from "./coletar";
import { lePublicacao, type PrazoLido, type TipoDeAto } from "./ler";

export type LinhaDaPauta = {
  publicacao: PublicacaoDaCaixa;
  casoIds: string[];
  tipoDeAto: TipoDeAto | null;
  /** Sugestões, nunca fato. Vazio = o texto não fala de prazo. */
  prazosSugeridos: PrazoLido[];
  /** Há quantos dias (do foro) a publicação foi disponibilizada. */
  diasNaPauta: number;
  /** Só com prazo confirmado: dias até a data final (negativo = já venceu). */
  diasParaVencer: number | null;
};

export type Pauta = {
  hoje: string;
  venceu: LinhaDaPauta[];
  venceHoje: LinhaDaPauta[];
  venceNaSemana: LinhaDaPauta[];
  venceDepois: LinhaDaPauta[];
  chegouDesdeOntem: LinhaDaPauta[];
  pendentes: LinhaDaPauta[];
  naoReconhecidas: PublicacaoDaCaixa[];
};

const DIA_MS = 86_400_000;
export const JANELA_DA_SEMANA = 7;
/**
 * Até quantos dias depois de vencer o confirmado continua na pauta. É a mesma
 * janela que a rota aceita para trás: tudo que dá para confirmar, dá para ver.
 *
 * ponytail: depois disso sai da pauta sem marca de "cumprido"; um botão de
 * cumprido entra quando o piloto pedir.
 */
export const JANELA_DO_VENCIDO = 60;

/** Diferença em dias entre duas datas `YYYY-MM-DD`, sem fuso no meio. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);
}

export function montaPauta(
  publicacoes: PublicacaoDaCaixa[],
  negocios: NegocioDoFunil[],
  agora: Date,
): Pauta {
  const hoje = diaNoForo(agora);
  const caixa = montaCaixa(publicacoes, negocios);
  const pauta: Pauta = {
    hoje,
    venceu: [],
    venceHoje: [],
    venceNaSemana: [],
    venceDepois: [],
    chegouDesdeOntem: [],
    pendentes: [],
    naoReconhecidas: caixa.naoReconhecidas,
  };

  const semCasoConfirmadas = caixa.naoReconhecidas
    .filter((p) => p.prazoConfirmado)
    .map((publicacao) => ({ publicacao, casoIds: [] as string[] }));

  for (const { publicacao, casoIds } of [...caixa.reconhecidas, ...semCasoConfirmadas]) {
    const leitura = lePublicacao(publicacao.texto);
    const confirmado = publicacao.prazoConfirmado ?? null;
    const linha: LinhaDaPauta = {
      publicacao,
      casoIds,
      tipoDeAto: leitura.tipoDeAto,
      prazosSugeridos: leitura.prazos,
      diasNaPauta: Math.max(0, diasEntre(publicacao.dataDisponibilizacao.slice(0, 10), hoje)),
      diasParaVencer: confirmado ? diasEntre(hoje, confirmado.venceEm) : null,
    };
    const d = linha.diasParaVencer;
    if (d !== null) {
      if (d === 0) pauta.venceHoje.push(linha);
      else if (d > 0 && d <= JANELA_DA_SEMANA) pauta.venceNaSemana.push(linha);
      else if (d > JANELA_DA_SEMANA) pauta.venceDepois.push(linha);
      else if (d >= -JANELA_DO_VENCIDO) pauta.venceu.push(linha);
    } else if (linha.diasNaPauta <= 1) pauta.chegouDesdeOntem.push(linha);
    else if (linha.prazosSugeridos.length > 0) pauta.pendentes.push(linha);
  }

  // O que vence antes aparece primeiro; o que venceu mais perto de hoje, também;
  // quem espera confirmação há mais tempo, também.
  const porVencimento = (a: LinhaDaPauta, b: LinhaDaPauta) => a.diasParaVencer! - b.diasParaVencer!;
  pauta.venceNaSemana.sort(porVencimento);
  pauta.venceDepois.sort(porVencimento);
  pauta.venceu.sort((a, b) => b.diasParaVencer! - a.diasParaVencer!);
  pauta.pendentes.sort((a, b) => b.diasNaPauta - a.diasNaPauta);
  return pauta;
}

/**
 * A data mais antiga de vencimento que a pauta ainda mostra. A leitura do banco
 * busca os confirmados a partir dela, À PARTE das N publicações mais recentes:
 * um prazo confirmado de publicação antiga não pode cair fora pelo teto.
 */
export function corteDoVencido(agora: Date): string {
  return diaNoForo(new Date(agora.getTime() - JANELA_DO_VENCIDO * DIA_MS));
}
