/**
 * O GATE DE SAÍDA DAS TRAVAS DA OAB — onde `lib/oab/travas.ts` passa a valer no turno.
 *
 * A apresentação afirma ao advogado que "a vedação está no código". Até este arquivo,
 * só a resposta de andamento do DJEN passava por `decideResposta`; o agente que fala com
 * o cliente não. Aqui a regra entra na cadeia `before_send`, depois do `disclosure`
 * (que emenda o corpo da 1ª mensagem: este gate julga o texto que vai sair de fato).
 *
 * ═══ ARMADO OU NO-OP ═══
 *
 * `ctx.travasOab` ausente = gate no-op (retrocompatível com todo montador de contexto
 * que não o conhece: follow-up determinístico, template, prévia, testes herdados).
 * Presente = armado, e quem arma é o turno do agente (`inbound-turn.ts`), só no
 * `send_message` — o único corpo escrito pelo MODELO — e só com a camada `travas_oab`
 * ligada (padrão: ligada). O `send_template` não passa por aqui: o texto FIXO do template é
 * da organização, mas os VALORES das variáveis são do modelo, e o turno os confere à parte
 * (`motivosDosValoresDoTemplate`), com o mesmo contador de vetos.
 *
 * ═══ O TEXTO BARRADO NUNCA SAI — EM NENHUM CASO ═══
 *
 * Os vetos deste gate tiram o texto da saída; o que muda é o que o turno faz depois:
 *
 *  - `trava_oab_identificacao`: a ÚNICA violação é a 1ª resposta do modelo sem se declarar
 *    máquina. Retentável: o modelo reescreve se apresentando. Depois de DUAS recusas no mesmo
 *    turno o turno liga `injetaIdentificacao` e o gate EMENDA a frase padrão no início (como o
 *    disclosure em modo inject) em vez de deixar o cliente sem resposta.
 *  - `trava_oab`: qualquer outra coisa (pergunta de mérito sem deferir ao advogado, promessa
 *    de resultado, valor, orientação jurídica, mercantilização). O 1º veto do turno é erro
 *    INSTRUTIVO: o texto não sai e o modelo é orientado a reformular deferindo ao advogado. O
 *    2º veto do mesmo turno faz a passagem (spec 0001, E2/E3: "não responde por conta própria,
 *    marca a conversa e entrega"). Reformular é a tentativa do modelo de cumprir a regra; só
 *    quando ele insiste o turno entrega.
 *  - `trava_oab_pediu_humano`: o cliente pediu uma pessoa. Reformular não resolve nada: o
 *    turno entrega ao advogado já. (A detecção determinística da abertura do turno costuma
 *    pegar antes; este é o resto.)
 *
 * O `detail` leva só os RÓTULOS dos motivos — nunca o trecho: a frase barrada pode
 * conter o que o cliente contou do caso (sem PII no trace).
 *
 * ═══ O QUE O GATE JULGA ═══
 *
 *  - As PROIBIÇÕES e a deferência olham o corpo SEM o trecho do template de disclosure da
 *    organização: um template honesto ("não garantimos resultado em nenhum caso") não pode
 *    vetar toda primeira resposta, e um template que cita "o advogado" não pode contar como
 *    deferência. A IDENTIFICAÇÃO olha o corpo inteiro (o template é a apresentação).
 *  - "Primeira resposta" é `primeiraRespostaDoModelo`: nenhum envio aceito ESCRITO PELO MODELO
 *    antes neste contato (lib/oab/primeira-resposta.ts). Template, aviso de escalação e
 *    follow-up determinístico não contam: o cliente que só recebeu isso ainda não foi
 *    informado de que fala com uma máquina.
 *  - Na pergunta de mérito, a deferência pode estar em OUTRA mensagem já enviada no mesmo turno
 *    (`deferiuNoTurno`): o modelo que parte a resposta em bolhas não é barrado na bolha que
 *    vem antes de "essa análise é do advogado" só porque ela, sozinha, não deferia.
 */
