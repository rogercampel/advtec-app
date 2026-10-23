/**
 * ÁREAS DO DIREITO — spec 0001.E3, critérios 7 e (parte do) 8.
 *
 * Duas perguntas separadas, e é a separação que protege o escritório:
 *
 *   1. `classificaArea` — em que área está o que o cliente DISSE? Léxico em
 *      linguagem de cliente leigo ("fui mandado embora", "guarda do meu filho"),
 *      não de peça. Devolve a área e o trecho; o que casar com mais de uma área
 *      volta com TODAS as candidatas.
 *   2. `decideArea` — o que o escritório faz com isso? Depende só da config da
 *      organização (`config.ts`): `atende` / `recusa` / `perguntar_ao_advogado`.
 *
 * FALHA FECHADO. Só recusa quando TODAS as áreas candidatas estão na lista de
 * recusadas e nenhuma está na de atendidas. Área que ninguém decidiu, texto que
 * não casou com nada, texto que mistura "demissão" com "delegacia": vai para o
 * advogado. Recusar errado perde um cliente que o escritório queria; perguntar
 * custa uma mensagem.
 *
 * Termos em ASCII minúsculo (ver `texto.ts`). Os de peça vêm de
 * `lib/acervo/metadado.ts`; aqui entram os de quem não é advogado.
 */
import { normalizaComMapa, soAlfanumerico, trechoOriginal } from "./texto";

export type AreaId =
  | "trabalhista"
  | "familia_sucessoes"
  | "criminal"
  | "previdenciario"
  | "consumidor"
  | "civel"
  | "tributario";

type DefinicaoDeArea = {
  rotulo: string;
  /** Outros jeitos de a config ou o modelo chamarem a mesma área (já normalizados). */
  apelidos: string[];
  /** Fontes de regex em ASCII minúsculo. */
  termos: string[];
  /** A Defensoria Pública costuma atender esse tipo de caso? Só entra na recusa se sim. */
  defensoria: boolean;
};

export const AREAS: Record<AreaId, DefinicaoDeArea> = {
  trabalhista: {
    rotulo: "Trabalhista",
    apelidos: ["direito do trabalho", "trabalho", "trabalhista"],
    defensoria: true,
    termos: [
      "fui mandad[oa] embora",
      "(?:me|nos) mandaram embora",
      "fui demitid[oa]",
      "(?:me|nos) demitiram",
      "demissao",
      "justa causa",
      "carteira (?:de trabalho )?assinada",
      "sem carteira",
      "carteira de trabalho",
      "\\bctps\\b",
      "\\bclt\\b",
      "rescisao",
      "verbas rescisorias",
      "\\bfgts\\b",
      "aviso previo",
      "horas? extras?",
      "salarios? atrasados?",
      "salario atrasado",
      "decimo terceiro",
      "13o salario",
      "ferias vencidas",
      "reclamacao trabalhista",
      "vinculo (?:de emprego|empregaticio)",
      "insalubridade",
      "periculosidade",
      "assedio moral no trabalho",
      "acidente de trabalho",
      "meu patrao",
      "meu empregador",
      "empregada domestica",
      "seguro[- ]desemprego",
      "justica do trabalho",
    ],
  },
  familia_sucessoes: {
    rotulo: "Família e sucessões",
    apelidos: ["familia", "direito de familia", "sucessoes", "sucessao", "familia e sucessoes", "direito de familia e sucessoes"],
    defensoria: true,
    termos: [
      "divorcio",
      "separacao",
      "pensao alimenticia",
      "pensao (?:do|da|pro|pra|para o|para a) (?:meu|minha|nosso|nossa)?\\s*(?:filho|filha|filhos|filhas)",
      "guarda (?:do|da|dos|das|dele|dela|unilateral)\\b",
      "(?:pedir|ter|ganhar|disputar|perder) (?:a )?guarda",
      "guarda compartilhada",
      "regime de visitas?",
      "direito de visitas?",
      "uniao estavel",
      "inventario",
      "heranca",
      "herdeiros?",
      "testamento",
      "partilha de bens",
      "reconhecimento de paternidade",
      "investigacao de paternidade",
      "adocao",
      "curatela",
      "interdicao",
      "meu ex[- ]marido",
      "minha ex[- ]mulher",
      "pai do meu filho",
      "mae do meu filho",
      "vara de familia",
    ],
  },
  criminal: {
    rotulo: "Criminal",
    apelidos: ["penal", "direito penal", "criminal", "direito criminal"],
    defensoria: true,
    termos: [
      "fui preso",
      "foi preso",
      "prenderam",
      "delegacia(?! (?:regional )?(?:do|de) trabalho)",
      "flagrante",
      "inquerito",
      "processo criminal",
      "acao penal",
      "habeas corpus",
      "audiencia de custodia",
      "liberdade provisoria",
      "tornozeleira",
      "medida protetiva",
      "maria da penha",
      "queixa[- ]crime",
      "antecedentes criminais",
      "furto",
      "roubo",
      "trafico",
      "homicidio",
      "lesao corporal",
      "estelionato",
      "calunia",
      "difamacao",
      "fui acusad[oa] de",
      "mandado de prisao",
    ],
  },
  previdenciario: {
    rotulo: "Previdenciário",
    apelidos: ["direito previdenciario", "previdencia", "inss"],
    defensoria: true,
    termos: [
      "\\binss\\b",
      "aposentadoria",
      "aposentar",
      "auxilio[- ]doenca",
      "auxilio[- ]acidente",
      "\\bbpc\\b",
      "\\bloas\\b",
      "pensao por morte",
      "beneficio (?:negado|cortado|suspenso)",
      "tempo de contribuicao",
      "pericia do inss",
    ],
  },
  consumidor: {
    rotulo: "Consumidor",
    apelidos: ["direito do consumidor", "consumo"],
    defensoria: true,
    termos: [
      "\\bprocon\\b",
      "produto com defeito",
      "cobranca indevida",
      "nome sujo",
      "negativad[oa]",
      "\\bspc\\b",
      "\\bserasa\\b",
      "cancelamento de voo",
      "bagagem extraviada",
      "plano de saude (?:negou|nao cobre|cancelou)",
      "codigo de defesa do consumidor",
    ],
  },
  civel: {
    rotulo: "Cível",
    apelidos: ["direito civil", "civil", "civel"],
    defensoria: true,
    termos: [
      "indenizacao",
      "dano moral",
      "danos morais",
      "acidente de transito",
      "usucapiao",
      "despejo",
      "aluguel",
      "contrato de compra",
      "compra e venda",
      "escritura",
      "meu vizinho",
      "cobranca de divida",
    ],
  },
  tributario: {
    rotulo: "Tributário",
    apelidos: ["direito tributario", "tributos", "impostos"],
    defensoria: false,
    termos: [
      "receita federal",
      "execucao fiscal",
      "divida ativa",
      "malha fina",
      "\\bicms\\b",
      "\\biptu\\b",
      "\\bipva\\b",
      "autuacao fiscal",
      "imposto de renda",
    ],
  },
};

