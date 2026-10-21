/**
 * As três travas da pesquisa de tese — ticket 0004.E5. "Nenhum resultado chega
 * a advogado antes dela." (spec 0004)
 *
 *   1. Nada de jurisprudência externa (critério 5): citação de julgado que não
 *      está no acervo do escritório não sai, em forma nenhuma. A FRASE que a
 *      traz é retirada inteira — falha fechado.
 *   2. Tese do escritório não é jurisprudência (critério 6): o texto DO SISTEMA
 *      não chama o histórico do escritório de jurisprudência, entendimento
 *      consolidado, pacífico, majoritário ou dominante. O trecho LITERAL da peça
 *      pode ter essas palavras (advogado escreve assim) e não passa por esta
 *      trava: ele vem entre aspas, com a origem.
 *   3. Desfecho não é previsão (critério 7): a mesma trava da 0007.E6.
 *
 * O texto da tela é montado por código (`textoDaTese`) e passa pelas três.
 */
import { travaDaJurimetria } from "@/lib/datajud/trava";
import { normalizaParaCasar } from "@/lib/oab/travas";

import type { DesfechoDaTese } from "./desfecho-das-pecas";
import type { Tese } from "./tese";

/**
 * Forma de citação de julgado: sigla de recurso/ação de tribunal com número, ou
 * súmula com número. Casado na forma normalizada (sem acento, minúscula).
 */
const CITACAO_DE_JULGADO =
  /\b(resp|aresp|agrg|agint|edcl|eresp|re|are|ai|hc|rhc|ms|rms|adi|adpf|apelacao( civel)?|ap\.?( civel)?|agravo( de instrumento)?|ai)\s*(n[oº.]?\s*)?\d[\d.\-/]*\b|\bsumula( vinculante)?\s*(n[oº.]?\s*)?\d+/g;

/** A citação reduzida aos dígitos e à sigla: "REsp nº 1.234.567/SP" ≡ "resp 1234567". */
function chaveDaCitacao(c: string): string {
  const t = normalizaParaCasar(c);
  const sigla = t.match(/^[a-z]+( [a-z]+)?/)?.[0] ?? "";
  return `${sigla.split(" ")[0]}:${t.replace(/\D/g, "")}`;
}

export function citacoesDe(texto: string): string[] {
  return [...normalizaParaCasar(texto).matchAll(CITACAO_DE_JULGADO)].map((m) => m[0]);
}

/**
 * Trava 1. Tira toda frase que cita julgado ausente do acervo. Devolve o texto
 * limpo e as citações retiradas (para o log, nunca para a tela).
 */
export function retiraCitacoesExternas(texto: string, textosDoAcervo: string[]): { texto: string; retiradas: string[] } {
  const doAcervo = new Set(textosDoAcervo.flatMap(citacoesDe).map(chaveDaCitacao));
  const retiradas: string[] = [];
  const frases = texto.split(/(?<=[.!?;\n])\s+/);
  const ficam = frases.filter((f) => {
    const externas = citacoesDe(f).filter((c) => !doAcervo.has(chaveDaCitacao(c)));
    retiradas.push(...externas);
    return externas.length === 0;
  });
  return { texto: ficam.join(" ").trim(), retiradas };
}

/** Trava 2, sobre o texto do SISTEMA (nunca sobre o trecho literal da peça). */
const COMO_SE_FOSSE_JURISPRUDENCIA =
  /\b(jurisprudencia\w*|entendimento (consolidado|pacifico|majoritario|dominante|firmado)|(e|esta) pacificad\w*|posicao (majoritaria|dominante)|os tribunais (entendem|decidem|tem decidido)|orientacao (firme|pacifica))\b/;

export function travaDaTese(textoDoSistema: string): { liberado: boolean; motivos: string[] } {
  const motivos: string[] = [];
  const t = normalizaParaCasar(textoDoSistema);
  if (COMO_SE_FOSSE_JURISPRUDENCIA.test(t)) motivos.push("tese_como_jurisprudencia");
  if (citacoesDe(textoDoSistema).length > 0) motivos.push("citacao_no_texto_do_sistema");
  const j = travaDaJurimetria(textoDoSistema);
  if (!j.liberado) motivos.push(...j.violacoes.map((v) => v.motivo));
  return { liberado: motivos.length === 0, motivos };
}

/**
 * O texto da tela para uma tese. O enquadramento é do sistema, montado só com
 * números, e o teste de varredura prova que ele passa nas travas 2 e 3 — não há
 * dado de fora nele que justifique checar em tempo de execução. O trecho é
 * literal, entre aspas, com a citação de origem.
 */
export function textoDaTese(tese: Tese, desfecho: DesfechoDaTese | null): string {
  const n = tese.trechos.length;
  const enquadramento = [
    `Argumento já usado pelo escritório em ${n} ${n === 1 ? "trecho" : "trechos"} do acervo (histórico do escritório, não posição de tribunal).`,
    desfechoEmTexto(desfecho),
  ].filter(Boolean);
  const origens = tese.trechos.map((t) => t.citacao).join("; ");
  return [...enquadramento, `"${tese.representante.texto}"`, `Fontes: ${origens}.`].join("\n");
}

function desfechoEmTexto(d: DesfechoDaTese | null): string {
  if (!d || d.n === 0) return "Desfecho: nenhum processo destas peças com desfecho no espelho do DataJud.";
  const data = d.consultadoEm ? ` Consulta ao DataJud de ${d.consultadoEm.ate.slice(0, 10)}.` : "";
  const parte = (rotulo: string, c: { n: number; de: number; percentual: number | null }) =>
    c.percentual === null ? `${rotulo}: ${c.n} de ${c.de} processos` : `${rotulo}: ${c.percentual}% (${c.n} de ${c.de} processos)`;
  return [
    `Desfecho dos processos destas peças${d.casosInsuficientes ? " (casos insuficientes para percentual)" : ""}: `,
    [parte("procedência", d.procedencia), parte("improcedência", d.improcedencia), parte("procedência em parte", d.procedencia_parcial)].join("; "),
    ".",
    data,
  ].join("");
}
