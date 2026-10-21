/**
 * Desfecho das peças via DataJud — ticket 0004.E4.
 *
 * "Para cada tese, quantos processos do escritório a usaram e como terminaram,
 * pelo DataJud, sempre com o N e a data da consulta." (spec 0004) Critério 8:
 * desfecho sempre com N e data da consulta; abaixo do mínimo, "casos
 * insuficientes" em vez de percentual.
 *
 * A peça já vem amarrada ao processo pela E3 (`metadata.processo`). O desfecho
 * sai do espelho do DataJud (0007.E1) pelo mesmo leitor da jurimetria
 * (`desfechoDoProcesso`, 0007.E3), depois da mesma higiene (sigilo fora,
 * contado — 0007.E2).
 *
 * A contagem ("5 de 7 terminaram procedentes") sai sempre: é o exemplo da
 * própria spec, e descreve o passado com o N à vista. O PERCENTUAL só sai a
 * partir de `AMOSTRA_MINIMA` processos com desfecho — a mesma régua da 0007.
 *
 * Nada aqui prevê nada. A frase que vai à tela passa pela trava da 0007.E6.
 */
import { chaveDeProcesso } from "@/lib/djen/amarrar";
import { desfechoDoProcesso, type Desfecho } from "@/lib/datajud/desfecho";
import { higieniza } from "@/lib/datajud/higiene";
import { AMOSTRA_MINIMA } from "@/lib/datajud/tempo";

export type PecaAmarrada = { documento: string; processo: string | null };

export type ProcessoNoEspelho = {
  numero_processo: string | null;
  nivel_sigilo: number | null;
  data_ajuizamento: string | null;
  data_ajuizamento_bruto: string | null;
  movimentos: unknown[];
  coletado_em: string;
};

export type Contagem = { n: number; de: number; percentual: number | null };

export type DesfechoDaTese = {
  /** Processos distintos das peças, com desfecho lido no espelho — o denominador. */
  n: number;
  procedencia: Contagem;
  improcedencia: Contagem;
  procedencia_parcial: Contagem;
  /** `true` abaixo de `AMOSTRA_MINIMA`: só contagem, nenhum percentual. */
  casosInsuficientes: boolean;
  /** A data da consulta: a coleta mais antiga e a mais recente dos processos usados. */
  consultadoEm: { de: string; ate: string } | null;
  fora: {
    /** Peça sem processo amarrado: fica sem desfecho, e isso aparece (risco da spec). */
    pecasSemProcesso: number;
    /** Processo que o espelho ainda não tem. */
    semEspelho: number;
    /** Sigilo ou data inválida, pela higiene da 0007. */
    descartados: number;
    /** No espelho, mas sem movimento de mérito (tramitando ou extinto sem mérito). */
    semDesfecho: number;
  };
};

export function desfechoDasPecas(pecas: PecaAmarrada[], espelho: ProcessoNoEspelho[], opcoes: { hoje?: Date } = {}): DesfechoDaTese {
  const pecasSemProcesso = pecas.filter((p) => !chaveDeProcesso(p.processo)).length;
  const processos = [...new Set(pecas.map((p) => chaveDeProcesso(p.processo)).filter((c): c is string => c !== null))];

  // O mesmo processo pode estar em mais de um recorte, ou nos dois graus: os movimentos se somam.
  const porChave = new Map<string, ProcessoNoEspelho[]>();
  for (const l of espelho) {
    const c = chaveDeProcesso(l.numero_processo);
    if (c) porChave.set(c, [...(porChave.get(c) ?? []), l]);
  }

  const conta: Record<Desfecho, number> = { procedencia: 0, improcedencia: 0, procedencia_parcial: 0 };
  let semEspelho = 0;
  let descartados = 0;
  let semDesfecho = 0;
  const coletas: string[] = [];

  for (const c of processos) {
    const linhas = porChave.get(c);
    if (!linhas) {
      semEspelho += 1;
      continue;
    }
    const { limpos } = higieniza(linhas, opcoes);
    if (limpos.length < linhas.length) {
      // Uma linha sigilosa basta para o processo inteiro sair: sigilo não se soma com público.
      descartados += 1;
      continue;
    }
    const d = desfechoDoProcesso(limpos.flatMap((l) => l.movimentos)).desfecho;
    if (!d) {
      semDesfecho += 1;
      continue;
    }
    conta[d] += 1;
    coletas.push(...limpos.map((l) => l.coletado_em));
  }

  const n = conta.procedencia + conta.improcedencia + conta.procedencia_parcial;
  const casosInsuficientes = n < AMOSTRA_MINIMA;
  const contagem = (x: number): Contagem => ({ n: x, de: n, percentual: casosInsuficientes ? null : Math.round((x / n) * 100) });
  coletas.sort();
  return {
    n,
    procedencia: contagem(conta.procedencia),
    improcedencia: contagem(conta.improcedencia),
    procedencia_parcial: contagem(conta.procedencia_parcial),
    casosInsuficientes,
    consultadoEm: coletas.length ? { de: coletas[0]!, ate: coletas[coletas.length - 1]! } : null,
    fora: { pecasSemProcesso, semEspelho, descartados, semDesfecho },
  };
}
