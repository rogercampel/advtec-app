/**
 * URGÊNCIA JURÍDICA — spec 0001.E3, critério 9.
 *
 * Lê o que o CLIENTE escreveu e diz se há algo que não espera: prazo correndo,
 * audiência marcada, pessoa presa, liminar, despejo, pensão atrasada com risco
 * de prisão civil. Devolve o tipo e o trecho literal (o advogado lê o trecho na
 * ficha, não a conclusão do robô).
 *
 * NÃO é o detector da base. `lib/agent-engine/guardrails/sinal-de-urgencia.ts`
 * conhece risco físico ("cheiro de queimado", "socorro"); "minha audiência é
 * amanhã" ele não vê, e é por isso que a ficha do caso nunca afirma "sem
 * urgência". Os dois ficam separados: este é jurídico, aquele é de segurança.
 *
 * ═══ A ESCOLHA DE DESENHO ═══
 *
 * Regra de léxico, sem modelo — e COM CONTEXTO PESSOAL. Quando o turno liga isto
 * ao atendimento, um acerto TIRA A CONVERSA DO ROBÔ (o cliente é avisado e o
 * advogado assume), então a palavra solta não basta:
 *   - "delegacia", "liminar", "despejo", "flagrante", "prisão civil" e "prazo
 *     vence" só acendem quando alguém do caso está na situação ("meu filho está
 *     na delegacia", "o juiz deu liminar contra mim", "recebi ordem de despejo",
 *     "meu prazo no processo vence amanhã");
 *   - frase de PERGUNTA GERAL ou de leitura ("como funciona o despejo?", "preciso
 *     entender o que é uma liminar", "li uma matéria sobre prisão civil") nunca
 *     acende;
 *   - "o prazo da minha proposta vence amanhã" não acende: prazo só vale com
 *     palavra do processo na frase ("recurso", "intimação", "audiência"…) ou na
 *     forma crua ("meu prazo vence amanhã", dita a um escritório de advocacia).
 * O custo do erro continua assimétrico: um falso NEGATIVO deixa o prazo correr
 * (por isso a forma crua, "meu prazo vence amanhã", acende). Cada exclusão tem um
 * teste com a frase real.
 *
 * Todo padrão é ASCII minúsculo: o texto é normalizado antes (ver `texto.ts`).
 */
import { normalizaComMapa, soAlfanumerico, trechoOriginal } from "./texto";

export type TipoDeUrgenciaJuridica =
  | "preso"
  | "prazo"
  | "audiencia"
  | "despejo"
  | "liminar"
  | "alimentos_atrasados";

export type UrgenciaJuridica = { tipo: TipoDeUrgenciaJuridica; trecho: string };

/** Ordem de gravidade: a primeira da lista é a que o advogado lê primeiro. */
export const ORDEM_DE_GRAVIDADE: readonly TipoDeUrgenciaJuridica[] = [
  "preso",
  "prazo",
  "audiencia",
  "despejo",
  "liminar",
  "alimentos_atrasados",
];

const DIA =
  "hoje|amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|dia \\d{1,2}|" +
  "(?:esta|essa|nesta|nessa|proxima) semana|semana que vem";

type Regra = {
  tipo: TipoDeUrgenciaJuridica;
  padrao: RegExp;
  /** Se casar logo ANTES do trecho (18 caracteres), o trecho é descartado (falso positivo conhecido). */
  vetoAntes?: RegExp;
  /** Se casar logo DEPOIS do trecho (30 caracteres), idem. */
  vetoDepois?: RegExp;
  /** Só vale se o texto INTEIRO também casar isto (ambiguidade que só o contexto desfaz). */
  exige?: RegExp;
  /** Só vale se a FRASE do trecho (entre . ! ? e quebra de linha) casar isto. */
  exigeNaFrase?: RegExp;
};

const g = (fonte: string) => new RegExp(fonte, "g");

// O que NÃO é prisão de gente: "preso no trânsito" (depois) e "o carro está preso" (antes).
const PRESO_LUGAR =
  "transito|engarrafamento|congestionamento|elevador|reuniao|fila|chuva|aeroporto|banheiro|onibus|metro|ponte|lama|obras?|greve|bloqueio|neve|casa|trabalho|escritorio|hotel";
