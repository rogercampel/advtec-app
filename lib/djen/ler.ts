/**
 * Leitura da publicação — ticket 0006.E3. "Do texto sai: tipo de ato, se há
 * prazo, qual o prazo em dias, e se é dia útil ou corrido. Cada extração vem
 * com o TRECHO EXATO do texto que a fundamentou." (spec 0006, mudança 3)
 *
 * ═══ MEDIDO EM 24/08/2026, 100 PUBLICAÇÕES REAIS ═══
 *
 *   - 44/100 vêm com HTML dentro do `texto`: tags e entidades
 *     (`&oacute;`, `&sect;`, `&nbsp;`). Extrair sobre o cru casaria
 *     "prazo&nbsp;de" com nada.
 *   - O prazo aparece em CINCO formatos: "15 (quinze) dias",
 *     "quinze (15) dias", "Prazo: 15 dias", "Prazo 05 dias" e
 *     "quinze dias" só por extenso.
 *   - Existe prazo POR REMISSÃO, sem número nenhum: "decorreu o prazo
 *     previsto no §2º do art. 903 do CPC". Ignorar seria dizer "sem prazo"
 *     sobre um texto que fala de prazo — o achado sai com `dias: null`.
 *
 * ═══ O QUE É O "TRECHO EXATO" ═══
 *
 * Um recorte literal do TEXTO LEGÍVEL — a publicação com tags removidas e
 * entidades decodificadas, que é o que qualquer tela mostra ao advogado. O
 * recorte do HTML cru (o prazo no meio de `&nbsp;` e `<br>`) não é conferível
 * por gente. `legivel()` é determinística sobre o texto guardado, então o
 * trecho continua reproduzível.
 *
 * ═══ O QUE ESTE MÓDULO NÃO FAZ ═══
 *
 * Não conta prazo (E4), não decide urgência e não confirma nada — o sistema
 * sugere, o advogado confirma. E extração sem trecho não existe POR TIPO:
 * todo achado carrega o recorte que o fundamentou.
 */

/** Entidades vistas na amostra real, mais as vogais acentuadas do português. */
const ENTIDADES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  sect: "§",
  ordm: "º",
  ordf: "ª",
  aacute: "á", agrave: "à", atilde: "ã", acirc: "â",
  eacute: "é", ecirc: "ê",
  iacute: "í",
  oacute: "ó", otilde: "õ", ocirc: "ô",
  uacute: "ú", uuml: "ü",
  ccedil: "ç",
  Aacute: "Á", Agrave: "À", Atilde: "Ã", Acirc: "Â",
  Eacute: "É", Ecirc: "Ê",
  Iacute: "Í",
  Oacute: "Ó", Otilde: "Õ", Ocirc: "Ô",
  Uacute: "Ú",
  Ccedil: "Ç",
};

/**
 * O texto como uma tela o mostraria: sem tags, entidades decodificadas,
 * espaço colapsado. Todo trecho devolvido por este módulo é substring disto.
 * Entidade desconhecida fica como veio — inventar é pior que mostrar.
 */
export function legivel(texto: string): string {
  return texto
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (todo, nome: string) => ENTIDADES[nome] ?? todo)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sombra de comparação, PRESERVANDO o comprimento: cada caractere vira a sua
 * base sem acento, minúscula. Comprimento igual é o que permite casar na
 * sombra e recortar o trecho no legível. A lição das três mordidas do acento
 * neste projeto: normaliza-se o texto, não se aperta o regex.
 */
export function sombra(s: string): string {
  let saida = "";
  for (const ch of s) {
    const base = ch.normalize("NFD")[0] ?? ch;
    saida += base.toLowerCase();
  }
  return saida;
}

export type Contagem = "util" | "corrido" | "nao_declarada";

export type PrazoLido = {
  /** `null` = o texto fala de prazo mas o número não está legível (remissão à lei, "prazo legal"). */
  dias: number | null;
  /**
   * Só o que o texto DECLARA. O CPC conta prazo processual em dia útil por
   * padrão, mas aplicar regra é conta — e conta, com a incerteza à mostra,
   * é a E4. Não-declarado sai como não-declarado.
   */
  contagem: Contagem;
  trecho: string;
};

export type TipoDeAto = {
  tipo: string;
  trecho: string;
};

export type Leitura = {
  /** `null` = nenhum dos tipos conhecidos apareceu. Não se inventa tipo. */
  tipoDeAto: TipoDeAto | null;
  /** Todos os prazos do texto, na ordem. Vazio = o texto não fala de prazo. */
  prazos: PrazoLido[];
};

/** Números por extenso que aparecem em prazo forense. Fora da lista → `dias: null`. */
const EXTENSO: Record<string, number> = {
  um: 1, dois: 2, tres: 3, quatro: 4, cinco: 5,
  oito: 8, dez: 10, quinze: 15, vinte: 20, trinta: 30,
  quarenta: 40, sessenta: 60, noventa: 90,
  "quarenta e cinco": 45, "quarenta e oito": 48,
};

