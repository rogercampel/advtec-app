/**
 * Minuta a partir do acervo — spec 0005.E1 (#33).
 *
 * Pedido → busca no acervo do escritório → texto que segue a estrutura e a
 * linguagem das peças dele. O que o código garante, e não o modelo:
 *
 *   - sem trecho no acervo, não há minuta e o modelo nem é chamado (critério 3).
 *     Minuta em que nenhum bloco se apoia num trecho também é "sem base";
 *   - `fontes` de um bloco são os trechos que o MODELO diz ter usado. O código
 *     confere que existem — não que o argumento está neles. Sem fonte, o bloco
 *     sai marcado como texto novo (critério 2);
 *   - CITAÇÃO SÓ PELO ACERVO (decisão do dono, 21/10/2026). Reconhecer citação em
 *     texto livre não fecha: duas travas por regra foram derrubadas pelo segundo
 *     leitor, para os dois lados. Então o modelo não escreve citação — escreve
 *     `[CITA T3: "frase copiada do trecho"]`, e o código só a põe na minuta se a
 *     frase estiver, literal, naquele trecho, com documento e página.
 *     O texto PRÓPRIO do modelo não pode ter cara de citação: frase com
 *     algarismo (fora a numeração de seção), com tribunal, súmula, precedente,
 *     relator, verbo de julgamento ("decidiu", "assentou") ou número por extenso
 *     vira a marca, no lugar dela — a menos que a frase inteira (6+ palavras)
 *     esteja escrita num trecho. Custa lacunas (até "art. 300 do CPC" fora de
 *     citação vira lacuna); é o preço escolhido;
 *   - a minuta declara que é rascunho (critério 7), e termina com o que faltou,
 *     que passa pela mesma regra.
 *
 * Limite conhecido, para a E3: nome de magistrado sem título e sem verbo de
 * julgamento ("Fulana entende que…") não é reconhecido.
 *
 * O acervo é o da organização de quem pede: a busca recorta por `organizationId`
 * (critério 9), e o modelo só vê os trechos que ela devolveu.
 */
import { z } from "zod";

import { normalizaParaCasar } from "@/lib/oab/travas";

import { buscaPorProblema, type Buscador, type TrechoDaPeca } from "./busca-por-problema";
import { jsonDoModelo, motivoDaFalha, type ChamadaDoModelo } from "./leitura-por-modelo";

export const AVISO_DA_MINUTA =
  "RASCUNHO escrito a partir do acervo do escritório. A revisão é do advogado: nada aqui foi protocolado, assinado ou enviado, e o texto marcado como novo não tem apoio em peça do escritório.";
export const SEM_BASE = "Não há base no acervo do escritório para esta peça. Nenhuma minuta foi escrita.";
export const MARCA_DO_RETIRADO = "[A COMPLETAR: trecho retirado — cita julgado, lei, número ou data sem fonte literal no acervo]";
export const FALTOU_RETIRADOS =
  "Há trechos retirados, marcados [A COMPLETAR]: citavam julgado, lei, número ou data sem fonte literal no acervo do escritório.";

/** Mais trechos que a pesquisa (8): a minuta precisa de estrutura, não só do argumento. */
export const TRECHOS_DA_MINUTA = 12;
/** Frase do modelo que é cópia do acervo passa — mas só com tamanho para não ser prefixo de outra citação. */
export const PALAVRAS_PARA_SER_COPIA = 6;
export const PALAVRAS_DA_CITACAO = { minimo: 3, maximo: 80 } as const;

export type FonteDaMinuta = { id: string; citacao: string; processo: string | null };
export type BlocoDaMinuta = {
  texto: string;
  /** Ids (`T1`…) dos trechos que o modelo diz ter usado e que existem; vazio = texto novo. */
  fontes: string[];
  novo: boolean;
};
export type RemovidasDaMinuta = {
  fonte_inexistente: number;
  /** Algarismo no texto próprio do modelo. */
  numero_no_texto: number;
  /** Tribunal, súmula, precedente, relator, verbo de julgamento, número por extenso. */
  cara_de_citacao: number;
  /** `[CITA …]` com trecho que não existe ou frase que não está nele. */
  cita_invalida: number;
  bloco_vazio: number;
};

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
- CITAÇÃO: para citar julgado, súmula, lei, artigo, doutrina ou qualquer número, copie a frase do trecho, palavra por palavra, assim: [CITA T3: "frase copiada do trecho"]. É a ÚNICA forma de citar. Fora dela, não escreva algarismo, número de processo ou recurso, nome de tribunal, súmula, tema, data ou valor.
- Não invente fato, nome, data ou valor do caso. Onde a peça precisaria de algo que os trechos não têm, escreva [A COMPLETAR: o que falta] e ponha o item em "faltou".
- Se os trechos não servem para a peça pedida, responda {"blocos": [], "faltou": ["por que não servem"]}.