import type { Gate, GateContext, GateTraceEntry, GateVerdict } from "@/lib/agent-engine/guardrails/before-send";

import { bodyContainsDisclosure } from "@/lib/agent-engine/guardrails/disclosure/template";
import {
  avalia,
  defereAoAdvogado,
  normalizaParaCasar,
  pedeHumano,
  perguntaDeMerito,
  seIdentificaComoMaquina,
  type Motivo,
} from "./travas";

/** Motivos que `avalia` não dá, mas o trace precisa dizer. */
export type MotivoDaEntrega = Motivo | "pediu_humano" | "jev_sem_resposta";

export const CODIGO_TRAVA_OAB = "trava_oab";
export const CODIGO_TRAVA_OAB_IDENTIFICACAO = "trava_oab_identificacao";
export const CODIGO_TRAVA_OAB_PEDIU_HUMANO = "trava_oab_pediu_humano";
/** A segunda camada (Jev) decidia e não respondeu: sem conferência, nada sai — entrega já. */
export const CODIGO_TRAVA_OAB_SEM_CONFERENCIA = "trava_oab_sem_conferencia";

/** Quantos vetos `trava_oab` o turno tolera antes de entregar ao advogado (o 1º ensina, o 2º entrega). */
export const VETOS_ATE_ENTREGAR = 2;
/** Quantas recusas de identificação o turno tolera antes de o gate emendar a frase padrão. */
export const VETOS_ATE_INJETAR_IDENTIFICACAO = 2;

/** A frase padrão de identificação (emendada pelo gate e usada pelo aviso de escalação). */
export const FRASE_DE_IDENTIFICACAO = "Aqui é o atendimento automatizado do escritório.";
export const FRASE_DE_IDENTIFICACAO_ES = "Este es el servicio de atención automatizado del despacho.";

/** `escapa` os metacaracteres para montar a regex do template. */
const escapa = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * O corpo sem o trecho do template de disclosure. Mesma régua de `bodyContainsDisclosure`
 * (sem caixa, qualquer espaço vale um espaço). Se o trecho não for achado, devolve o corpo.
 */
export function semOTemplate(corpo: string, template: string): string {
  const palavras = template.trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return corpo;
  const re = new RegExp(palavras.map(escapa).join("\\s+"), "gi");
  return corpo.replace(re, " ").trim();
}

type Armado = NonNullable<GateContext["travasOab"]>;

/** Os motivos de uma resposta que NÃO pode sair; lista vazia = pode sair. */
function motivosDoVeto(
  armado: Armado,
  corpoCompleto: string,
  corpoSemTemplate: string,
  primeiraResposta: boolean,
): MotivoDaEntrega[] {
  // Mensagem só de espaços não é mensagem: vale como turno sem mensagem nova.
  const mensagem =
    armado.mensagemDoCliente !== null && normalizaParaCasar(armado.mensagemDoCliente) !== ""
      ? armado.mensagemDoCliente
      : null;

  if (mensagem !== null) {
    if (pedeHumano(mensagem)) return ["pediu_humano"];
    // Camada 1: na pergunta de mérito o ônus inverte. A deferência pode já ter saído numa
    // mensagem anterior do mesmo turno.
    if (perguntaDeMerito(mensagem) && !armado.deferiuNoTurno && !defereAoAdvogado(corpoSemTemplate)) {
      return ["pergunta_de_merito"];
    }
  }

  // Camada 2 roda SEMPRE (deferir não dá licença para prometer), sobre o corpo sem o template.
  const motivos = new Set<MotivoDaEntrega>(avalia(corpoSemTemplate, { primeiraResposta: false }).violacoes.map((v) => v.motivo));
  // Segunda camada: o veto do Jev SOMA ao das travas por padrão, nunca tira um.
  if (armado.juiz !== undefined && armado.juiz !== "falhou") for (const m of armado.juiz.barra) motivos.add(m);
  if (primeiraResposta && !seIdentificaComoMaquina(corpoCompleto)) motivos.add("sem_identificacao_de_maquina");
  return [...motivos];
}

