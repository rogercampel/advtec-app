/**
 * Rotina diária do DJEN — ticket 0009.E1. Liga o motor da 0006 a um relógio.
 *
 * Roda de hora em hora (scheduler: `api/v1/cron/djen-coleta`). Em cada rodada,
 * para cada escritório com OAB monitorada:
 *
 *   1. se ainda não houve coleta BEM-SUCEDIDA hoje (dia do foro), coleta —
 *      registrando a rodada em `djen_coletas` antes de começar, para que um
 *      processo morto no meio deixe rastro (`ok = false`), e não silêncio;
 *   2. avalia o alarme (`avaliaColeta`) e, quando ele manda, abre o aviso na
 *      Central da equipe. Quando volta a ficar em dia, o aviso se fecha sozinho.
 *
 * Coletar de hora em hora seria barato, mas a fonte publica por dia e a janela
 * da coleta já é sobreposta (3 dias): uma coleta boa por dia basta. A rodada
 * horária existe pelo ALARME — o critério 7 da 0006 pede aviso em até 1 hora —
 * e para a coleta que falhou ser tentada de novo na hora seguinte.
 *
 * Este módulo não conhece Supabase. O banco entra por `ClienteDaRotina`, o que
 * deixa a regra testável sem dublê de query builder.
 */

import { avaliaColeta, mensagem, type Decisao, type EstadoDaColeta } from "./alarme";
import { coleta, diaNoForo, type ClienteGravacao, type OabMonitorada, type ResultadoColeta } from "./coletar";
import type { Buscador } from "./comunica";

export type EscritorioMonitorado = { organizationId: string; oabs: OabMonitorada[] };

export type ClienteDaRotina = ClienteGravacao & {
  /** Escritórios com pelo menos uma OAB ATIVA. Quem não tem não entra na rodada. */
  escritoriosMonitorados(): Promise<EscritorioMonitorado[]>;
  /** Houve coleta com `ok = true` iniciada no dia `dia` (YYYY-MM-DD, fuso do foro)? */
  coletouBemNoDia(organizationId: string, dia: string): Promise<boolean>;
  /** Registra o começo da rodada e devolve o id da linha em `djen_coletas`. */
  abreRodada(organizationId: string, inicio: Date): Promise<string>;
  fechaRodada(id: string, resultado: ResultadoColeta, ok: boolean, fim: Date): Promise<void>;
  /** O estado que o alarme lê, sem `temOabMonitorada` (quem está aqui tem). */
  estadoDoAlarme(organizationId: string): Promise<Omit<EstadoDaColeta, "temOabMonitorada">>;
  /** Abre (ou atualiza) o aviso na Central e marca `alarme_enviado_em`. */
  avisa(organizationId: string, texto: string, quando: Date): Promise<void>;
  /** Fecha o aviso aberto, se houver. Chamado quando a coleta está em dia. */
  resolveAviso(organizationId: string): Promise<void>;
};

export type ResumoDoEscritorio = {
  organizationId: string;
  coletou: boolean;
  ok: boolean | null;
  gravadas: number;
  decisao: Decisao;
};

/**
 * Coleta boa = nenhuma OAB falhou e a gravação não falhou. Uma OAB que falha
 * torna a rodada NÃO-ok de propósito: o alarme precisa saber que ficou buraco,
 * e a próxima hora tenta de novo (a deduplicação segura o resto).
 */
export function rodadaFoiOk(r: ResultadoColeta): boolean {
  return r.falhas.length === 0;
}

export async function rodaRotina(
  cliente: ClienteDaRotina,
  opcoes: { agora: Date; fetchImpl?: Buscador; base?: string },
): Promise<ResumoDoEscritorio[]> {
  const { agora } = opcoes;
  const hoje = diaNoForo(agora);
  const resumo: ResumoDoEscritorio[] = [];

  for (const esc of await cliente.escritoriosMonitorados()) {
    let coletou = false;
    let ok: boolean | null = null;
    let gravadas = 0;

    if (!(await cliente.coletouBemNoDia(esc.organizationId, hoje))) {
      coletou = true;
      const id = await cliente.abreRodada(esc.organizationId, agora);
      let resultado: ResultadoColeta;
      try {
        resultado = await coleta(esc.organizationId, esc.oabs, cliente, {
          hoje: agora,
          fetchImpl: opcoes.fetchImpl,
          base: opcoes.base,
        });
      } catch (e) {
        // `coleta` já isola falha por OAB; o que chega aqui é falha inesperada
        // (banco, bug). Vira rodada não-ok com o motivo — nunca exceção que mata
        // a rodada dos outros escritórios.
        resultado = {
          organizationId: esc.organizationId,
          oabsConsultadas: esc.oabs.length,
          publicacoesVistas: 0,
          gravadas: 0,
          descartadasSemTexto: 0,
          falhas: [{ oab: "rotina", motivo: e instanceof Error ? e.message : String(e) }],
        };
      }
      ok = rodadaFoiOk(resultado);
      gravadas = resultado.gravadas;
      await cliente.fechaRodada(id, resultado, ok, new Date(agora.getTime()));
    }

    const estado = await cliente.estadoDoAlarme(esc.organizationId);
    const decisao = avaliaColeta({ ...estado, temOabMonitorada: true }, { agora });
    if (decisao.alarmar) {
      await cliente.avisa(esc.organizationId, mensagem(decisao), agora);
    } else if (decisao.motivo === "em_dia") {
      await cliente.resolveAviso(esc.organizationId);
    }

    resumo.push({ organizationId: esc.organizationId, coletou, ok, gravadas, decisao });
  }

  return resumo;
}
