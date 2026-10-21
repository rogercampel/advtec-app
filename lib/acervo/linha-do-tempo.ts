/**
 * Linha do tempo do processo — ticket 0003.E3.
 *
 * "Os fatos na ordem em que aconteceram — não na ordem em que aparecem nos
 * autos, que é a ordem processual e confunde. Cada evento com data e página."
 * (spec 0003) Critério 2: toda afirmação tem página. Critério 6: datas na ordem
 * cronológica correta, não na ordem de aparição.
 *
 * Este módulo NÃO resume nem interpreta: cada evento é a FRASE LITERAL dos
 * autos que contém a data, com a página de onde saiu. O que o modelo fizer
 * depois (a E4 em diante) parte daqui, e só pode citar o que está aqui.
 *
 * Carimbo processual não é fato: "assinado eletronicamente em", "juntado em",
 * "gerado em" repetem-se em toda folha e afogariam a linha do tempo na ordem
 * processual. Saem contados (`carimbos`), não somem em silêncio.
 */
import type { Pagina } from "./fatiar";
import { sombra } from "./metadado";

export type Evento = {
  /** `YYYY-MM-DD`. */
  data: string;
  pagina: number;
  /** A frase dos autos que contém a data, literal. */
  trecho: string;
};

export type LinhaDoTempo = {
  eventos: Evento[];
  carimbos: number;
  /** Datas de julgado ou de norma CITADOS ("j.", "DJe", "Lei nº …, de"): não são do caso. */
  citacoes: number;
};

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** 12/03/2024, 12.03.2024, 12-03-2024 — na sombra (sem acento, minúscula). */
const NUMERICA = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g;
/** "12 de março de 2024", "1º de março de 2024", "1o de marco de 2024" — e "27 janeiro de 2006" (MPRJ, medido). */
const POR_EXTENSO = new RegExp(`\\b(\\d{1,2})(?:o|º)?\\s+(?:de\\s+)?(${Object.keys(MESES).join("|")})\\s+de\\s+(\\d{4})\\b`, "g");

const CARIMBO = /assinad[oa] eletronicamente|juntad[oa] (aos autos )?em|gerad[oa] em|impress[oa] em|documento id\b|num\. \d+ - pag\./;

/**
 * Medido em 21/10/2026 em duas peças públicas reais (TJMG, MPRJ): a maioria das
 * datas de uma petição é de JURISPRUDÊNCIA citada — "julgado em 24/09/2013",
 * "DJe 01/10/2013", "Acórdão de 13/06/2002". Na linha do tempo do caso elas
 * apareciam como fatos. Saem contadas, como o carimbo.
 *
 * Mas só com evidência LOCAL, porque o erro ao contrário é pior: citação que
 * passa aparece com o trecho literal e o advogado vê; fato descartado some sem
 * ninguém ver ("relatório médico de 12/03/2024", "exonerado pela Câmara
 * Municipal em…", "o agravo do autor foi julgado em…" são fatos do caso).
 * Citação é:
 *   (a) data logo depois de marcador de data de julgado ("j.", "DJe", "Data do
 *       Julgamento:", "julgado em") COM referência de tribunal nos 200
 *       caracteres antes; ou
 *   (b) data dentro de parênteses que trazem referência de tribunal; ou
 *   (c) data de norma: "Lei nº 8.078, de 11 de setembro de 1990".
 */
const REFERENCIA_DE_JULGADO =
  /\brel\.|\brelator(a)?\b|acordao|\bresp\b|\bagrg\b|\bagint\b|\baga\b|\baresp\b|\bsumula\b|\bementario\b|\bstj\b|\bstf\b|\btst\b|\btj[a-z]{2}\b|\btrf\s?\d\b|\bminist(ro|ra)\b|\d+\s*[ªºao]?\s+(camara|turma)\b|turma recursal|orgao julgador/;
const DATA_DE_JULGADO_ANTES =
  /(?:\bj\.|\bdje?\b|\bd\.j\.|data d[aeo] (?:julgamento|registro|publicacao)|julgad[oa] em|publicad[oa] em|acordao (?:de|em)|sessao de)\s*:?\s*(?:de\s+|em\s+)?$/;
const DATA_DE_NORMA_ANTES =
  /\b(?:lei|decreto|decreto-lei|lei complementar|medida provisoria|resolucao|portaria|emenda constitucional)\b[^;()]{0,30},?\s+de\s*$/;
