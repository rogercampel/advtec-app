/**
 * Minuta a partir do acervo — spec 0005.E1 (#33).
 *
 * Pedido → busca no acervo do escritório → texto que segue a estrutura e a
 * linguagem das peças dele. O que o código garante, e não o modelo:
 *
 *   - sem trecho no acervo, não há minuta e o modelo nem é chamado (critério 3).
 *     Minuta em que o modelo não apoia nenhum bloco num trecho também é "sem
 *     base". Se havia base e a trava retirou texto, a minuta sai com as marcas —
 *     cada uma diz por quê; "sem base" ali seria mentira;
 *   - `fontes` de um bloco são os trechos que o MODELO diz ter usado. O código
 *     confere que existem — não que o argumento está neles. Sem fonte, o bloco
 *     sai marcado como texto novo (critério 2);
 *   - CITAÇÃO SÓ PELO ACERVO (decisão do dono, 21/10/2026). Reconhecer citação em
 *     texto livre não fecha: três revisões derrubaram travas por regra, para os
 *     dois lados. Então o modelo não escreve citação — escreve
 *     `[CITA T3: "frase"]`, e o código só a põe na minuta, entre aspas e com
 *     documento e página, se ela for UMA OU MAIS FRASES INTEIRAS daquele trecho —
 *     e imprime a grafia do ACERVO, não a do modelo. Frase inteira, e não pedaço:
 *     pedaço deixava passar "Súmula 30" tirado de "Súmula 302" e a tese sem o
 *     "Não" que a negava. O início e o fim do trecho não contam como limite de
 *     frase, porque o trecho é um pedaço cortado em qualquer ponto;
 *   - o texto PRÓPRIO do modelo é uma rede, não a garantia: frase com algarismo
 *     (fora a numeração de seção) ou com cara de citação (`LINHAS_DE_CITACAO`)
 *     vira a marca, no lugar. Nome de peça ("apelação cível"), endereçamento
 *     ("Egrégio Tribunal", "Desembargador Relator") e "julgado procedente" passam;
 *   - a minuta declara que é rascunho (critério 7), e termina com o que faltou,
 *     que passa pela mesma regra.
 *
 * Limite declarado, para a E3: atribuição a pessoa só pelo nome, sem título nem
 * tribunal ("como decidiu Fulana"). Pegá-la pela palavra "decidiu" cortava "a ré
 * decidiu cancelar o contrato".
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
  /** Uma das `LINHAS_DE_CITACAO`, ou letra de outro alfabeto. */
  cara_de_citacao: number;
  /** `[CITA …]` com trecho que não existe, ou frase que não é frase inteira dele. */
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
- CITAÇÃO: para citar julgado, súmula, lei, artigo, doutrina ou qualquer número, copie do trecho uma ou mais FRASES INTEIRAS (do começo da frase até o ponto), palavra por palavra, assim: [CITA T3: "frase inteira copiada do trecho."]. É a ÚNICA forma de citar. Fora dela, não escreva algarismo, número de processo ou recurso, nome de tribunal, súmula, tema, data ou valor.
- Não invente fato, nome, data ou valor do caso. Onde a peça precisaria de algo que os trechos não têm, escreva [A COMPLETAR: o que falta] e ponha o item em "faltou".
- Se os trechos não servem para a peça pedida, responda {"blocos": [], "faltou": ["por que não servem"]}.