const PRESO_COISA = "carro|moto|cabelo|dedo|mao|porta|janela|zipper|ziper|gato|cachorro|bicicleta";
const EM_LUGAR = `^\\s*(?:aqui\\s+)?(?:no|na|num|numa|em|ao|nesse|nessa|neste|nesta)\\s+(?:\\S+\\s+)?(?:${PRESO_LUGAR})\\b`;

/** Palavras do processo: com elas na frase, "prazo vence" é prazo de processo. */
const DO_PROCESSO =
  "processo|recurso|recorrer|contestacao|contestar|defesa|intimacao|intimado|intimada|citacao|citado|citada|sentenca|audiencia|" +
  "judicial|juiz|juiza|tribunal|vara|apelacao|embargos|peticao|advogad|acao|execucao|cumprimento|manifestacao|justica|" +
  "mandado|decisao|despacho|replica|impugnacao|juizado|forum";

/** Pergunta geral ou leitura: o trecho que vem depois, na mesma frase, não descreve o caso de ninguém. */
const PERGUNTA_GERAL = new RegExp(
  "\\b(?:como (?:funciona|e|eh|fazer|faco)|o que (?:e|eh|significa|quer dizer)|qual (?:e|eh|a|o)\\b|quais|quando (?:e|eh|posso)|" +
    "para que serve|(?:queria|quero|preciso|gostaria de|gostaria|vim|estou tentando) (?:entender|saber)|me explica|explique|" +
    "duvida (?:sobre|a respeito)|(?:li|vi|ouvi) (?:uma |a |um |o )?(?:materia|noticia|reportagem|artigo|video|podcast)|curiosidade|em geral|geralmente)\\b",
);

const VERBOS_DO_PRAZO =
  "vence|vencem|vencendo|venceu|acaba|acabando|acabou|termina|terminando|terminou|esgota|esgotando|esgotou|expira|expirando|expirou|encerra|encerrando";
const DONO = "meu|minha|nosso|nossa|o|esse|este|nesse|neste";

