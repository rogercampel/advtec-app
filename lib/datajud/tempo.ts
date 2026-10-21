/**
 * Tempo do ajuizamento à sentença — ticket 0007.E4.
 *
 * "Quanto costuma demorar: do ajuizamento à sentença […] em mediana e faixa —
 * não em média, que outlier destrói." (spec 0007) Critério 4: tempo é
 * reportado em mediana e faixa, nunca só em média. Por isso o resultado NÃO TEM
 * campo de média: não há como exibi-la por engano.
 *
 * ═══ DE ONDE SAI CADA DATA ═══
 *
 *   - ajuizamento: `data_ajuizamento` do espelho, já pela higiene (E2): sigilo,
 *     data impossível e data ilegível saem contados antes daqui;
 *   - sentença: a data do movimento de mérito que fundamentou o desfecho (E3,
 *     `desfechoDoProcesso` — Procedência, Improcedência, Procedência em Parte).
 *     Processo sem desfecho mapeado não tem sentença para medir, e é contado.
 *
 * ═══ O QUE NÃO ENTRA, E SAI CONTADO ═══
 *
 * Sem data de ajuizamento, sem sentença mapeada, sentença sem data legível, e
 * sentença ANTES do ajuizamento (dado sujo: não existe duração negativa). Cada
 * um com o seu número — "mediana de 400 dias" de 30 processos, quando 900
 * ficaram de fora, é outro número.
 *
 * ═══ AMOSTRA MÍNIMA ═══
 *
 * Critério 3: abaixo de `AMOSTRA_MINIMA`, o resultado é "amostra insuficiente",
 * sem mediana nem faixa. Estatística com 3 casos é pior que silêncio.
 */
import { desfechoDoProcesso } from "./desfecho";
import { higieniza, type Descartes, type ParaEstatistica } from "./higiene";

/**
 * ponytail: 30 é a regra de bolso para mediana e quartis estáveis; é decisão de
 * produto, e mora numa constante só para a E5 usar a mesma.
 */
export const AMOSTRA_MINIMA = 30;

export type LinhaParaTempo = ParaEstatistica & { movimentos: unknown[] };

export type ForaDoTempo = {
  semAjuizamento: number;
  semSentenca: number;
  sentencaSemData: number;
  sentencaAntesDoAjuizamento: number;
};

export type Tempo =
  | {
      situacao: "calculado";
      /** Processos medidos. Vai ao lado de todo número (critério 1). */
      n: number;
      medianaDias: number;
      /** Faixa interquartil: metade dos processos ficou entre `de` e `ate` dias. */
      faixa: { de: number; ate: number };
      descartados: Descartes;
      foraDoTempo: ForaDoTempo;
    }
  | {
      situacao: "amostra_insuficiente";
      n: number;
      minimo: number;
      descartados: Descartes;
      foraDoTempo: ForaDoTempo;
    };

const DIA_MS = 86_400_000;

/** Quantil por interpolação linear entre vizinhos (o "tipo 7" do R). `ordenados` não vazio. */
export function quantil(ordenados: number[], p: number): number {
  const pos = (ordenados.length - 1) * p;
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  return ordenados[baixo]! + (ordenados[alto]! - ordenados[baixo]!) * (pos - baixo);
}

export function tempoAteASentenca(linhas: LinhaParaTempo[], opcoes: { hoje?: Date } = {}): Tempo {
  const { limpos, descartados } = higieniza(linhas, opcoes);
  const fora: ForaDoTempo = { semAjuizamento: 0, semSentenca: 0, sentencaSemData: 0, sentencaAntesDoAjuizamento: 0 };
  const dias: number[] = [];

  for (const l of limpos) {
    if (!l.data_ajuizamento) {
      fora.semAjuizamento += 1;
      continue;
    }
    const { fundamento } = desfechoDoProcesso(l.movimentos);
    if (!fundamento) {
      fora.semSentenca += 1;
      continue;
    }
    if (!fundamento.dataHora) {
      fora.sentencaSemData += 1;
      continue;
    }
    const d = (Date.parse(fundamento.dataHora) - Date.parse(l.data_ajuizamento)) / DIA_MS;
    if (!Number.isFinite(d) || d < 0) {
      fora.sentencaAntesDoAjuizamento += 1;
      continue;
    }
    dias.push(Math.round(d));
  }

  if (dias.length < AMOSTRA_MINIMA) {
    return { situacao: "amostra_insuficiente", n: dias.length, minimo: AMOSTRA_MINIMA, descartados, foraDoTempo: fora };
  }
  dias.sort((a, b) => a - b);
  return {
    situacao: "calculado",
    n: dias.length,
    medianaDias: Math.round(quantil(dias, 0.5)),
    faixa: { de: Math.round(quantil(dias, 0.25)), ate: Math.round(quantil(dias, 0.75)) },
    descartados,
    foraDoTempo: fora,
  };
}