/** Do mais longo para o mais curto: "quarenta e cinco" antes de "quarenta". */
const PALAVRAS_EXTENSO = Object.keys(EXTENSO)
  .sort((a, b) => b.length - a.length)
  .join("|");

/**
 * O número do prazo, nas cinco formas medidas, sempre seguido de "dia(s)" —
 * "48 horas" não vira dias aqui. Grupos: 1 = "15 (quinze)", 2 = "quinze (15)",
 * 3 = "15" seco, 4 = "quinze" seco.
 */
const NUMERO_DE_DIAS = new RegExp(
  `(?:(\\d{1,3})\\s*\\(\\s*(?:${PALAVRAS_EXTENSO})\\s*\\)` +
    `|(?:${PALAVRAS_EXTENSO})\\s*\\(\\s*(\\d{1,3})\\s*\\)` +
    `|(\\d{1,3})` +
    `|(${PALAVRAS_EXTENSO}))` +
    `\\s*dias?\\b`,
);

/** Janela depois de "prazo" onde o número ainda é DESTE prazo — cabe nos 15 trechos medidos. */
const JANELA_DO_NUMERO = 90;
/** Contexto extra no trecho, para ele ser legível sozinho. */
const FOLGA_DO_TRECHO = 40;

function cortaEmPalavra(s: string): string {
  const corte = s.lastIndexOf(" ");
  return corte > 0 ? s.slice(0, corte) : s;
}

export function lePrazos(textoOriginal: string): PrazoLido[] {
  const texto = legivel(textoOriginal);
  const s = sombra(texto);
  const prazos: PrazoLido[] = [];

  for (const oc of s.matchAll(/\bprazos?\b/g)) {
    const inicio = oc.index;
    const janela = s.slice(inicio, inicio + JANELA_DO_NUMERO);
    const m = NUMERO_DE_DIAS.exec(janela);

    let dias: number | null = null;
    let fim: number;
    if (m) {
      const digito = m[1] ?? m[2] ?? m[3];
      dias = digito != null ? Number(digito) : (EXTENSO[m[4]!] ?? null);
      fim = Math.min(texto.length, inicio + m.index + m[0].length + FOLGA_DO_TRECHO);
    } else {
      fim = Math.min(texto.length, inicio + JANELA_DO_NUMERO);
    }

    let trecho = texto.slice(inicio, fim);
    if (fim < texto.length) trecho = cortaEmPalavra(trecho);

    const contagem: Contagem = /\b(uteis|util)\b/.test(janela)
      ? "util"
      : /\bcorridos?\b/.test(janela)
        ? "corrido"
        : "nao_declarada";

    prazos.push({ dias, contagem, trecho: trecho.trim() });
  }

  return prazos;
}

/**
 * Tipos de ato do juízo, do mais consequente para o menos — cabeçalho composto
 * existe (medido: "DESPACHO/DECISÃO"), e aí vale o de maior peso. A lista tem
 * só ato de JUÍZO: peça de parte é classificada pelo acervo (0002.E3), e os
 * verbos de ato processual são proibidos em `lib/djen/` pela varredura da E6.
 */
const TIPOS_DE_ATO: Array<{ tipo: string; padrao: RegExp }> = [
  { tipo: "sentença", padrao: /\bsentencas?\b/ },
  { tipo: "acórdão", padrao: /\bacordaos?\b/ },
  { tipo: "decisão", padrao: /\bdecis(ao|oes)\b/ },
  { tipo: "despacho", padrao: /\bdespachos?\b/ },
  { tipo: "citação", padrao: /\bcitac(ao|oes)\b/ },
  { tipo: "intimação", padrao: /\bintimac(ao|oes)\b/ },
  { tipo: "edital", padrao: /\bedita(l|is)\b/ },
  { tipo: "ata de sessão", padrao: /\bata de sessao\b/ },
];

export function leTipoDeAto(textoOriginal: string): TipoDeAto | null {
  const texto = legivel(textoOriginal);
  const s = sombra(texto);

  for (const { tipo, padrao } of TIPOS_DE_ATO) {
    const m = padrao.exec(s);
    if (!m) continue;
    const inicio = Math.max(0, m.index - FOLGA_DO_TRECHO);
    const fim = Math.min(texto.length, m.index + m[0].length + FOLGA_DO_TRECHO);
    return { tipo, trecho: texto.slice(inicio, fim).trim() };
  }
  return null;
}

export function lePublicacao(textoOriginal: string): Leitura {
  return {
    tipoDeAto: leTipoDeAto(textoOriginal),
    prazos: lePrazos(textoOriginal),
  };
}