const REGRAS: Regra[] = [
  // ── preso ──
  {
    tipo: "preso",
    padrao: g(
      "\\b(?:foi|fui|foram|fomos|vai ser|vao ser|vou ser)\\s+(?:preso|presa|presos|presas|detido|detida|detidos|algemado|algemada)\\b",
    ),
  },
  { tipo: "preso", padrao: g("\\bprenderam\\b|\\bme prenderam\\b") },
  {
    // "meu filho tá preso", "ele ficou preso": exclui o óbvio ("preso no trânsito", "o carro está preso").
    tipo: "preso",
    padrao: g("\\b(?:esta|estao|ta|tao|ficou|ficaram|continua|continuam)\\s+(?:preso|presa|presos|presas|detido|detida)\\b"),
    vetoAntes: new RegExp(`\\b(?:${PRESO_COISA})\\s+(?:\\S+\\s+)?$`),
    vetoDepois: new RegExp(EM_LUGAR),
  },
  {
    // primeira pessoa: "estou preso" acende; "estou preso no trânsito" não
    tipo: "preso",
    padrao: g("\\b(?:estou|estamos)\\s+(?:preso|presa|presos|presas|detido|detida)\\b"),
    vetoDepois: new RegExp(EM_LUGAR),
  },
  { tipo: "preso", padrao: g("\\b(?:pego|pegos|pega|pegaram|preso|presa|detido|autuado|autuada)\\s+em flagrante\\b") },
  {
    // delegacia SÓ com gente lá dentro ou a caminho — "fui fazer um boletim" é vítima, não preso
    tipo: "preso",
    padrao: g(
      "\\b(?:estou|estamos|esta|estao|ta|tao|ficou|ficaram|continua|continuam)\\s+(?:\\S+\\s+){0,2}?(?:na|numa|a)\\s+delegacia\\b|" +
        "\\b(?:levaram|levou|levado|levada|levados|levadas|conduzido|conduzida|conduziram|encaminhado|encaminhada)\\b[^.!?\\n]{0,30}\\bdelegacia\\b|" +
        "\\b(?:intimado|intimada|convocado|convocada|chamado|chamada)\\b[^.!?\\n]{0,30}\\b(?:a|na|para a|pra)\\s+delegacia\\b",
    ),
  },
  {
    tipo: "preso",
    padrao: g(
      "\\b(?:presidio|penitenciaria|carceragem|habeas corpus|mandado de prisao|audiencia de custodia|prisao (?:preventiva|temporaria|domiciliar|em flagrante))\\b",
    ),
  },

  // ── prazo ──
  {
    // forma crua: "meu prazo vence amanhã", "o prazo acaba sexta" — sem complemento ("da proposta") entre prazo e verbo
    tipo: "prazo",
    padrao: g(`\\b(?:${DONO})\\s+prazo\\s+(?:(?!nao\\b)\\w+\\s+)?(?:${VERBOS_DO_PRAZO})\\b`),
  },
  { tipo: "prazo", padrao: g(`\\b(?:${DONO})\\s+prazo\\s+(?:(?!nao\\b)\\w+\\s+)?(?:${DIA})\\b`) },
  {
    // com palavra do processo na frase, o complemento é liberado: "o prazo do recurso está vencendo"
    tipo: "prazo",
    padrao: g(`\\bprazo\\b[^.!?\\n]{0,45}?(?<!\\bnao )\\b(?:${VERBOS_DO_PRAZO})\\b`),
    exigeNaFrase: new RegExp(`\\b(?:${DO_PROCESSO})`),
  },
  {
    tipo: "prazo",
    padrao: g(`\\bprazo\\b[^.!?\\n]{0,25}?\\b(?:${DIA})\\b`),
    exigeNaFrase: new RegExp(`\\b(?:${DO_PROCESSO})`),
  },
  {
    tipo: "prazo",
    padrao: g("\\bfalta(?:m)?\\s+(?:\\d+|um|dois|tres|quatro|cinco)\\s+dias?\\s+(?:para|pra|pro)\\s+(?:o\\s+)?prazo\\b"),
    exigeNaFrase: new RegExp(`\\b(?:${DO_PROCESSO})`),
  },
  {
    tipo: "prazo",
    padrao: g(
      "\\bultimo dia\\b[^.!?\\n]{0,25}\\b(?:prazo|recurso|contestacao|defesa|resposta)\\b|" +
        "\\b(?:prazo|recurso|contestacao|defesa|resposta)\\b[^.!?\\n]{0,30}\\bultimo dia\\b",
    ),
  },
  {
    tipo: "prazo",
    padrao: g(`\\btenho ate\\s+(?:${DIA})\\s+(?:para|pra|pro)\\s+(?:responder|recorrer|contestar|apresentar|entrar com)\\b`),
  },
  { tipo: "prazo", padrao: g("\\b(?:perdi|perdemos|perdeu)\\s+o\\s+prazo\\b") },
  {
    // citação/intimação recebida abre prazo; "o que é uma citação?" não casa
    tipo: "prazo",
    padrao: g(
      "\\b(?:recebi|recebemos|chegou|chegaram|veio)\\b[^.!?\\n]{0,25}\\b(?:citacao|intimacao|notificacao judicial|mandado|oficial de justica)\\b|" +
        "\\bfui\\s+(?:citado|citada|intimado|intimada)\\b|" +
        "\\b(?:veio|vieram|esteve|estiveram|apareceu|chegou|procurou|deixou)\\b[^.!?\\n]{0,30}\\boficial de justica\\b|" +
        "\\boficial de justica\\b[^.!?\\n]{0,25}\\b(?:veio|esteve|apareceu|deixou|entregou|trouxe)\\b",
    ),
  },

  // ── audiência ──
  {
    tipo: "audiencia",
    padrao: g(
      `\\baudiencia\\b[^.!?\\n]{0,40}?\\b(?:marcada|designada|agendada|marcaram|${DIA})\\b|` +
        "(?<!\\bnao )\\b(?:marcaram|designaram|agendaram|marcou|tenho|temos)\\s+(?:uma\\s+|a\\s+|minha\\s+)?audiencia\\b",
    ),
    // "não tenho audiência nenhuma marcada"
    vetoAntes: /\bnao\s+(?:tenho|temos|tem|ha)\s+(?:nenhuma?\s+)?$/,
  },

  // ── despejo: só com gente na situação ──
  {
    tipo: "despejo",
    padrao: g(
      "\\b(?:vou|vamos|fui|fomos|serei|sera|serao|estou sendo|estamos sendo)\\s+(?:ser\\s+)?despejad[oa]s?\\b|" +
        "\\b(?:me|nos)\\s+(?:despejar|tirar de casa)\\b|" +
        "\\b(?:recebi|recebemos|chegou|chegaram|veio|vieram|tenho|temos)\\b[^.!?\\n]{0,30}\\b(?:despejo|ordem de desocupacao|mandado de desocupacao|reintegracao de posse)\\b|" +
        "\\b(?:acao|processo|pedido|notificacao|ordem|mandado)\\s+de\\s+despejo\\b[^.!?\\n]{0,25}\\bcontra\\s+(?:mim|nos)\\b|" +
        "\\b(?:falou|fala|falaram|ameacou|ameacaram|ameaca|ameacando)\\b[^.!?\\n]{0,15}\\b(?:em\\s+)?despejo\\b",
    ),
  },

  // ── liminar: só quando saiu (ou foi pedida) no caso de alguém ──
  {
    tipo: "liminar",
    padrao: g(
      "(?<!\\bnao )\\b(?:deu|deferiu|concedeu|indeferiu|negou|saiu|sairam|recebi|recebemos|tenho|temos|cumprir|obteve|conseguiu|suspendeu)\\b[^.!?\\n]{0,40}\\b(?:liminar|tutela (?:de urgencia|antecipada|provisoria))\\b|" +
        "\\b(?:liminar|tutela (?:de urgencia|antecipada|provisoria))\\b[^.!?\\n]{0,30}\\bcontra\\s+(?:mim|nos|meu|minha)\\b",
    ),
  },

  // ── pensão atrasada / prisão civil ──
  {
    tipo: "alimentos_atrasados",
    padrao: g(
      "\\b(?:vou|vamos|quero|queremos|pedi|pedir|pedido|ameacou|ameacaram|ameaca|decretou|decretaram|risco de|medo de|corro o risco de)\\b[^.!?\\n]{0,30}\\bprisao civil\\b|" +
        "\\bprisao civil\\b[^.!?\\n]{0,25}\\b(?:decretada|pedida|contra mim|contra nos)\\b|" +
        "\\b(?:recebi|recebemos|fui|fomos|entrou com|moveu|ajuizou|abriu)\\b[^.!?\\n]{0,30}\\bexecucao de alimentos\\b",
    ),
  },
  {
    tipo: "alimentos_atrasados",
    padrao: g(
      "\\b(?:pensao|alimentos?)\\b(?!\\s+por morte)[^.!?\\n]{0,60}?\\b(?:atrasad[oa]s?|em atraso|atrasou|atrasaram|sem pagar|" +
        "deixou de pagar|deixei de pagar|devendo|nao (?:pagou|paga|pago|paguei|pagaram|pagam|recebo|recebi|recebemos))\\b|" +
        "\\b(?:nao paga|nao pagou|nao paguei|nao pago|nao recebo|nao recebi|atrasei|deixei de pagar|deixou de pagar|estou devendo|esta devendo)\\b" +
        "[^.!?\\n]{0,30}?\\b(?:pensao|alimentos)\\b(?!\\s+por morte)",
    ),
  },
];