export const TODAS_AS_AREAS = Object.keys(AREAS) as AreaId[];

const PADROES = TODAS_AS_AREAS.map((id) => ({
  id,
  regras: AREAS[id].termos.map((t) => new RegExp(t.startsWith("\\b") ? t : `\\b${t}`, "g")),
}));

/** "Trabalhista", "direito de família", "trabalhista" → o id; o que não for área conhecida → `null`. */
export function areaDoRotulo(rotulo: string | null | undefined): AreaId | null {
  if (!rotulo) return null;
  const chave = soAlfanumerico(rotulo);
  if (chave === "") return null;
  for (const id of TODAS_AS_AREAS) {
    const d = AREAS[id];
    if (chave === id.replace(/_/g, " ") || chave === soAlfanumerico(d.rotulo) || d.apelidos.some((a) => soAlfanumerico(a) === chave)) {
      return id;
    }
  }
  return null;
}

export type AreaCandidata = { area: AreaId; trecho: string; termos: number };

export type ClassificacaoDeArea = {
  /** A área com mais termos (empate: a que aparece primeiro no texto). `null` = nada reconhecido. */
  area: AreaId | null;
  trecho: string | null;
  /** Todas as áreas que tiveram ao menos um termo, da mais forte para a mais fraca. */
  candidatas: AreaCandidata[];
};

export function classificaArea(textoDoCliente: string): ClassificacaoDeArea {
  if (!textoDoCliente || textoDoCliente.trim() === "") return { area: null, trecho: null, candidatas: [] };
  const n = normalizaComMapa(textoDoCliente);
  const candidatas: Array<AreaCandidata & { inicio: number }> = [];
  for (const { id, regras } of PADROES) {
    let termos = 0;
    let primeiro: { inicio: number; fim: number } | null = null;
    for (const r of regras) {
      r.lastIndex = 0;
      const m = r.exec(n.texto);
      if (!m || m[0].length === 0) continue;
      termos++;
      if (!primeiro || m.index < primeiro.inicio) primeiro = { inicio: m.index, fim: m.index + m[0].length };
    }
    if (primeiro) {
      candidatas.push({ area: id, trecho: trechoOriginal(n, primeiro.inicio, primeiro.fim), termos, inicio: primeiro.inicio });
    }
  }
  candidatas.sort((a, b) => b.termos - a.termos || a.inicio - b.inicio);
  const topo = candidatas[0];
  return {
    area: topo?.area ?? null,
    trecho: topo?.trecho ?? null,
    candidatas: candidatas.map(({ area, trecho, termos }) => ({ area, trecho, termos })),
  };
}

