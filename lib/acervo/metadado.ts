/**
 * Metadado jurídico da peça — ticket 0002.E3. "Tipo de peça e área extraídos e
 * corrigíveis." (spec 0002, mudança 2)
 *
 * ═══ O QUE É EXTRAÍDO, E COM QUE HONESTIDADE ═══
 *
 * Tipo de peça e área saem do PRÓPRIO TEXTO, por padrão fixo — sem modelo, sem
 * chamada de rede, sem custo. Todo achado carrega o trecho literal e a página
 * que o fundamentaram: o advogado confere em dois segundos, e corrige.
 *
 * Isto é FILTRO, não leitura. Onde o texto não diz com clareza, sai `null` e
 * o campo fica para o advogado — metadado errado com cara de certo é pior que
 * metadado vazio, porque quem filtrar por ele vai confiar.
 *
 * ═══ NÃO MEDIDO CONTRA PEÇA REAL ═══
 *
 * Os padrões saíram do vocabulário forense corrente, não de uma amostra do
 * acervo de um escritório — não havia amostra em 12/10/2026. O corpus do teste
 * é sintético. A prova que vale é a do plano de teste da spec: os 20
 * documentos reais do escritório piloto.
 *
 * ═══ O QUE ESTE MÓDULO NÃO FAZ ═══
 *
 * Não extrai órgão, instância, data nem resultado — estão na mudança 2 da
 * spec, mas a etapa E3 entrega tipo e área. Resultado ("tese que ganhou") é
 * leitura de mérito e não cabe em padrão fixo.
 */

import type { Pagina } from "./fatiar";

/** `outro` nunca é extraído: existe para o advogado corrigir o que não cabe nos cinco. */
export const TIPOS_DE_PECA = [
  "peticao_inicial",
  "contestacao",
  "recurso",
  "contrato",
  "parecer",
  "outro",
] as const;
export type TipoDePeca = (typeof TIPOS_DE_PECA)[number];

export type Achado = { valor: string; trecho: string; pagina: number };

export type Extraido = { tipoDePeca: Achado | null; area: Achado | null };

/**
 * O título da peça mora no começo. Procurar o tipo no documento inteiro faria
 * toda inicial que cita "a contestação" virar candidata a contestação.
 */
export const ZONA_DO_CABECALHO = 1500;

/** Um sinal só não decide área: "consumidor" aparece em peça de qualquer ramo. */
export const MINIMO_DE_SINAIS = 2;

/**
 * Sombra de comparação, PRESERVANDO o comprimento: cada caractere vira a sua
 * base sem acento, minúscula. Casa-se na sombra e recorta-se o trecho no
 * original. Todo padrão deste arquivo é ASCII minúsculo por isso — `\b` do JS
 * não reconhece vogal acentuada.
 */
export function sombra(s: string): string {
  let saida = "";
  for (const ch of s) {
    const base = ch.length === 1 ? (ch.normalize("NFD")[0] ?? ch).toLowerCase() : ch;
    saida += base.length === ch.length ? base : ch;
  }
  return saida;
}

/** Espaço da frase casa com qualquer branco: PDF quebra linha no meio da expressão. */
function frase(...alternativas: string[]): RegExp {
  return new RegExp(`\\b(?:${alternativas.map((a) => a.replace(/ /g, "\\s+")).join("|")})\\b`);
}

const PADROES_DE_TIPO: Array<{ tipo: TipoDePeca; padrao: RegExp }> = [
  {
    tipo: "peticao_inicial",
    // ":?" — a ACP pública do MPRJ escreve "vem propor:\nAÇÃO CIVIL PÚBLICA" (medido em 21/10/2026).
    padrao: frase("peticao inicial", "(?:propor|ajuizar|promover|mover):? (?:a presente )?(?:acao|reclamacao|execucao)"),
  },
  { tipo: "contestacao", padrao: frase("contestacao") },
  {
    tipo: "recurso",
    padrao: frase(
      "recurso de apelacao",
      "recurso inominado",
      "recurso ordinario",
      "recurso especial",
      "recurso extraordinario",
      "apelacao",
      "agravo de instrumento",
      "agravo interno",
      "embargos de declaracao",
    ),
  },
  { tipo: "contrato", padrao: frase("contrato de", "instrumento particular de") },
  { tipo: "parecer", padrao: frase("parecer") },
];

/**
 * Peças que CITAM um dos tipos acima no próprio título sem ser nenhum deles.
 * "Réplica à contestação" não é contestação. Se uma destas abre o cabeçalho
 * antes do tipo, o tipo fica vazio para o advogado.
 */
const NAO_E_NENHUM_DOS_CINCO = frase(
  "replica",
  "impugnacao",
  "contrarrazoes",
  "contraminuta",
  "memoriais",
  "procuracao",
);