Responda só JSON, sem comentário: {"blocos": [{"texto": "...", "fontes": ["T1"]}], "faltou": ["..."]}`;

const respostaDoModelo = z.object({
  blocos: z.array(z.object({ texto: z.string(), fontes: z.array(z.string()) })),
  faltou: z.array(z.string()),
});

/** Caractere de formatação (largura zero, direção…): some antes de qualquer conferência e da saída. */
const invisiveis = (s: string) => s.replace(/\p{Cf}/gu, "");

/** Forma de procurar cara de citação: sem acento, minúscula. */
const forma = (s: string) => normalizaParaCasar(invisiveis(s).normalize("NFKC"));
/**
 * Sigla de tribunal soletrada em letras soltas ("S T J", "o S. T. J."). As letras
 * se juntam numa corrida só — o artigo antes entra junto ("ostj") —, então a
 * sigla é procurada DENTRO da corrida.
 */
function siglaSoletrada(s: string): boolean {
  const corridas = normalizaParaCasar(invisiveis(s).normalize("NFKC")).match(/\b[a-z](?:[.\s]+[a-z]\b)+/g) ?? [];
  return corridas.some((c) => /stj|stf|tst|tse|stm|trf|trt|tj/.test(c.replace(/[.\s]/g, "")));
}

const NUMERO_POR_EXTENSO =
  "(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzent\\w*|trezent\\w*|quatrocent\\w*|quinhent\\w*|seiscent\\w*|setecent\\w*|oitocent\\w*|novecent\\w*|mil|milhao|milhoes)";
const ROMANO = "(?=[mdclxvi]+\\b)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})";
/** Nome do que se cita por número. "re", "ai" e "ms" ficam de fora aqui: são palavras ("a ré"); ver `SIGLA_COM_NUMERO`. */
const O_QUE_SE_CITA_POR_NUMERO =
  "(temas?|sumulas?|verbetes?|enunciados?|informativos?|resp|aresp|earesp|eresp|agrg|agint|edcl|hc|habeas corpus|mandado de seguranca|rms|rhc|rcl|reclamacao|pet|adi|adc|ado|adpf|irdr|iac|rr|airr|apelac(ao|oes)( civel)?|agravo( de instrumento| interno| regimental)?|embargos( de divergencia| de declaracao)?|recurso (especial|extraordinario|de revista|ordinario)|processo|autos)";

/**
 * Cara de citação no texto PRÓPRIO do modelo, na `forma` (sem acento, minúscula).
 * Uma linha por família, para a mutação provar cada uma. Algarismo já é pego antes;
 * estas pegam a citação sem algarismo.
 */
export const LINHAS_DE_CITACAO: Record<string, string> = {
  tribunal: "\\b(stj|stf|tst|tse|stm|trf|trt|tj|tj ?[a-z]{2}|supremo|pretorio|excelso|corte (superior|especial|cidada|suprema)|(superior|suprema|alta) corte|(os|nossos|demais) tribunais|plenario|orgao especial|orgao julgador|secao de direito|grupo de camaras|turma (recursal|julgadora)|(primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava|nona|decima) (turma|secao|camara))\\b",
  o_que_se_cita: "\\b(precedentes?|arestos?|decisum|ementas?|jurisprudencia\\w*|sumulas?|verbetes?|repetitivos?|repercussao geral|orientac(ao|oes) jurisprudencia\\w*|leading case|entendimento (consolidado|pacifico|majoritario|dominante|firmado)|pacificad\\w*)\\b",
  julgados:
    "\\bjulgados\\b|(?<!transito em )\\bjulgado (do|da|no|na|proferido|paradigma|recente)\\b|\\b(nesse|neste|naquele|referido|citado|mencionado|aludido|no|pelo) julgado\\b",
  quem_julga: "\\b(rel\\.|relatoria|min\\.|des\\.|dje|j\\. em)|\\bvoto (do|da) (ministr|desembargador|relator)",
  numero_por_extenso: `\\b${O_QUE_SE_CITA_POR_NUMERO}\\s+(n\\S*\\s+|numero\\s+)?(${NUMERO_POR_EXTENSO}|${ROMANO})\\b`,
  doutrina: "\\b(leciona|lecionam|preleciona|prelecionam|doutrina\\w*|magisterio de|na licao de|ensinamento de)\\b",
  caso_nomeado: "\\b(caso|leading case) \\w+ (contra|versus|vs|x)\\b",
  artigo_por_extenso: "\\bart(igo|\\.)? (primeiro|segundo|terceiro|quarto|quinto|sexto|setimo|oitavo|nono|decimo|vigesimo|centesimo)\\b",
  tribunal_que_decide:
    "\\b(tribuna(l|is)|cortes?|turmas?|camaras?|secao|plenario|pleno)\\b.*\\b(decidiu|decidiram|decide|decidem|entende|entendem|entendeu|entenderam|afirmou|afirmaram|destacou|ressaltou|registrou|julgou|julgaram|afastou|afastaram|reconheceu|reconheceram|firmou|fixou|assentou|pacificou|consolidou|sumulou)\\b",
};
const CARA_DE_CITACAO = new RegExp(Object.values(LINHAS_DE_CITACAO).join("|"));
/** Na grafia original: sigla que também é palavra só conta em maiúscula e com número por extenso ou romano ("RE nove"). */
const SIGLA_COM_NUMERO = new RegExp(`\\b(RE|ARE|AI|MS|Ap\\.?)\\s+(n\\S*\\s+)?(${NUMERO_POR_EXTENSO}|[MDCLXVI]+)\\b`, "i");
const SIGLA_EM_MAIUSCULA = /\b(RE|ARE|AI|MS)\b/;
/** Na grafia original: título seguido de nome próprio ("Ministro Fulano"), não de outro título ("Desembargador Relator"). */
const TITULO_COM_NOME =
  /\b(Ministr[oa]|Desembargador[a]?|Relator[a]?)\s+(?!Relator|Relatora|Presidente|Revisor|Revisora)\p{Lu}\p{Ll}+/u;
/** Letra grega ou cirílica no meio de texto em português é disfarce ("SТJ" com T cirílico). */
const OUTRO_ALFABETO = /[Ͱ-ϿЀ-ԯ]/;

/**
 * Forma literal, linha a linha: sem invisível, minúscula, sem aspas, espaço único e
 * nenhum espaço em volta de pontuação (o PDF põe "n . º"). A quebra de linha fica.
 */
const ASPA = /["“”'‘’]/;
const PONTUACAO = /[.,;:!?()[\]/\\ºª°\-–—]/;
type Literal = { texto: string; origem: number[] };
/**
 * A forma literal de uma linha e, para cada caractere dela, a posição de onde ele
 * veio na linha original — é o que deixa imprimir o trecho VALIDADO, e não "a
 * primeira coisa parecida" (segunda revisão Sonnet: "Dizem que a cláusula é
 * válida? … A cláusula é válida." imprimia a pergunta).
 */
function linhaLiteral(linha: string, base: number): Literal {
  const texto: string[] = [];
  const origem: number[] = [];
  let espaco = -1;
  for (let i = 0; i < linha.length; ) {
    const ch = String.fromCodePoint(linha.codePointAt(i)!);
    if (ASPA.test(ch)) {
      i += ch.length;
      continue;
    }
    if (/\s/.test(ch)) {
      if (espaco < 0) espaco = i;
      i += ch.length;
      continue;
    }
    if (espaco >= 0 && texto.length > 0 && !PONTUACAO.test(ch) && !PONTUACAO.test(texto[texto.length - 1]!)) {
      texto.push(" ");
      origem.push(base + espaco);
    }
    espaco = -1;
    // Uma entrada de `origem` por UNIDADE de texto (o texto corrido é indexado por
    // unidade): emoji são duas, e contar uma deslocava o recorte (revisão Sonnet).
    // "İ" vira dois caracteres em minúscula: os dois apontam para a mesma origem.
    for (const c of ch.toLowerCase()) {
      texto.push(c);
      for (let u = 0; u < c.length; u++) origem.push(base + i + Math.min(u, ch.length - 1));
    }
    i += ch.length;
  }
  return { texto: texto.join(""), origem };
}
/** Texto em NFC (e não NFKC: NFKC troca "º" por "o", e a citação sai com o caractere do acervo). */
const nfc = (s: string) => invisiveis(s).normalize("NFC");
/** Forma literal: minúscula, sem aspas, espaço único, nenhum espaço em volta de pontuação (o PDF põe "n . º"). */
function literal(s: string): string {
  return nfc(s)
    .split(/\r?\n/)
    .map((l) => linhaLiteral(l, 0).texto)
    .join("\n");
}
const semFinal = (s: string) => s.replace(/[.;:!?]+$/, "");
const FIM_DE_FRASE = /[.;:!?]/;

/**
 * Onde uma frase pode começar em `texto`: depois de . ; : ! ? que não esteja
 * entre algarismos ("1.234" não termina frase — senão "Conforme o REsp 1." seria
 * frase inteira); e depois de quebra de linha só quando a linha anterior termina
 * em pontuação ou é título (toda em maiúscula). Quebra no meio de frase — o PDF
 * faz isso o tempo todo — NÃO é começo.
 *
 * O INÍCIO do texto não é começo de frase: o trecho do acervo é um pedaço de
 * `fatia` (lib/acervo/fatiar.ts), cortado a cada ~1800 caracteres em qualquer
 * ponto. Tratar o corte como começo deixava citar "a cláusula é válida" de "Não é
 * verdade que | a cláusula é válida". A primeira frase do pedaço fica de fora; a
 * sobreposição entre pedaços a traz inteira no pedaço anterior.
 */
function comecosDeFrase(texto: string): { original: string; corrido: string; origem: number[]; comecos: Set<number> } {
  const original = nfc(texto);
  const linhasOriginais = original.split("\n");
  const comecos = new Set<number>();
  let corrido = "";
  const origem: number[] = [];
  let base = 0;
  linhasOriginais.forEach((bruta, i) => {
    const sem = bruta.replace(/\r$/, "");
    const l = linhaLiteral(sem, base);
    const anterior = (linhasOriginais[i - 1] ?? "").trim();
    const titulo = anterior !== "" && anterior === anterior.toUpperCase() && /\p{Lu}/u.test(anterior);
    if (i > 0) {
      corrido += " "; // a quebra de linha vira espaço no texto corrido
      origem.push(base - 1);
      if (titulo || FIM_DE_FRASE.test(anterior.slice(-1))) comecos.add(corrido.length);
    }
    const pos = corrido.length;
    for (let k = 0; k < l.texto.length; k++) {
      if (FIM_DE_FRASE.test(l.texto[k]!) && !/\d/.test(l.texto[k + 1] ?? "")) comecos.add(pos + k + 1);
    }
    corrido += l.texto;
    origem.push(...l.origem);
    base += bruta.length + 1;
  });
  return { original, corrido, origem, comecos };
}

/**
 * O trecho do ACERVO que é a `frase` em frases INTEIRAS e seguidas — na grafia de
 * lá (caixa, aspas internas, pontuação final), recortado da ocorrência validada.
 * `null` se a frase não é frases inteiras do texto.
 */
export function grafiaDoAcervo(frase: string, texto: string): string | null {
  const alvo = semFinal(literal(frase).replace(/\n/g, " "));
  if (alvo === "") return null;
  const { original, corrido, origem, comecos } = comecosDeFrase(texto);
  for (const c of comecos) {
    if (!corrido.startsWith(alvo, c)) continue;
    // Termina onde a próxima frase começa: pontuação que não é ponto de milhar, ou fim de
    // linha antes de começo. O FIM do texto, sozinho, não basta — o pedaço pode ter sido
    // cortado no meio da frase.
    let fim = c + alvo.length;
    if (!comecos.has(fim + 1)) continue;
    while (FIM_DE_FRASE.test(corrido[fim] ?? "")) fim++; // a pontuação final de lá ("?" fica "?")
    const recorte = original
      .slice(origem[c]!, origem[fim - 1]! + 1)
      .replace(/\s+/g, " ")
      .replace(/["”’']+(?=[.;:!?]*$)/u, "") // aspa de fechamento antes do ponto ("válida".) sem a de abertura
      .trim();
    if (recorte !== "") return recorte;
  }
  return null;
}

/** `frase` é uma ou mais frases INTEIRAS e seguidas de `texto`. */
export const frasesInteirasDe = (frase: string, texto: string): boolean => grafiaDoAcervo(frase, texto) !== null;

/**
 * Por que o texto próprio do modelo não pode sair, ou `null`. Não há exceção para
 * "cópia do acervo": frase copiada sem `[CITA]` sairia sem aspas e sem fonte — fato
 * de outro cliente virava fato do caso.
 */
export function motivoDoTexto(frase: string): "numero_no_texto" | "cara_de_citacao" | null {
  const limpa = invisiveis(frase).normalize("NFKC");
  if (/\p{Nd}/u.test(limpa)) return "numero_no_texto";
  if (OUTRO_ALFABETO.test(limpa) || CARA_DE_CITACAO.test(forma(frase)) || siglaSoletrada(frase)) return "cara_de_citacao";
  if (TITULO_COM_NOME.test(limpa) || (SIGLA_EM_MAIUSCULA.test(limpa) && SIGLA_COM_NUMERO.test(forma(frase)))) return "cara_de_citacao";
  return null;
}

/**
 * Unidades: cada `[…]` sem colchete dentro (citação ou lacuna) e o resto em
 * frases. A frase só termina em . ! ? seguido de maiúscula, e não depois de
 * abreviatura. Um "[CITA …]" dentro de "[A COMPLETAR: …]" sai como unidade própria.
 */
const ABREVIATURA = /\b(rel|min|des|j|n|nº|n\.º|art|arts|inc|al|fls?|pp?|dje|dj|cf|v|dr|dra|sr|sra|exmo|exma|s\.a|ltda)\.$/i;
export function unidades(texto: string): string[] {
  const out: string[] = [];
  for (const parte of texto.split(/(\[[^[\]]*\])/)) {
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

type Contexto = { trechoDe: Map<string, { texto: string; citacao: string }>; removidas: RemovidasDaMinuta };

/** Uma unidade como sai na minuta, ou `null` se vira a marca. */
function unidadeNaMinuta(u: string, c: Contexto): string | null {
  if (/^\[CITA\b/i.test(u)) {
    const cita = u.match(CITA);
    const t = cita ? c.trechoDe.get(cita[1]!.toUpperCase()) : undefined;
    const frase = invisiveis(cita?.[2]?.trim() ?? "");
    const grafia = t ? grafiaDoAcervo(frase, t.texto) : null;
    if (!t || !grafia) {
      c.removidas.cita_invalida += 1;
      return null;
    }
    return `“${grafia}” (${t.citacao})`;
  }
  // Lacuna do próprio modelo é texto dele: passa pela mesma regra ("[A COMPLETAR: citar o HC …]").
  const motivo = motivoDoTexto(u);
  if (motivo) {
    c.removidas[motivo] += 1;
    return null;
  }
  return invisiveis(u);
}

/** Numeração de seção no começo da linha ("1.", "2.1)", "IV -", "a)") não é número citado. */
const NUMERACAO = /^\s*(?:\d{1,2}(?:\.\d{1,2})*|[IVXLCDM]{1,6}|[a-z])\s?[.)\-–]\s+/;

/** Confere linha a linha (a quebra de parágrafo fica); a unidade que não passa vira a marca, no lugar. */
function confere(texto: string, c: Contexto): { texto: string; retirou: boolean } {
  let retirou = false;
  // Citação copiada do PDF atravessa quebra de linha (medido no Luna): dentro de "[…]" a quebra vira espaço.
  const inteiro = invisiveis(texto).replace(/\[[^\]]*\]/g, (m) => m.replace(/\s*\n\s*/g, " "));
  let anterior = "";
  const linhas = inteiro.split("\n").map((linha) => {
    // Numeração só começa linha depois de linha vazia ou terminada em pontuação:
    // senão "o Tema\n12. Logo…" esconderia o número na numeração.
    const podeNumerar = anterior.trim() === "" || /[.:;!?)\]]$/.test(anterior.trim());
    anterior = linha;
    const numeracao = podeNumerar ? (linha.match(NUMERACAO)?.[0] ?? "") : "";
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

  // O que faltou é texto do modelo também — foi onde a primeira medição achou o REsp
  // inventado. O item fica, com a marca no lugar do que saiu.
  const faltou: string[] = [];
  for (const f of lido.data.faltou) {
    if (f.trim() === "") continue;
    const { texto: conferido, retirou } = confere(f, c);
    houveRetirada ||= retirou;
    if (conferido !== "") faltou.push(conferido);
  }
  if (houveRetirada) faltou.push(FALTOU_RETIRADOS);

  // "Sem base" é quando o MODELO não apoiou nada no acervo. Se apoiou e a trava
  // retirou texto, a minuta sai com as marcas — dizer "sem base" seria mentir.
  if (!blocos.some((b) => !b.novo)) return { situacao: "sem_base", mensagem: SEM_BASE, faltou };
  return { situacao: "minuta", aviso: AVISO_DA_MINUTA, blocos, faltou, fontes, removidas: c.removidas };
}