export const travasOabGate: Gate = {
  name: "travas_oab",
  evaluate: (ctx): GateVerdict => {
    const armado = ctx.travasOab;
    if (armado === undefined) return { pass: true };

    // O template de apresentação da organização, quando o corpo o CONTÉM, conta como
    // identificação: é a apresentação que a própria organização configurou (o disclosure
    // a injeta na 1ª mensagem). Sem isto, um template que não casa o regex de
    // `seIdentificaComoMaquina` vetaria TODA primeira mensagem, em loop. Mas ele NÃO é
    // julgado como texto do modelo: sai do corpo antes das proibições e da deferência.
    const template = ctx.disclosure.template;
    const apresentadoPeloTemplate = template !== null && bodyContainsDisclosure(ctx.body, template);
    const corpoSemTemplate = apresentadoPeloTemplate ? semOTemplate(ctx.body, template) : ctx.body;
    const motivos = motivosDoVeto(
      armado,
      ctx.body,
      corpoSemTemplate,
      armado.primeiraRespostaDoModelo && !apresentadoPeloTemplate,
    );
    // Falha fechada: o Jev decidia e não respondeu. Reformular não adianta (ninguém confere a nova).
    if (armado.juiz === "falhou") {
      const todos: MotivoDaEntrega[] = [...new Set<MotivoDaEntrega>([...motivos, "jev_sem_resposta"])];
      return {
        pass: false,
        code: CODIGO_TRAVA_OAB_SEM_CONFERENCIA,
        reason: "a conferência da OAB não respondeu: a resposta não sai e a conversa é entregue ao advogado.",
        detail: { motivos: todos.join(","), quantidade: todos.length },
      };
    }
    if (motivos.length === 0) return { pass: true };

    const detail = { motivos: motivos.join(","), quantidade: motivos.length };

    if (motivos.length === 1 && motivos[0] === "sem_identificacao_de_maquina") {
      // Depois de recusas demais, o sistema fala por ele: emenda a frase padrão no início
      // (como o disclosure em modo inject) em vez de deixar o turno mudo.
      if (armado.injetaIdentificacao) {
        return { pass: true, amendBody: `${FRASE_DE_IDENTIFICACAO}\n\n${ctx.body}` };
      }
      return {
        pass: false,
        code: CODIGO_TRAVA_OAB_IDENTIFICACAO,
        reason:
          "esta é a primeira resposta ao cliente e ela não diz que ele fala com um atendimento " +
          "automatizado (exigência da OAB). Reescreva a mesma resposta se apresentando no " +
          'início, por exemplo "Sou o assistente virtual do escritório, um atendimento ' +
          'automatizado" — sem acrescentar promessa, valor ou opinião sobre o caso.',
        detail,
      };
    }

    if (motivos.length === 1 && motivos[0] === "pediu_humano") {
      return {
        pass: false,
        code: CODIGO_TRAVA_OAB_PEDIU_HUMANO,
        reason: "o cliente pediu para falar com uma pessoa: a conversa é entregue ao advogado.",
        detail,
      };
    }

    return {
      pass: false,
      code: CODIGO_TRAVA_OAB,
      reason: INSTRUCAO_DE_REFORMULAR,
      detail,
    };
  },
};

/**
 * O erro instrutivo do 1º veto `trava_oab` do turno: o texto NÃO foi enviado; o modelo é
 * orientado a reformular deferindo ao advogado, sem prometer nem orientar.
 */
export const INSTRUCAO_DE_REFORMULAR =
  "esta resposta esbarra numa vedação da OAB (opinião ou orientação sobre o caso, promessa de " +
  "resultado, valor ou prazo de ganho, propaganda, ou pergunta sobre o resultado sem deferir ao " +
  "advogado). O texto NÃO foi enviado. Reformule: diga que a análise do caso cabe ao advogado do " +
  "escritório e que você vai passar a pergunta a ele — sem prometer resultado, sem citar valor ou " +
  "prazo, sem opinar nem orientar sobre o caso. Se a nova resposta também esbarrar, a conversa é " +
  "entregue ao advogado.";