/**
 * Peça endereçada a juízo não é contrato nem parecer, por mais que cite um
 * no cabeçalho — "cobrar o valor do contrato de locação" abre meia inicial.
 */
// "exmo"/"exma": as duas iniciais públicas medidas em 21/10/2026 abrem com "EXMO. SR. DR. JUIZ".
const ENDERECAMENTO = frase("excelentissimo", "excelentissima", "exmo", "exma", "ao juizo", "egregio", "colendo");
const SO_FORA_DE_JUIZO: TipoDePeca[] = ["contrato", "parecer"];

/**
 * O tipo é o que aparece PRIMEIRO no cabeçalho — parecer sobre contrato abre
 * com "PARECER", inicial de rescisão abre com "propor a presente".
 *
 * ponytail: primeiro-que-aparece é heurística de título; classificador sobre
 * o acervo real do piloto se a correção manual passar a ser a regra.
 */
export function extraiTipoDePeca(paginas: Pagina[]): Achado | null {
  const primeira = paginas.find((p) => p.texto.trim().length > 0);
  if (!primeira) return null;
  const zona = primeira.texto.slice(0, ZONA_DO_CABECALHO);
  const s = sombra(zona);

  const emJuizo = ENDERECAMENTO.test(s);

  let melhor: { tipo: TipoDePeca; inicio: number; fim: number } | null = null;
  for (const { tipo, padrao } of PADROES_DE_TIPO) {
    if (emJuizo && SO_FORA_DE_JUIZO.includes(tipo)) continue;
    const m = padrao.exec(s);
    if (m && (melhor === null || m.index < melhor.inicio)) {
      melhor = { tipo, inicio: m.index, fim: m.index + m[0].length };
    }
  }
  if (melhor === null) return null;

  const outra = NAO_E_NENHUM_DOS_CINCO.exec(s);
  if (outra && outra.index < melhor.inicio) return null;

  return { valor: melhor.tipo, trecho: zona.slice(melhor.inicio, melhor.fim), pagina: primeira.numero };
}

const SINAIS_DE_AREA: Record<string, RegExp[]> = {
  trabalhista: [
    frase("reclamacao trabalhista"),
    frase("reclamante"),
    frase("reclamada"),
    frase("vara do trabalho", "justica do trabalho"),
    frase("clt", "consolidacao das leis do trabalho"),
    frase("verbas rescisorias"),
    frase("vinculo de emprego", "vinculo empregaticio"),
  ],
  consumidor: [
    frase("cdc", "codigo de defesa do consumidor"),
    frase("relacao de consumo"),
    frase("consumidor", "consumidora"),
    frase("fornecedor", "fornecedora"),
    frase("vicio do produto", "vicio do servico"),
  ],
  familia: [
    frase("alimentos", "pensao alimenticia"),
    frase("divorcio"),
    frase("guarda"),
    frase("vara de familia"),
    frase("uniao estavel"),
  ],
  previdenciario: [
    frase("inss", "instituto nacional do seguro social"),
    frase("beneficio previdenciario"),
    frase("aposentadoria"),
    frase("auxilio-doenca", "auxilio doenca"),
    frase("segurado", "segurada"),
  ],
  tributario: [
    frase("execucao fiscal"),
    frase("credito tributario"),
    frase("ctn", "codigo tributario nacional"),
    frase("icms", "iss", "ipi"),
    frase("contribuinte"),
  ],
  penal: [
    frase("codigo penal"),
    frase("habeas corpus"),
    frase("inquerito policial"),
    frase("acao penal"),
    frase("denuncia"),
    frase("pena privativa de liberdade"),
  ],
};

export const AREAS = Object.keys(SINAIS_DE_AREA);

/**
 * Área por contagem de sinais DISTINTOS no documento inteiro. Vence quem tem
 * pelo menos `MINIMO_DE_SINAIS` e mais que o segundo colocado; empate é
 * dúvida, e dúvida sai `null`.
 *
 * ponytail: contagem de vocabulário, seis áreas. Peça que cruza dois ramos
 * (consumidor bancário, trabalhista previdenciário) tende ao empate e fica
 * para o advogado — de propósito.
 */