/** Início da frase (depois de . ! ? ou quebra de linha) que contém a posição `i`. */
function inicioDaFrase(texto: string, i: number, fortes: boolean): number {
  const limites = fortes ? /[.!?\n]/g : /[.!?\n:;,]/g;
  let ini = 0;
  for (let m = limites.exec(texto); m !== null && m.index < i; m = limites.exec(texto)) ini = m.index + 1;
  return ini;
}

function fimDaFrase(texto: string, i: number): number {
  const m = /[.!?\n]/.exec(texto.slice(i));
  return m ? i + m.index : texto.length;
}

/** Primeiro trecho de `regra` que passa pelos vetos, pela pergunta geral e pelas exigências de contexto. */
function primeiroTrecho(regra: Regra, texto: string): { inicio: number; fim: number } | null {
  if (regra.exige && !regra.exige.test(texto)) return null;
  regra.padrao.lastIndex = 0;
  for (let m = regra.padrao.exec(texto); m !== null; m = regra.padrao.exec(texto)) {
    const inicio = m.index;
    const fim = inicio + m[0].length;
    if (m[0].length === 0) {
      regra.padrao.lastIndex++;
      continue;
    }
    if (regra.vetoAntes && regra.vetoAntes.test(texto.slice(Math.max(0, inicio - 18), inicio))) continue;
    if (regra.vetoDepois && regra.vetoDepois.test(texto.slice(fim, fim + 30))) continue;
    // "como funciona…", "preciso entender o que é…", "li uma matéria sobre…" antes do trecho, na mesma oração
    if (PERGUNTA_GERAL.test(texto.slice(inicioDaFrase(texto, inicio, false), inicio))) continue;
    if (regra.exigeNaFrase && !regra.exigeNaFrase.test(texto.slice(inicioDaFrase(texto, inicio, true), fimDaFrase(texto, fim)))) continue;
    return { inicio, fim };
  }
  return null;
}