// ── a decisão ──

export type ConfigDeAreas = {
  atendidas: readonly AreaId[];
  recusadas: readonly AreaId[];
};

export type DecisaoDeArea =
  | { acao: "atende"; areas: AreaId[] }
  | { acao: "recusa"; areas: AreaId[] }
  | {
      acao: "perguntar_ao_advogado";
      areas: AreaId[];
      motivo: "area_nao_identificada" | "area_nao_configurada" | "areas_misturadas" | "config_contraditoria";
    };

/**
 * `areas` são as candidatas (o que o cliente disse + o que o modelo rotulou).
 * Sem config (listas vazias) nada é recusado: tudo vai para o advogado.
 */
export function decideArea(areas: readonly AreaId[], config: ConfigDeAreas): DecisaoDeArea {
  const unicas = [...new Set(areas)];
  if (unicas.length === 0) return { acao: "perguntar_ao_advogado", areas: [], motivo: "area_nao_identificada" };

  // Área nas duas listas: a config se contradiz e ninguém sabe qual vale.
  if (unicas.some((a) => config.atendidas.includes(a) && config.recusadas.includes(a))) {
    return { acao: "perguntar_ao_advogado", areas: unicas, motivo: "config_contraditoria" };
  }
  if (unicas.every((a) => config.atendidas.includes(a))) return { acao: "atende", areas: unicas };
  if (unicas.every((a) => config.recusadas.includes(a))) return { acao: "recusa", areas: unicas };

  const algumaDecidida = unicas.some((a) => config.atendidas.includes(a) || config.recusadas.includes(a));
  return {
    acao: "perguntar_ao_advogado",
    areas: unicas,
    motivo: algumaDecidida ? "areas_misturadas" : "area_nao_configurada",
  };
}

/**
 * A recusa educada. Não coleta história, não opina sobre o caso, não promete
 * resultado nem prazo, e não diz que "não tem direito": só diz que o escritório
 * não atua naquela área e para onde a pessoa pode ir. Passa pelas travas da OAB
 * (`lib/oab/travas.ts`) — o teste confere.
 */
export function textoDeRecusa(areas: readonly AreaId[]): string {
  const rotulos = areas.map((a) => AREAS[a].rotulo.toLowerCase());
  const daArea =
    rotulos.length === 0
      ? "nesse tipo de assunto"
      : rotulos.length === 1
        ? `na área ${rotulos[0]}`
        : `nas áreas ${rotulos.slice(0, -1).join(", ")} e ${rotulos[rotulos.length - 1]}`;
  const defensoria = areas.every((a) => AREAS[a].defensoria)
    ? " Se não puder pagar um advogado, a Defensoria Pública do seu estado atende gratuitamente."
    : "";
  return (
    `Obrigado por entrar em contato. Este escritório não atua ${daArea}, e por isso não vamos conseguir acompanhar o seu caso. ` +
    `O melhor é procurar um advogado que trabalhe com esse assunto.${defensoria} ` +
    "Não precisa nos contar os detalhes. Desejamos que você encontre o apoio de que precisa."
  );
}

/**
 * A decisão do CASO, juntando o que o modelo rotulou e o que o cliente disse.
 *
 * Duas leituras da mesma lista de candidatas:
 *   - RECUSAR exige a lista INTEIRA (toda área com algum termo, mais a do modelo)
 *     recusada. Cliente que fala de "furto" e de "demissão" no mesmo fôlego não é
 *     recusado por causa do furto: o advogado vê.
 *   - ATENDER aceita a área DOMINANTE (a de mais termos, com os empates, mais a
 *     do modelo). "Fui demitido, perdi o FGTS e atrasei o aluguel" é trabalhista;
 *     o aluguel passando de raspão não manda o caso para o advogado.
 * Fora disso, volta a decisão da lista inteira (perguntar ao advogado).
 */
export function decideAreaDoCaso(args: {
  /** O que o modelo rotulou (já resolvido por `areaDoRotulo`); `null` se não reconheceu. */
  doModelo: AreaId | null;
  classificacao: ClassificacaoDeArea;
  config: ConfigDeAreas;
}): DecisaoDeArea {
  const { doModelo, classificacao, config } = args;
  const topo = classificacao.candidatas[0]?.termos ?? 0;
  const todas = [...(doModelo ? [doModelo] : []), ...classificacao.candidatas.map((c) => c.area)];
  const dominantes = [
    ...(doModelo ? [doModelo] : []),
    ...classificacao.candidatas.filter((c) => c.termos === topo).map((c) => c.area),
  ];
  const completa = decideArea(todas, config);
  if (completa.acao !== "perguntar_ao_advogado") return completa;
  const dominante = decideArea(dominantes, config);
  return dominante.acao === "atende" ? dominante : completa;
}
