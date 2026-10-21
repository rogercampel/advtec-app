/**
 * Minuta a partir do acervo — spec 0005.E1 (#33).
 *
 * Pedido → busca no acervo do escritório → texto que segue a estrutura e a
 * linguagem das peças dele. O que o código garante, e não o modelo:
 *
 *   - sem trecho no acervo, não há minuta e o modelo nem é chamado (critério 3).
 *     E minuta em que nenhum bloco se apoia num trecho também é "sem base":
 *     peça inteira escrita do zero não é minuta do acervo;
 *   - `fontes` de um bloco são os trechos que o MODELO diz ter usado. O código
 *     confere que existem e que os números e as menções a julgado do bloco estão
 *     neles — não que o argumento inteiro está lá. Sem fonte, o bloco sai marcado
 *     como texto novo (critério 2);
 *   - citação de julgado sem correspondência no acervo não sai (critério 4).
 *     Falha fechado, por frase: uma lista de formas proibidas sempre deixa passar
 *     a próxima grafia ("REsp n.º", "Tema 1.234", número CNJ…), então a regra é
 *     de APOIO — ver `motivoDaFrase`. A frase que não passa vira a marca, no
 *     mesmo lugar; o que faltou passa pela mesma regra;
 *   - a minuta declara que é rascunho (critério 7), e termina com o que faltou.
 *
 * O acervo é o da organização de quem pede: a busca recorta por `organizationId`
 * (critério 9), e o modelo só vê os trechos que ela devolveu.
 */
import { z } from "zod";

import { normalizaParaCasar } from "@/lib/oab/travas";

import { buscaPorProblema, type Buscador } from "./busca-por-problema";
import { jsonDoModelo, motivoDaFalha, numerosApoiados, numerosDe, type ChamadaDoModelo } from "./leitura-por-modelo";
import type { TrechoDaPeca } from "./busca-por-problema";

export const AVISO_DA_MINUTA =
  "RASCUNHO escrito a partir do acervo do escritório. A revisão é do advogado: nada aqui foi protocolado, assinado ou enviado, e o texto marcado como novo não tem apoio em peça do escritório.";
export const SEM_BASE = "Não há base no acervo do escritório para esta peça. Nenhuma minuta foi escrita.";
export const MARCA_DO_RETIRADO = "[A COMPLETAR: trecho retirado — cita julgado ou número que não está no acervo do escritório]";
export const FALTOU_JURISPRUDENCIA = "Jurisprudência ou número que o acervo do escritório não tem.";

/** Mais trechos que a pesquisa (8): a minuta precisa de estrutura, não só do argumento. */
export const TRECHOS_DA_MINUTA = 12;

export type FonteDaMinuta = { id: string; citacao: string; processo: string | null };
export type BlocoDaMinuta = {
  texto: string;
  /** Ids (`T1`…) dos trechos que o modelo diz ter usado e que existem; vazio = texto novo. */
  fontes: string[];
  novo: boolean;
};
export type RemovidasDaMinuta = { fonte_inexistente: number; numero_sem_apoio: number; julgado_sem_apoio: number; bloco_vazio: number };

export type Minuta =
  | {
      situacao: "minuta";
      aviso: typeof AVISO_DA_MINUTA;
      blocos: BlocoDaMinuta[];
      faltou: string[];
      fontes: FonteDaMinuta[];
      removidas: RemovidasDaMinuta;
    }
  | { situacao: "sem_base"; mensagem: typeof SEM_BASE; faltou: string[] }
  | { situacao: "falha"; codigo: string; motivo?: string };

export const SISTEMA_DA_MINUTA = `Você redige a MINUTA de uma peça jurídica para um advogado brasileiro, usando SÓ os trechos do acervo do escritório que vêm no pedido, numerados T1, T2…

Regras:
- Siga a estrutura e a linguagem desses trechos: é o jeito de escrever deste escritório.
- Divida a minuta em blocos (um parágrafo ou um título de seção cada).
- Em "fontes", liste os trechos em que o bloco se apoia. Bloco escrito sem apoio em trecho leva "fontes": [].
- Não cite julgado, súmula, acórdão ou número de processo que não esteja escrito num trecho. Não invente fato, nome, data ou valor do caso.
- Onde a peça precisaria de algo que os trechos não têm (fato do cliente, prova, jurisprudência), escreva no texto [A COMPLETAR: o que falta] e ponha o item em "faltou".
- Se os trechos não servem para a peça pedida, responda {"blocos": [], "faltou": ["por que não servem"]}.

Responda só JSON, sem comentário: {"blocos": [{"texto": "...", "fontes": ["T1"]}], "faltou": ["..."]}`;