Responda só JSON, sem comentário: {"blocos": [{"texto": "...", "fontes": ["T1"]}], "faltou": ["..."]}`;

const respostaDoModelo = z.object({
  blocos: z.array(z.object({ texto: z.string(), fontes: z.array(z.string()) })),
  faltou: z.array(z.string()),
});

/** Caractere de formatação (largura zero, direção…): some antes de qualquer conferência e da saída. */
const invisiveis = (s: string) => s.replace(/\p{Cf}/gu, "");

/** Forma de comparar: sem acento, minúscula, "S.T.J." → "stj", "A.I." → "ai". */
function forma(s: string): string {
  return normalizaParaCasar(invisiveis(s).normalize("NFKC")).replace(/\b(?:[a-z]\.\s?){2,}/g, (m) => `${m.replace(/[.\s]/g, "")} `);
}
const palavras = (s: string) => forma(s).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Cara de citação no texto PRÓPRIO do modelo. Não precisa ser completa sozinha:
 * o modelo tem o canal certo para citar (`[CITA …]`) e algarismo já basta para
 * retirar. Esta lista pega a citação sem número. Sigla curta que é palavra comum
 * ("a ré", "aí", "do CC") fica de fora — com número, o algarismo a pega.
 */
const CARA_DE_CITACAO = new RegExp(
  [
    // tribunais e órgãos julgadores
    "\\b(stj|stf|tst|tse|stm|trf\\d*|trt\\d*|tj ?[a-z]{2}|tj|tribuna(l|is)|supremo|pretorio|excels[oa]|corte (superior|especial|cidada|suprema)|(egregi[oa]|colend[oa]|excels[oa]) (corte|camara|turma|tribunal)|turmas?|camaras? (civel|criminal|de direito|reunidas)|(primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava) (turma|secao|camara)|plenario|orgao especial|colegiado)\\b",
    // o que se cita
    "\\b(precedentes?|acordaos?|arestos?|decisum|ementas?|jurisprudencia\\w*|sumulas?|enunciados?|repetitivos?|repercussao geral|informativos?|orientac(ao|oes) jurisprudencia\\w*|leading case|entendimento (consolidado|pacifico|majoritario|dominante|firmado)|pacificad\\w*)\\b",
    "\\bjulgados?\\b(?! (procedente|improcedente|parcialmente|extint))",
    // quem julga
    "\\b(relator(a|es|as)?|relatoria|ministr[oa]s?|min|desembargador\\w*|des\\.)(?![a-z])",
    // classes e recursos
    "\\b(resp|aresp|earesp|eresp|agrg|agint|edcl|hc|habeas corpus|mandado de seguranca|agravo (de instrumento|interno|regimental|em recurso)|pet|rcl|reclamacao constitucional|apelac(ao|oes) civ\\w*|rr|airr|adi|adc|ado|adpf|rms|rhc|irdr|iac|incidente de (resolucao|assuncao)|recurso (especial|extraordinario|de revista|ordinario|repetitivo)|embargos de (divergencia|declaracao))\\b",
    // verbo de julgamento
    "\\b(decidiu|decidiram|julgou|julgaram|assentou|assentaram|pacificou|pacificaram|consolidou|sumulou|firmou-se|fixou a tese|entendeu|entenderam|tem decidido|ja decidiu)\\b",
    // número por extenso que serve para montar número de recurso ou tema
    "\\b(cem|cento|duzent\\w*|trezent\\w*|quatrocent\\w*|quinhent\\w*|seiscent\\w*|setecent\\w*|oitocent\\w*|novecent\\w*|mil|milhao|milhoes|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove)\\b",
  ].join("|"),
);

/** Numeração de seção no começo da linha ("1.", "2.1)", "IV -", "a)") não é número citado. */
const NUMERACAO = /^\s*(?:\d{1,2}(?:\.\d{1,2})*|[IVXLCDM]{1,6}|[a-z])\s?[.)\-–]\s+/;

function copiaDoAcervo(frase: string, acervo: string[]): boolean {
  const p = palavras(frase);
  if (p.length < PALAVRAS_PARA_SER_COPIA) return false;
  const alvo = ` ${p.join(" ")} `;
  return acervo.some((a) => ` ${palavras(a).join(" ")} `.includes(alvo));
}

/** Por que o texto próprio do modelo não pode sair, ou `null`. */
export function motivoDoTexto(frase: string, acervo: string[]): "numero_no_texto" | "cara_de_citacao" | null {
  if (copiaDoAcervo(frase, acervo)) return null;
  if (/\d/.test(invisiveis(frase).normalize("NFKC"))) return "numero_no_texto";
  if (CARA_DE_CITACAO.test(forma(frase))) return "cara_de_citacao";
  return null;
}

/**
 * Unidades: cada `[…]` inteiro (citação ou lacuna) e o resto em frases. A frase
 * só termina em . ! ? seguido de maiúscula, e não depois de abreviatura.
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

const CITA = /^\[CITA\s+(T\d+)\s*:\s*["“]([\s\S]+?)["”]\s*\]$/i;
const literalEm = (frase: string, trecho: string) => {
  const n = (s: string) => invisiveis(s).normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return n(trecho).includes(n(frase));
};

type Contexto = { acervo: string[]; trechoDe: Map<string, { texto: string; citacao: string }>; removidas: RemovidasDaMinuta };

/** Uma unidade como sai na minuta, ou `null` se vira a marca. */
function unidadeNaMinuta(u: string, c: Contexto): string | null {
  const cita = u.match(CITA);
  if (cita || /^\[CITA\b/i.test(u)) {
    const t = cita ? c.trechoDe.get(cita[1]!.toUpperCase()) : undefined;
    const frase = cita?.[2]?.trim() ?? "";
    const n = frase.split(/\s+/).length;
    if (!t || n < PALAVRAS_DA_CITACAO.minimo || n > PALAVRAS_DA_CITACAO.maximo || !literalEm(frase, t.texto)) {
      c.removidas.cita_invalida += 1;
      return null;
    }
    return `“${invisiveis(frase)}” (${t.citacao})`;
  }
  // Lacuna do próprio modelo é texto dele: passa pela mesma regra ("[A COMPLETAR: citar o HC …]").
  const motivo = motivoDoTexto(u, c.acervo);
  if (motivo) {
    c.removidas[motivo] += 1;
    return null;
  }
  return invisiveis(u);
}

/** Confere linha a linha (a quebra de parágrafo fica); a unidade que não passa vira a marca, no lugar. */
function confere(texto: string, c: Contexto): { texto: string; retirou: boolean } {
  let retirou = false;
  // Citação copiada do PDF atravessa quebra de linha (medido no Luna): dentro de "[…]" a quebra vira espaço.
  const inteiro = invisiveis(texto).replace(/\[[^\]]*\]/g, (m) => m.replace(/\s*\n\s*/g, " "));
  const linhas = inteiro.split("\n").map((linha) => {
    const numeracao = linha.match(NUMERACAO)?.[0] ?? "";
    const saida: string[] = [];
    for (const u of unidades(linha.slice(numeracao.length))) {
      const ok = unidadeNaMinuta(u, c);
      if (ok !== null) saida.push(ok);
      else {
        retirou = true;
        if (saida[saida.length - 1] !== MARCA_DO_RETIRADO) saida.push(MARCA_DO_RETIRADO);
      }
    }
    const corpo = saida.join(" ").replace(/\]\s+([.,;:)])/g, "]$1");
    return corpo ? `${numeracao}${corpo}`.trimEnd() : numeracao.trim();
  });
  return { texto: linhas.join("\n").trim(), retirou };
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
  const c: Contexto = {
    acervo: trechos.map((t) => t.texto),
    trechoDe: new Map(fontes.map((f, i) => [f.id, { texto: trechos[i]!.texto, citacao: f.citacao }])),
    removidas: { fonte_inexistente: 0, numero_no_texto: 0, cara_de_citacao: 0, cita_invalida: 0, bloco_vazio: 0 },
  };
  let houveRetirada = false;

  const blocos: BlocoDaMinuta[] = [];
  for (const b of lido.data.blocos) {
    const pedidas = new Set(b.fontes);
    const validas = [...pedidas].filter((f) => c.trechoDe.has(f));
    c.removidas.fonte_inexistente += pedidas.size - validas.length;
    const { texto: conferido, retirou } = confere(b.texto, c);
    houveRetirada ||= retirou;
    if (conferido === "") {
      c.removidas.bloco_vazio += 1;
      continue;
    }
    blocos.push({ texto: conferido, fontes: validas, novo: validas.length === 0 });
  }

  // O que faltou é texto do modelo também — foi onde a primeira medição achou o REsp inventado.
  const faltou: string[] = [];
  for (const f of lido.data.faltou) {
    if (f.trim() === "") continue;
    const { texto: conferido, retirou } = confere(f, c);
    if (retirou) houveRetirada = true;
    else faltou.push(conferido);
  }
  if (houveRetirada) faltou.push(FALTOU_RETIRADOS);

  // Minuta do acervo precisa de ao menos um bloco apoiado nele que não seja só lacuna.
  if (!blocos.some((b) => !b.novo && semMarcas(b.texto) !== "")) return { situacao: "sem_base", mensagem: SEM_BASE, faltou };
  return { situacao: "minuta", aviso: AVISO_DA_MINUTA, blocos, faltou, fontes, removidas: c.removidas };
}