export function extraiArea(paginas: Pagina[]): Achado | null {
  const placar: Array<{ area: string; sinais: number; primeiro: Achado }> = [];

  for (const [area, sinais] of Object.entries(SINAIS_DE_AREA)) {
    let contagem = 0;
    let primeiro: (Achado & { ordem: number }) | null = null;
    for (const sinal of sinais) {
      for (let i = 0; i < paginas.length; i++) {
        const pagina = paginas[i]!;
        const m = sinal.exec(sombra(pagina.texto));
        if (!m) continue;
        contagem += 1;
        // ordem de leitura: página, depois posição na página.
        const ordem = i * 1e9 + m.index;
        if (primeiro === null || ordem < primeiro.ordem) {
          primeiro = {
            valor: area,
            trecho: pagina.texto.slice(m.index, m.index + m[0].length),
            pagina: pagina.numero,
            ordem,
          };
        }
        break;
      }
    }
    if (primeiro) {
      const { ordem: _ordem, ...achado } = primeiro;
      placar.push({ area, sinais: contagem, primeiro: achado });
    }
  }

  placar.sort((a, b) => b.sinais - a.sinais);
  const [lider, segundo] = placar;
  if (!lider || lider.sinais < MINIMO_DE_SINAIS) return null;
  if (segundo && segundo.sinais === lider.sinais) return null;
  return lider.primeiro;
}

export function extrai(paginas: Pagina[]): Extraido {
  return { tipoDePeca: extraiTipoDePeca(paginas), area: extraiArea(paginas) };
}

// ═══ CORREÇÃO ═══

/** O que o advogado corrigiu. Campo ausente = não corrigiu aquele campo. */
export type Correcao = { tipo_peca?: TipoDePeca; area?: string };

/**
 * Como o campo vai para `ai_chunks.metadata`. A origem fica gravada: quem lê
 * precisa saber se aquilo é palpite de padrão ou palavra do advogado.
 */
export type Campo =
  | { valor: string; origem: "extraido"; trecho: string; pagina: number }
  | { valor: string; origem: "corrigido" };

export type MetadadoDaPeca = { tipo_peca: Campo | null; area: Campo | null };

export const SEM_METADADO: MetadadoDaPeca = { tipo_peca: null, area: null };

export const TAMANHO_MAXIMO_DA_AREA = 60;

/**
 * A correção vem de fora (formulário, API) e vai para dentro do índice.
 * Valor fora do contrato é recusado aqui, alto — não gravado e descoberto
 * depois num filtro que não acha nada.
 */
export function validaCorrecao(bruta: unknown): Correcao {
  if (bruta === undefined || bruta === null) return {};
  if (typeof bruta !== "object" || Array.isArray(bruta)) {
    throw new Error("correção de metadado tem de ser um objeto");
  }
  const { tipo_peca, area, ...resto } = bruta as Record<string, unknown>;
  const sobrando = Object.keys(resto);
  if (sobrando.length) {
    throw new Error(`correção de metadado tem campo desconhecido: ${sobrando.join(", ")}`);
  }

  const saida: Correcao = {};
  if (tipo_peca !== undefined) {
    if (!TIPOS_DE_PECA.includes(tipo_peca as TipoDePeca)) {
      throw new Error(`tipo de peça inválido: ${String(tipo_peca)}`);
    }
    saida.tipo_peca = tipo_peca as TipoDePeca;
  }
  if (area !== undefined) {
    // A área é texto do escritório ("bancário", "imobiliário"): a lista de
    // áreas dele vem da anamnese, não deste arquivo.
    const limpa = typeof area === "string" ? area.replace(/\s+/g, " ").trim().toLowerCase() : "";
    if (limpa.length === 0 || limpa.length > TAMANHO_MAXIMO_DA_AREA) {
      throw new Error(`área inválida: ${String(area)}`);
    }
    // "Família" corrigida e "familia" extraída têm de ser o MESMO valor no
    // índice, senão o filtro por área enxerga duas áreas.
    saida.area = AREAS.find((a) => a === sombra(limpa)) ?? limpa;
  }
  return saida;
}

function deAchado(a: Achado | null): Campo | null {
  return a ? { valor: a.valor, origem: "extraido", trecho: a.trecho, pagina: a.pagina } : null;
}

/**
 * A correção vence, campo a campo. Serve aos dois caminhos: na ingestão
 * (sobre o extraído) e sobre o metadado já gravado de um pedaço, sem embedar
 * de novo.
 */
export function corrige(atual: MetadadoDaPeca, bruta: unknown): MetadadoDaPeca {
  const correcao = validaCorrecao(bruta);
  return {
    tipo_peca:
      correcao.tipo_peca !== undefined ? { valor: correcao.tipo_peca, origem: "corrigido" } : atual.tipo_peca,
    area: correcao.area !== undefined ? { valor: correcao.area, origem: "corrigido" } : atual.area,
  };
}

/** Extrai, valida a correção e aplica. Correção inválida LANÇA. */
export function metadadoDaPeca(paginas: Pagina[], correcao?: unknown): MetadadoDaPeca {
  const ex = extrai(paginas);
  return corrige({ tipo_peca: deAchado(ex.tipoDePeca), area: deAchado(ex.area) }, correcao);
}
