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
 * Regra de léxico, sem modelo. O custo dos erros é assimétrico e a regra existe
 * para isso:
 *   - falso NEGATIVO: o prazo corre enquanto o robô segue a triagem calmo. É o
 *     erro caro, por isso o léxico é largo ("prazo ... vence/acaba", "recebi
 *     citação", "foi preso", "delegacia", "pensão atrasada").
 *   - falso POSITIVO: o advogado recebe um aviso que não era urgente. É o erro
 *     barato — desde que o óbvio fique de fora ("preso no trânsito", "prazo
 *     que não vence", "como funciona uma audiência?"). Cada exclusão abaixo tem
 *     um teste com a frase real.
 *
 * Todo padrão é ASCII minúsculo: o texto é normalizado antes (ver `texto.ts`).
 */
import { normalizaComMapa, trechoOriginal } from "./texto";

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
};

const g = (fonte: string) => new RegExp(fonte, "g");

// O que NÃO é prisão de gente: "preso no trânsito" (depois) e "o carro está preso" (antes).
const PRESO_LUGAR =
  "transito|engarrafamento|congestionamento|elevador|reuniao|fila|chuva|aeroporto|banheiro|onibus|metro|ponte|lama|obras?|greve|bloqueio|neve";
const PRESO_COISA = "carro|moto|cabelo|dedo|mao|porta|janela|zipper|ziper|gato|cachorro|bicicleta";
const EM_LUGAR = `^\\s*(?:aqui\\s+)?(?:no|na|num|numa|em|ao|nesse|nessa|neste|nesta)\\s+(?:\\S+\\s+)?(?:${PRESO_LUGAR})\\b`;
const CONTEXTO_POLICIAL =
  "delegacia|policia|policial|viatura|cadeia|presidio|penitenciaria|cdp|flagrante|custodia|carceragem|cela|prisao|" +
  "mandado|delegado|juiz|ha \\d+ (?:dias?|horas?)|desde ontem|desde segunda";

const REGRAS: Regra[] = [
  // ── preso ──
  {
    tipo: "preso",
    padrao: g(
      "\\b(?:foi|fui|foram|fomos|vai ser|vao ser|ser|sera|serem)\\s+(?:preso|presa|presos|presas|detido|detida|detidos|algemado|algemada)\\b",
    ),
  },
  { tipo: "preso", padrao: g("\\bprenderam\\b|\\bme prenderam\\b") },
  {
    // "meu filho tá preso", "ele ficou preso": exclui o óbvio ("preso no trânsito", "o carro está preso").
    tipo: "preso",
    padrao: g(
      "\\b(?:esta|estao|ta|tao|ficou|ficaram|continua|continuam)\\s+(?:preso|presa|presos|presas|detido|detida)\\b",
    ),
    vetoAntes: new RegExp(`\\b(?:${PRESO_COISA})\\s+(?:\\S+\\s+)?$`),
    vetoDepois: new RegExp(EM_LUGAR),
  },
  {
    // primeira pessoa ("estou preso") é ambígua demais sem um sinal policial no texto
    tipo: "preso",
    padrao: g("\\b(?:estou|estamos)\\s+(?:preso|presa|presos|presas|detido|detida)\\b"),
    vetoDepois: new RegExp(EM_LUGAR),
    exige: new RegExp(`\\b(?:${CONTEXTO_POLICIAL})\\b`),
  },
  { tipo: "preso", padrao: g("\\bflagrante\\b") },
  {
    tipo: "preso",
    padrao: g("\\bdelegacia\\b"),
    // "delegacia do trabalho" é órgão trabalhista, não polícia
    vetoDepois: /^\s+(?:regional\s+)?(?:do|de)\s+trabalho\b|^\s+da\s+receita\b/,
  },
  {
    tipo: "preso",
    padrao: g(
      "\\b(?:presidio|penitenciaria|carceragem|habeas corpus|mandado de prisao|audiencia de custodia|prisao (?:preventiva|temporaria|domiciliar|em flagrante))\\b",
    ),
  },

  // ── prazo ──
  {
    tipo: "prazo",
    padrao: g(
      "\\bprazo\\b[^.!?\\n]{0,45}?(?<!\\bnao )\\b(?:vence|vencem|vencendo|venceu|acaba|acabando|acabou|termina|terminando|terminou|" +
        "esgota|esgotando|esgotou|expira|expirando|expirou|encerra|encerrando)\\b",
    ),
  },
  { tipo: "prazo", padrao: g(`\\bprazo\\b[^.!?\\n]{0,25}?\\b(?:${DIA})\\b`) },
  {
    tipo: "prazo",
    padrao: g("\\bfalta(?:m)?\\s+(?:\\d+|um|dois|tres|quatro|cinco)\\s+dias?\\s+(?:para|pra|pro)\\s+(?:o\\s+)?prazo\\b"),
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
        "\\bfui\\s+(?:citado|citada|intimado|intimada)\\b|\\boficial de justica\\b",
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

  // ── despejo ──
  {
    tipo: "despejo",
    padrao: g(
      "\\bdespejo\\b|\\bdespejad[oa]s?\\b|\\b(?:me|nos)\\s+(?:vao\\s+)?(?:despejar|tirar de casa)\\b|" +
        "\\breintegracao de posse\\b|\\b(?:ordem|mandado) de desocupacao\\b",
    ),
  },

  // ── liminar ──
  {
    tipo: "liminar",
    padrao: g("\\bliminar\\b|\\btutela (?:de urgencia|antecipada|provisoria)\\b"),
  },

  // ── pensão atrasada / prisão civil ──
  { tipo: "alimentos_atrasados", padrao: g("\\bprisao civil\\b|\\bexecucao de alimentos\\b") },
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

/** Primeiro trecho de `regra` que passa pelo veto e pela exigência de contexto. */
function primeiroTrecho(regra: Regra, texto: string, tudo: string): { inicio: number; fim: number } | null {
  if (regra.exige && !regra.exige.test(tudo)) return null;
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
    const t = primeiroTrecho(regra, n.texto, n.texto);
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