/** Uma urgência por tipo, da mais grave para a menos. Vazio = nada que o léxico reconheça (NÃO é "sem urgência"). */
export function detectaUrgenciasJuridicas(textoDoCliente: string): UrgenciaJuridica[] {
  if (!textoDoCliente || textoDoCliente.trim() === "") return [];
  const n = normalizaComMapa(textoDoCliente);
  const achadas = new Map<TipoDeUrgenciaJuridica, UrgenciaJuridica>();
  for (const regra of REGRAS) {
    if (achadas.has(regra.tipo)) continue;
    const t = primeiroTrecho(regra, n.texto);
    if (t) achadas.set(regra.tipo, { tipo: regra.tipo, trecho: trechoOriginal(n, t.inicio, t.fim) });
  }
  return ORDEM_DE_GRAVIDADE.flatMap((tipo) => {
    const u = achadas.get(tipo);
    return u ? [u] : [];
  });
}

/** A mais grave, ou `null`. */
export function detectaUrgenciaJuridica(textoDoCliente: string): UrgenciaJuridica | null {
  return detectaUrgenciasJuridicas(textoDoCliente)[0] ?? null;
}

/** Como o advogado lê o tipo. */
export const ROTULO_DA_URGENCIA: Record<TipoDeUrgenciaJuridica, string> = {
  preso: "pessoa presa ou na delegacia",
  prazo: "prazo correndo",
  audiencia: "audiência marcada",
  despejo: "risco de despejo",
  liminar: "liminar ou tutela de urgência",
  alimentos_atrasados: "pensão atrasada (risco de prisão civil)",
};

/**
 * O tipo que um texto livre NOMEIA (o id, o rótulo ou um apelido curto), ou `null`. É o que decide se a
 * marca de urgência vinda do modelo conta: "prazo" conta; "não há urgência" e "sem urgência aparente" não.
 */
export function tipoDeUrgenciaDoTexto(texto: string): TipoDeUrgenciaJuridica | null {
  const chave = soAlfanumerico(texto);
  if (chave === "") return null;
  for (const tipo of ORDEM_DE_GRAVIDADE) {
    if (chave === tipo.replace(/_/g, " ") || chave === soAlfanumerico(ROTULO_DA_URGENCIA[tipo])) return tipo;
  }
  const apelidos: Record<string, TipoDeUrgenciaJuridica> = {
    prisao: "preso",
    presa: "preso",
    "pessoa presa": "preso",
    "prazo correndo": "prazo",
    "audiencia marcada": "audiencia",
    despejo: "despejo",
    "risco de despejo": "despejo",
    "tutela de urgencia": "liminar",
    "prisao civil": "alimentos_atrasados",
    "pensao atrasada": "alimentos_atrasados",
  };
  return apelidos[chave] ?? null;
}
