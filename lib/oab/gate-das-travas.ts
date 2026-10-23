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
 * ligada (padrão: ligada).
 *
 * ═══ DOIS VETOS, E O QUE CADA UM FAZ NO TURNO ═══
 *
 *  - `trava_oab_identificacao`: a ÚNICA violação é a 1ª resposta sem se declarar
 *    máquina. Retentável: o modelo reescreve se apresentando como atendimento
 *    automatizado, e o turno segue o caminho normal de erro instrutivo.
 *  - `trava_oab`: qualquer outra coisa (pergunta de mérito sem deferir ao advogado,
 *    promessa de resultado, valor, orientação jurídica, mercantilização, pedido de
 *    humano, mensagem vazia). NÃO é retentável: o turno entrega a conversa ao advogado
 *    (spec 0001, E2/E3: "não responde por conta própria, marca a conversa e entrega").
 *
 * O `detail` leva só os RÓTULOS dos motivos — nunca o trecho: a frase barrada pode
 * conter o que o cliente contou do caso (sem PII no trace).
 */
import type { Gate, GateTraceEntry, GateVerdict } from "@/lib/agent-engine/guardrails/before-send";

import { bodyContainsDisclosure } from "@/lib/agent-engine/guardrails/disclosure/template";
import { avalia, decideResposta, normalizaParaCasar, type Motivo } from "./travas";

/** Motivos que `decideResposta` não dá (devolve lista vazia), mas o trace precisa dizer. */
export type MotivoDaEntrega = Motivo | "pediu_humano" | "sem_mensagem";

export const CODIGO_TRAVA_OAB = "trava_oab";
export const CODIGO_TRAVA_OAB_IDENTIFICACAO = "trava_oab_identificacao";

/** Os motivos de uma resposta que NÃO pode sair; lista vazia = pode sair. */
function motivosDoVeto(
  mensagemDoCliente: string | null,
  corpo: string,
  primeiraResposta: boolean,
): MotivoDaEntrega[] {
  if (mensagemDoCliente === null) {
    // Follow-up: sem mensagem nova, não há pergunta a defender — só as proibições.
    const v = avalia(corpo, { primeiraResposta });
    return [...new Set(v.violacoes.map((x) => x.motivo))];
  }
  const d = decideResposta(mensagemDoCliente, corpo, { primeiraResposta });
  if (d.acao === "enviar") return [];
  // `decideResposta` entrega com motivos vazios nos dois casos que não são violação
  // da resposta: o cliente pediu uma pessoa, ou não há mensagem do cliente.
  if (d.motivos.length === 0) {
    return [normalizaParaCasar(mensagemDoCliente) === "" ? "sem_mensagem" : "pediu_humano"];
  }
  return d.motivos;
}

export const travasOabGate: Gate = {
  name: "travas_oab",
  evaluate: (ctx): GateVerdict => {
    const armado = ctx.travasOab;
    if (armado === undefined) return { pass: true };

    // O template de apresentação da organização, quando o corpo o CONTÉM, conta como
    // identificação: é a apresentação que a própria organização configurou (o disclosure
    // a injeta na 1ª mensagem). Sem isto, um template que não casa o regex de
    // `seIdentificaComoMaquina` vetaria TODA primeira mensagem, em loop.
    const template = ctx.disclosure.template;
    const apresentadoPeloTemplate = template !== null && bodyContainsDisclosure(ctx.body, template);
    const motivos = motivosDoVeto(
      armado.mensagemDoCliente,
      ctx.body,
      ctx.disclosure.isFirstOutbound && !apresentadoPeloTemplate,
    );
    if (motivos.length === 0) return { pass: true };

    const detail = { motivos: motivos.join(","), quantidade: motivos.length };

    if (motivos.length === 1 && motivos[0] === "sem_identificacao_de_maquina") {
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

    return {
      pass: false,
      code: CODIGO_TRAVA_OAB,
      reason:
        "a resposta esbarra numa trava da OAB (opinião sobre o caso, promessa, valor, " +
        "publicidade, pedido de atendimento humano ou falta de mensagem do cliente). " +
        "Não é para reescrever: a conversa é entregue ao advogado.",
      detail,
    };
  },
};

/** O que cada motivo significa para quem lê o cartão da passagem (o advogado). */
const ROTULO_DO_MOTIVO: Record<MotivoDaEntrega, string> = {
  pergunta_de_merito: "o cliente fez uma pergunta sobre o resultado do caso e a resposta não deferia ao advogado",
  promessa_de_resultado: "promessa de resultado",
  valor_ou_prazo_de_ganho: "valor ou prazo de ganho",
  orientacao_juridica: "opinião ou orientação jurídica sobre o caso",
  linguagem_mercantil: "linguagem de propaganda",
  sem_identificacao_de_maquina: "a primeira resposta não se identificava como atendimento automatizado",
  pediu_humano: "o cliente pediu para falar com uma pessoa",
  sem_mensagem: "não havia mensagem do cliente a responder",
};

/**
 * Os motivos que o gate gravou no trace do veto, em português, para o briefing da passagem.
 * Só rótulos fechados — o trace nunca carrega trecho.
 */
export function motivosDoTrace(trace: ReadonlyArray<GateTraceEntry>): string {
  const detalhe = trace.find((t) => t.gate === travasOabGate.name && t.verdict === "veto")?.detail;
  const codigos = typeof detalhe?.motivos === "string" ? detalhe.motivos.split(",") : [];
  const rotulos = codigos
    .map((c) => ROTULO_DO_MOTIVO[c as MotivoDaEntrega])
    .filter((r): r is string => r !== undefined);
  return rotulos.length > 0 ? rotulos.join("; ") : "motivo não registrado";
}
