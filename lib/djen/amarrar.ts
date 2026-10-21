/**
 * Amarração da publicação com o caso do escritório — ticket 0006.E2.
 *
 * A spec é literal: "Publicação de processo desconhecido NÃO é descartada — vai
 * para uma caixa de 'não reconhecidas', que alguém olha. Descartar em silêncio é
 * como se perde prazo."
 *
 * ═══ POR QUE A CAIXA É COMPUTADA, E NÃO GRAVADA ═══
 *
 * `djen_publicacoes` (migration 9001) não tem `caso_id`, de propósito: a
 * amarração é derivável do que já está guardado (`numero_processo` dos dois
 * lados). Estado gravado envelhece — o escritório cadastra o caso DEPOIS da
 * publicação chegar, e uma caixa materializada continuaria acusando "não
 * reconhecida" até alguém reprocessar. Computada, a publicação sai da caixa
 * sozinha no momento em que o caso passa a existir.
 *
 * ═══ AS DUAS REGRAS QUE FALHAM FECHADO ═══
 *
 * 1. O casamento exige os 20 dígitos do padrão CNJ (Res. 65/2008) dos DOIS
 *    lados. Número curto, truncado ou lixo vai para a caixa — onde um humano
 *    olha — e nunca para um casamento por coincidência de dígitos.
 * 2. A organização participa do casamento. Mesmo número em organização
 *    diferente NÃO amarra: número de processo é público, e duas bancas podem
 *    atuar no mesmo processo. Amarrar cruzado seria mostrar a intimação de um
 *    escritório dentro do caso de outro.
 */

/** Os 20 dígitos da numeração única do CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO. */
export const DIGITOS_CNJ = 20;

export type CasoDoEscritorio = {
  id: string;
  organizationId: string;
  numeroProcesso: string | null;
};

export type PublicacaoAmarravel = {
  organizationId: string;
  numeroProcesso: string | null;
};

export type Amarracao<P extends PublicacaoAmarravel> = {
  /** Cada publicação com TODOS os casos que casaram — pode ser mais de um. */
  reconhecidas: Array<{ publicacao: P; casoIds: string[] }>;
  /** A caixa. Nada daqui foi descartado; alguém olha. */
  naoReconhecidas: P[];
};

/**
 * Só dígitos, preservando zeros à esquerda — `0001234...` comparado como número
 * perderia os zeros e casaria com o processo errado. `null` quando não sobrar
 * exatamente o tamanho do padrão CNJ: fora do padrão não se casa, se examina.
 */
export function chaveDeProcesso(numero: string | null | undefined): string | null {
  const digitos = (numero ?? "").replace(/\D/g, "");
  return digitos.length === DIGITOS_CNJ ? digitos : null;
}

export function amarra<P extends PublicacaoAmarravel>(
  publicacoes: P[],
  casos: CasoDoEscritorio[],
): Amarracao<P> {
  // organização + número → ids de caso. A organização na chave é a regra 2.
  const porProcesso = new Map<string, string[]>();
  for (const c of casos) {
    const chave = chaveDeProcesso(c.numeroProcesso);
    if (!chave) continue; // caso sem número válido não amarra ninguém
    const composta = `${c.organizationId}:${chave}`;
    const lista = porProcesso.get(composta);
    if (lista) lista.push(c.id);
    else porProcesso.set(composta, [c.id]);
  }

  const reconhecidas: Amarracao<P>["reconhecidas"] = [];
  const naoReconhecidas: P[] = [];

  for (const p of publicacoes) {
    const chave = chaveDeProcesso(p.numeroProcesso);
    const casoIds = chave ? porProcesso.get(`${p.organizationId}:${chave}`) : undefined;
    if (casoIds && casoIds.length > 0) reconhecidas.push({ publicacao: p, casoIds: [...casoIds] });
    else naoReconhecidas.push(p);
  }

  return { reconhecidas, naoReconhecidas };
}