const respostaDoModelo = z.object({
  blocos: z.array(z.object({ texto: z.string(), fontes: z.array(z.string()) })),
  faltou: z.array(z.string()),
});

/**
 * Menção a julgado ou a tribunal, na forma normalizada (sem acento, minúscula).
 * Não é a defesa principal — os números são —, é a rede para a citação sem
 * número ("precedente da Terceira Turma", "o STJ pacificou"). Sigla curta e
 * ambígua (re, ms, hc, ai, "tema" solto) fica de fora: com número, a regra dos
 * números a pega; sem número, ela seria a palavra comum ("a ré").
 */
const MENCAO_A_JULGADO = new RegExp(
  [
    "\\b(stj|stf|tst|tse|stm|trf\\d?|trt\\d*|tj[a-z]{2}|tribuna(l|is)|turmas?|camaras? (civel|criminal|de direito)|plenario|orgao especial|corte (superior|especial)|egregia|colenda)\\b",
    "\\b(precedentes?|acordaos?|julgados?|jurisprudencia\\w*|sumulas?|repetitivos?|repercussao geral|relator\\w*|rel\\.|min\\.|ministr[oa]s?|desembargador\\w*|informativos?|enunciados?|orientac(ao|oes) jurisprudencia\\w*|pacificad\\w*|entendimento (consolidado|pacifico|majoritario|dominante|firmado))",
    "\\b(resp|aresp|earesp|agrg|agint|edcl|eresp|rms|rhc|adi|adc|adpf|rcl|irdr|iac|oj|rr|airr|recurso (especial|extraordinario|de revista))\\b",
    "\\btema\\s*(n\\S*\\s*)?\\d",
  ].join("|"),
);

/** Números de 3 dígitos ou mais: o título "1. DOS FATOS" não é citação; "REsp 1.999.999" é. */
const numerosLongos = (s: string) => numerosDe(s).filter((n) => n.length >= 3);
const literal = (s: string) => normalizaParaCasar(s).replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Por que a frase não pode sair, ou `null`. `apoio` são os textos dos trechos
 * em que ela se apoia. Duas regras:
 *   - todo número de 3+ dígitos dela está nos trechos (número de recurso, tema,
 *     processo, data, valor — inventado, não tem onde estar);
 *   - se menciona julgado ou tribunal, a frase está escrita num dos trechos
 *     (comparação sem acento e sem pontuação). Paráfrase de citação não passa:
 *     falha fechado, o advogado completa.
 */
export function motivoDaFrase(frase: string, apoio: string[]): "numero_sem_apoio" | "julgado_sem_apoio" | null {
  const longos = numerosLongos(frase);
  if (longos.length > 0 && !numerosApoiados(longos.join(" "), ...apoio)) return "numero_sem_apoio";
  if (MENCAO_A_JULGADO.test(normalizaParaCasar(frase))) {
    const f = literal(frase);
    if (!apoio.some((a) => literal(a).includes(f))) return "julgado_sem_apoio";
  }
  return null;
}

/**
 * Unidades da conferência: cada "[A COMPLETAR …]" inteiro, e o resto em frases.
 * A frase só termina em . ! ? seguido de maiúscula — e não depois de abreviatura
 * de citação ("Rel. Min.", "j.", "n.", "art."): cortar ali deixaria o resto do
 * julgado inventado num pedaço sem a sigla.
 */
const ABREVIATURA = /\b(rel|min|des|j|n|nº|n\.º|art|arts|inc|al|fls?|pp?|dje|dj|cf|v|dr|dra|sr|sra|exmo|exma|s\.a|ltda)\.$/i;
export function unidades(texto: string): string[] {
  const out: string[] = [];
  for (const parte of texto.split(/(\[[^\]]*\])/)) {
    if (parte.startsWith("[") && parte.endsWith("]")) {
      out.push(parte);
      continue;
    }
    let atual = "";
    for (const pedaco of parte.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ"“])/)) {
      atual = atual ? `${atual} ${pedaco}` : pedaco;
      if (!ABREVIATURA.test(atual.trimEnd())) {
        out.push(atual);
        atual = "";
      }
    }
    if (atual) out.push(atual);
  }
  return out.map((u) => u.trim()).filter(Boolean);
}

