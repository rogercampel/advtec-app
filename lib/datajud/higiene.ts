/**
 * Higiene do espelho: o que pode entrar em estatística, e o que sai contado.
 *
 * A E1 guarda o que a fonte mandou, inclusive o lixo — fidelidade. Esta etapa é
 * a outra metade: decidir o que **não** entra numa conta, e devolver o tamanho
 * do que foi tirado.
 *
 * ═══ POR QUE O DESCARTE VEM COM O NÚMERO ═══
 *
 * Descartar em silêncio transforma base suja em estatística bonita. A spec 0007
 * exige o N ao lado de todo número (critério 1) e a contagem de descartados no
 * resultado (critério 2) — porque o advogado precisa saber se o "42% de
 * procedência" saiu de 900 processos ou de 900 menos 600 que ninguém contou.
 *
 * ═══ A DECISÃO DE SIGILO, ESCRITA POR EXTENSO ═══
 *
 * `nivelSigilo` **nulo** é tratado como NÃO PÚBLICO e sai da estatística.
 *
 * É o lado seguro e é uma escolha, não um detalhe: nulo significa que a fonte
 * não disse, e "não disse" não é "é público". Incluir por omissão colocaria
 * processo sob segredo de justiça numa conta que o escritório mostra ao
 * cliente. O custo do lado errado é uma estatística menor; o custo do outro
 * lado é sigilo quebrado.
 *
 * Se isso derrubar amostra demais na prática, o conserto é medir quantos vêm
 * nulos no DataJud — não afrouxar a regra por conveniência.
 */

/** O mínimo que uma linha precisa ter para ser julgada. Serve à linha do banco. */
export type ParaEstatistica = {
  data_ajuizamento: string | null;
  data_ajuizamento_bruto: string | null;
  nivel_sigilo: number | null;
};

export type Descartes = {
  /** `nivelSigilo` diferente de 0, ou ausente. Critério 7. */
  sigilo: number;
  /** Data legível e absurda — 1888, ou futuro. Critério 2. */
  dataImpossivel: number;
  /** Veio bruto e não deu para interpretar: sinal de formato trocado. */
  dataIlegivel: number;
};

export type Resultado<T> = {
  limpos: T[];
  descartados: Descartes;
  /** Quantos entraram. É o denominador de qualquer percentual daqui pra frente. */
  total: number;
  /**
   * Sem data nenhuma — a fonte não mandou o campo.
   *
   * NÃO é descarte: ausência não é sujeira, e a linha continua servindo a
   * estatística que não depende de data (desfecho por órgão, por exemplo). Fica
   * visível para quem for calcular TEMPO saber que não pode usar estas.
   */
  semData: number;
};

/** Antes disto não existe processo eletrônico. */
export const ANO_MINIMO_PLAUSIVEL = 1990;

/** Público é `0`. Nulo NÃO é público — ver o cabeçalho. */
export function ePublico(nivelSigilo: number | null): boolean {
  return nivelSigilo === 0;
}

export function eDataImpossivel(iso: string | null, hoje = new Date()): boolean {
  if (!iso) return false;
  const ano = Number(iso.slice(0, 4));
  if (!Number.isFinite(ano)) return true;
  return ano < ANO_MINIMO_PLAUSIVEL || ano > hoje.getFullYear() + 1;
}

/** Bruto chegou, interpretado não saiu: formato que a gente não conhece. */
export function eDataIlegivel(iso: string | null, bruto: string | null): boolean {
  return iso === null && (bruto ?? "").trim() !== "";
}

/**
 * Separa o que entra na conta do que sai, contando cada motivo.
 *
 * A ordem dos testes importa para o número, não para o resultado: uma linha
 * sigilosa COM data impossível conta uma vez só, no primeiro motivo. Somar os
 * descartes tem de dar o total tirado, senão a tabela do advogado não fecha.
 */
export function higieniza<T extends ParaEstatistica>(
  linhas: T[],
  opcoes: { hoje?: Date } = {},
): Resultado<T> {
  const hoje = opcoes.hoje ?? new Date();
  const descartados: Descartes = { sigilo: 0, dataImpossivel: 0, dataIlegivel: 0 };
  const limpos: T[] = [];
  let semData = 0;

  for (const l of linhas) {
    if (!ePublico(l.nivel_sigilo)) {
      descartados.sigilo += 1;
      continue;
    }
    if (eDataIlegivel(l.data_ajuizamento, l.data_ajuizamento_bruto)) {
      descartados.dataIlegivel += 1;
      continue;
    }
    if (eDataImpossivel(l.data_ajuizamento, hoje)) {
      descartados.dataImpossivel += 1;
      continue;
    }
    if (l.data_ajuizamento === null) semData += 1;
    limpos.push(l);
  }

  return { limpos, descartados, total: limpos.length, semData };
}

/** Soma dos descartes. Existe para a tabela do advogado fechar na conferência. */
export function totalDescartado(d: Descartes): number {
  return d.sigilo + d.dataImpossivel + d.dataIlegivel;
}
