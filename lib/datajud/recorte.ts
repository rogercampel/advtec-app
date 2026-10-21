/**
 * Recorte e comparação — ticket 0007.E5.
 *
 * Para um recorte (tribunal + classe + assunto + órgão julgador): como aquele
 * juízo vem decidindo, quanto demora e quanto recebe — e o mesmo para os DEMAIS
 * órgãos do mesmo tribunal, na mesma classe. (spec 0007, "O que se entrega")
 *
 * Regras que vêm da spec e moram no TIPO, não na tela:
 *   - todo percentual carrega o seu `n` e o denominador (critério 1);
 *   - abaixo de `AMOSTRA_MINIMA`, "amostra insuficiente" em vez de percentual
 *     (critério 3);
 *   - tempo em mediana e faixa (critério 4, `tempo.ts`);
 *   - a unidade é o ÓRGÃO: nada aqui lê ou devolve nome de pessoa (critério 6);
 *   - sigilo e data suja saem pela higiene, contados (critérios 2 e 7);
 *   - toda estatística leva o filtro que a gerou e a data da coleta (critério 8).
 *
 * Descreve o que já aconteceu. A frase que vai à tela é de `textoDoPerfil`, que
 * passa pela trava de linguagem da E6.
 */
import { desfechoDoProcesso, type Desfecho } from "./desfecho";
import { higieniza, type Descartes } from "./higiene";
import { AMOSTRA_MINIMA, tempoAteASentenca, type LinhaParaTempo, type Tempo } from "./tempo";

export type LinhaDoRecorte = LinhaParaTempo & {
  orgao_julgador_codigo: number | null;
  orgao_julgador_nome: string | null;
  classe_codigo: number | null;
};

export type Filtro = {
  rotulo: string;
  tribunal: string;
  classe_codigo: number | null;
  /** O nome como o DataJud manda ("Procedimento Comum Cível"), quando o espelho tem. */
  classe_nome?: string | null;
  assunto_codigo: number | null;
  orgao_julgador_codigo: number;
};

export type Fatia = { n: number; de: number; percentual: number };

export type Desfechos =
  | {
      situacao: "calculado";
      /** Processos com desfecho lido — o denominador dos percentuais. */
      n: number;
      procedencia: Fatia;
      improcedencia: Fatia;
      procedencia_parcial: Fatia;
      /** Público, limpo, e sem movimento de mérito mapeado (ainda tramitando, ou extinto sem mérito). */
      semDesfecho: number;
    }
  | { situacao: "amostra_insuficiente"; n: number; minimo: number; semDesfecho: number };

export type Lado = {
  /** Processos do espelho neste lado, antes da higiene. */
  volume: number;
  descartados: Descartes;
  desfechos: Desfechos;
  tempo: Tempo;
};

export type Perfil = {
  filtro: Filtro;
  /** Quando o espelho foi coletado (`datajud_recortes.ultima_coleta_em`). */
  coletadoEm: string;
  /** O nome do órgão como o DataJud manda — é unidade, não pessoa. */
  orgao: { codigo: number; nome: string | null } & Lado;
  /** Os outros órgãos do mesmo tribunal e da mesma classe. */
  demais: Lado & { orgaos: number };
};

const fatia = (n: number, de: number): Fatia => ({ n, de, percentual: Math.round((n / de) * 100) });

export function desfechos(linhas: LinhaDoRecorte[], opcoes: { hoje?: Date } = {}): { desfechos: Desfechos; descartados: Descartes } {
  const { limpos, descartados } = higieniza(linhas, opcoes);
  const conta: Record<Desfecho, number> = { procedencia: 0, improcedencia: 0, procedencia_parcial: 0 };
  let semDesfecho = 0;
  for (const l of limpos) {
    const d = desfechoDoProcesso(l.movimentos).desfecho;
    if (d) conta[d] += 1;
    else semDesfecho += 1;
  }
  const n = conta.procedencia + conta.improcedencia + conta.procedencia_parcial;
  if (n < AMOSTRA_MINIMA) {
    return { desfechos: { situacao: "amostra_insuficiente", n, minimo: AMOSTRA_MINIMA, semDesfecho }, descartados };
  }
  return {
    desfechos: {
      situacao: "calculado",
      n,
      procedencia: fatia(conta.procedencia, n),
      improcedencia: fatia(conta.improcedencia, n),
      procedencia_parcial: fatia(conta.procedencia_parcial, n),
      semDesfecho,
    },
    descartados,
  };
}

function lado(linhas: LinhaDoRecorte[], hoje?: Date): Lado {
  const { desfechos: d, descartados } = desfechos(linhas, { hoje });
  return { volume: linhas.length, descartados, desfechos: d, tempo: tempoAteASentenca(linhas, { hoje }) };
}

export function perfilDoRecorte(args: {
  filtro: Filtro;
  coletadoEm: string;
  /** Processos do tribunal na classe do filtro — o órgão e os demais. */
  linhas: LinhaDoRecorte[];
  hoje?: Date;
}): Perfil {
  const { filtro, coletadoEm, hoje } = args;
  // Classe diferente da do filtro não entra em lado nenhum: comparar órgão com tribunal só vale na mesma classe.
  const daClasse = args.linhas.filter((l) => filtro.classe_codigo === null || l.classe_codigo === filtro.classe_codigo);
  const doOrgao = daClasse.filter((l) => l.orgao_julgador_codigo === filtro.orgao_julgador_codigo);
  const dosDemais = daClasse.filter((l) => l.orgao_julgador_codigo !== filtro.orgao_julgador_codigo);
  const nome = doOrgao.find((l) => l.orgao_julgador_nome)?.orgao_julgador_nome ?? null;
  return {
    filtro,
    coletadoEm,
    orgao: { codigo: filtro.orgao_julgador_codigo, nome, ...lado(doOrgao, hoje) },
    demais: {
      orgaos: new Set(dosDemais.map((l) => l.orgao_julgador_codigo)).size,
      ...lado(dosDemais, hoje),
    },
  };
}