/** Confere cada unidade; a que não passa vira a marca, no lugar dela (marcas seguidas viram uma). */
function confere(texto: string, apoio: string[], removidas: RemovidasDaMinuta): { texto: string; retirou: boolean } {
  const saida: string[] = [];
  let retirou = false;
  for (const u of unidades(texto)) {
    const motivo = motivoDaFrase(u, apoio);
    if (!motivo) {
      saida.push(u);
      continue;
    }
    removidas[motivo] += 1;
    retirou = true;
    if (saida[saida.length - 1] !== MARCA_DO_RETIRADO) saida.push(MARCA_DO_RETIRADO);
  }
  return { texto: saida.join(" "), retirou };
}

const semMarcas = (s: string) => s.replace(/\[A COMPLETAR[^\]]*\]/gi, "").trim();

export function pedidoDaMinuta(pedido: string, trechos: TrechoDaPeca[]): string {
  const acervo = trechos.map((t, i) => `[T${i + 1}] ${t.citacao}\n${t.texto}`).join("\n\n");
  return `PEÇA PEDIDA: ${pedido.trim()}\n\nTRECHOS DO ACERVO DO ESCRITÓRIO:\n\n${acervo}`;
}

export async function escreveMinuta(args: {
  buscar: Buscador;
  organizationId: string;
  fontesDoAcervo: string[];
  pedido: string;
  chamar: ChamadaDoModelo;
}): Promise<Minuta> {
  const busca = await buscaPorProblema(args.buscar, {
    organizationId: args.organizationId,
    fontesDoAcervo: args.fontesDoAcervo,
    problema: args.pedido,
    trechos: TRECHOS_DA_MINUTA,
  });
  if (busca.situacao === "falha") return { situacao: "falha", codigo: busca.codigo };
  if (busca.situacao === "nada_no_acervo") return { situacao: "sem_base", mensagem: SEM_BASE, faltou: [] };

  const trechos = busca.trechos;
  let texto: string;
  try {
    ({ texto } = await args.chamar({ system: SISTEMA_DA_MINUTA, user: pedidoDaMinuta(args.pedido, trechos) }));
  } catch (e) {
    return { situacao: "falha", codigo: "modelo", motivo: motivoDaFalha(e) };
  }
  const lido = respostaDoModelo.safeParse(jsonDoModelo(texto));
  if (!lido.success) return { situacao: "falha", codigo: "formato" };

  const fontes: FonteDaMinuta[] = trechos.map((t, i) => ({ id: `T${i + 1}`, citacao: t.citacao, processo: t.processo }));
  const textoDe = new Map(fontes.map((f, i) => [f.id, trechos[i]!.texto]));
  const todos = trechos.map((t) => t.texto);
  const removidas: RemovidasDaMinuta = { fonte_inexistente: 0, numero_sem_apoio: 0, julgado_sem_apoio: 0, bloco_vazio: 0 };
  let faltaJurisprudencia = false;

  const blocos: BlocoDaMinuta[] = [];
  for (const b of lido.data.blocos) {
    const pedidas = new Set(b.fontes);
    const validas = [...pedidas].filter((f) => textoDe.has(f));
    removidas.fonte_inexistente += pedidas.size - validas.length;
    // Bloco com fonte se confere contra ELA; texto novo, contra o acervo lido inteiro.
    const apoio = validas.length > 0 ? validas.map((f) => textoDe.get(f)!) : todos;
    const { texto: conferido, retirou } = confere(b.texto.trim(), apoio, removidas);
    faltaJurisprudencia ||= retirou;
    if (conferido === "") {
      removidas.bloco_vazio += 1;
      continue;
    }
    blocos.push({ texto: conferido, fontes: validas, novo: validas.length === 0 });
  }

  // O que faltou é texto do modelo também, e foi onde a medição achou o REsp inventado.
  const faltou: string[] = [];
  for (const f of lido.data.faltou) {
    const item = f.trim();
    if (item === "") continue;
    const { texto: conferido, retirou } = confere(item, todos, removidas);
    if (retirou) faltaJurisprudencia = true;
    else faltou.push(conferido);
  }
  if (faltaJurisprudencia) faltou.push(FALTOU_JURISPRUDENCIA);

  // Minuta do acervo precisa de ao menos um bloco apoiado nele que não seja só lacuna.
  if (!blocos.some((b) => !b.novo && semMarcas(b.texto) !== "")) return { situacao: "sem_base", mensagem: SEM_BASE, faltou };
  return { situacao: "minuta", aviso: AVISO_DA_MINUTA, blocos, faltou, fontes, removidas };
}