/** O que o modelo lê no 2º veto: a conversa foi entregue, ele deve parar. */
export const MENSAGEM_DE_ENTREGA_AO_ADVOGADO =
  "A conversa foi entregue ao advogado e o cliente já foi avisado. Não envie mais nenhuma " +
  "mensagem e encerre o turno agora.";

/**
 * Os motivos da trava nos VALORES de um template (texto do modelo; o texto fixo do template é
 * da organização e não é julgado). Só as proibições da resposta: um valor de variável não é
 * resposta a uma pergunta, então não há deferência a exigir. Lista vazia = pode enviar.
 */
export function motivosDosValoresDoTemplate(values: Readonly<Record<string, string>>): Motivo[] {
  const texto = Object.values(values).join("\n");
  return [...new Set(avalia(texto, { primeiraResposta: false }).violacoes.map((v) => v.motivo))];
}

/** O que cada motivo significa para quem lê o cartão da passagem (o advogado). */
const ROTULO_DO_MOTIVO: Record<MotivoDaEntrega, string> = {
  pergunta_de_merito: "o cliente fez uma pergunta sobre o resultado do caso e a resposta não deferia ao advogado",
  promessa_de_resultado: "promessa de resultado",
  valor_ou_prazo_de_ganho: "valor ou prazo de ganho",
  orientacao_juridica: "opinião ou orientação jurídica sobre o caso",
  linguagem_mercantil: "linguagem de propaganda",
  sem_identificacao_de_maquina: "a primeira resposta não se identificava como atendimento automatizado",
  pediu_humano: "o cliente pediu para falar com uma pessoa",
  jev_sem_resposta: "a conferência da OAB (Jev) não respondeu, e sem ela nenhuma resposta sai",
};

/**
 * O que a passagem conta a quem assume sobre o que SAIU neste turno: o texto barrado nunca
 * sai, mas bolhas anteriores do mesmo turno podem ter saído, e dizer "nada foi enviado" a
 * quem vai abrir a conversa seria falso.
 */
export function desfechoDaTravaDaOab(motivos: string, jaEnviadasNoTurno: number): string {
  const saiu =
    jaEnviadasNoTurno === 0
      ? "nenhuma mensagem do assistente saiu ao cliente neste turno"
      : jaEnviadasNoTurno === 1
        ? "1 mensagem do assistente já tinha saído ao cliente neste turno, antes da barrada"
        : `${jaEnviadasNoTurno} mensagens do assistente já tinham saído ao cliente neste turno, antes da barrada`;
  return `Barrado pela trava da OAB (${motivos}); o texto barrado não foi enviado; ${saiu}.`;
}

/** Rótulos em português de uma lista de motivos (só rótulos fechados, nunca trecho). */
export function rotulosDosMotivos(motivos: ReadonlyArray<MotivoDaEntrega>): string {
  const rotulos = motivos.map((m) => ROTULO_DO_MOTIVO[m]).filter((r): r is string => r !== undefined);
  return rotulos.length > 0 ? rotulos.join("; ") : "motivo não registrado";
}

/**
 * Os motivos que o gate gravou no trace do veto, em português, para o briefing da passagem.
 * Só rótulos fechados — o trace nunca carrega trecho.
 */
export function motivosDoTrace(trace: ReadonlyArray<GateTraceEntry>): string {
  const detalhe = trace.find((t) => t.gate === travasOabGate.name && t.verdict === "veto")?.detail;
  const codigos = typeof detalhe?.motivos === "string" ? detalhe.motivos.split(",") : [];
  return rotulosDosMotivos(codigos as MotivoDaEntrega[]);
}