const JANELA_DA_REFERENCIA = 200;

function eCitacao(s: string, inicio: number): boolean {
  const antes = s.slice(Math.max(0, inicio - JANELA_DA_REFERENCIA), inicio);
  if (DATA_DE_NORMA_ANTES.test(antes.slice(-60))) return true;
  if (DATA_DE_JULGADO_ANTES.test(antes.slice(-40)) && REFERENCIA_DE_JULGADO.test(antes)) return true;
  const abre = s.lastIndexOf("(", inicio);
  if (abre < 0 || inicio - abre > 400 || s.lastIndexOf(")", inicio) > abre) return false;
  const fecha = s.indexOf(")", inicio);
  return REFERENCIA_DE_JULGADO.test(s.slice(abre, fecha < 0 ? inicio : fecha));
}

const ANO_MINIMO = 1950;
const TAMANHO_MAXIMO_DO_TRECHO = 300;

function iso(dia: number, mes: number, ano: number, hoje: Date): string | null {
  if (ano < ANO_MINIMO || ano > hoje.getUTCFullYear() + 1) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null; // 31/02 não existe
  return d.toISOString().slice(0, 10);
}

/**
 * A frase em volta da posição: do último fim de frase antes até o próximo depois.
 *
 * A quebra de linha NÃO é fim de frase: o PDF quebra a linha no meio da frase
 * (medido nas peças públicas do TJMG e do MPRJ), e cortar nela deixava o trecho
 * como "de 04/10/2002," — sem o "DJ" da linha de cima que dizia que era citação.
 * Trocar "\n" por espaço preserva o comprimento, então os índices valem igual.
 */
function fraseEmVolta(original: string, inicio: number, fim: number): string {
  const texto = original.replace(/\n/g, " ");
  const antes = Math.max(texto.lastIndexOf(". ", inicio), texto.lastIndexOf("; ", inicio));
  const candidatos = [texto.indexOf(". ", fim), texto.indexOf("; ", fim)].filter((i) => i >= 0);
  const depois = candidatos.length ? Math.min(...candidatos) + 1 : texto.length;
  const frase = texto.slice(antes < 0 ? 0 : antes + 1, depois).trim();
  return frase.length > TAMANHO_MAXIMO_DO_TRECHO ? frase.slice(0, TAMANHO_MAXIMO_DO_TRECHO).trimEnd() + "…" : frase;
}

export function linhaDoTempo(paginas: Pagina[], opcoes: { hoje?: Date } = {}): LinhaDoTempo {
  const hoje = opcoes.hoje ?? new Date();
  const vistos = new Set<string>();
  const eventos: Evento[] = [];
  let carimbos = 0;
  let citacoes = 0;

  for (const p of paginas) {
    // A sombra preserva o comprimento: casa-se nela e recorta-se o trecho no texto original.
    const s = sombra(p.texto);
    const achados: Array<{ data: string; inicio: number; fim: number }> = [];
    for (const m of s.matchAll(NUMERICA)) {
      const data = iso(Number(m[1]), Number(m[2]), Number(m[3]), hoje);
      if (data) achados.push({ data, inicio: m.index, fim: m.index + m[0].length });
    }
    for (const m of s.matchAll(POR_EXTENSO)) {
      const data = iso(Number(m[1]), MESES[m[2]!]!, Number(m[3]), hoje);
      if (data) achados.push({ data, inicio: m.index, fim: m.index + m[0].length });
    }
    for (const a of achados) {
      const trecho = fraseEmVolta(p.texto, a.inicio, a.fim);
      const sTrecho = sombra(trecho);
      if (CARIMBO.test(sTrecho)) {
        carimbos += 1;
        continue;
      }
      // Na sombra crua: o "\s" das regex já atravessa a quebra de linha do PDF ("D.J. de\n04/10/2002").
      if (eCitacao(s, a.inicio)) {
        citacoes += 1;
        continue;
      }
      const chave = `${a.data}|${trecho}`;
      if (vistos.has(chave)) continue; // a mesma frase repetida (cópia de peça nos autos) entra uma vez, na primeira página
      vistos.add(chave);
      eventos.push({ data: a.data, pagina: p.numero, trecho });
    }
  }

  // Ordem do FATO; empate na data fica na ordem dos autos (página).
  eventos.sort((x, y) => (x.data === y.data ? x.pagina - y.pagina : x.data < y.data ? -1 : 1));
  return { eventos, carimbos, citacoes };
}
