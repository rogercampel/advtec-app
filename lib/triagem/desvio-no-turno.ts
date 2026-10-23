/**
 * O QUE O TURNO FAZ COM A DECISÃO DA TRIAGEM — spec 0001.E3, ligação no turno (#10, parte 3).
 *
 * `registrar_triagem` (ferramenta, `./ferramenta.ts`) devolve a decisão; quem manda no desvio é o
 * CÓDIGO, não o modelo. Este arquivo transforma a decisão em ação, sem conhecer o turno: o turno
 * entrega dois ganchos (enviar a recusa pela cadeia normal; entregar ao advogado).
 *
 *  - `seguir`: devolvida ao modelo como veio (ele continua, obedecendo a `instrucao`).
 *  - `recusar`: o `texto` pronto SAI pela cadeia normal de envio — inclusive as travas da OAB — e o
 *    turno encerra sem colher a história. Na 1ª mensagem ao contato, as travas exigem que a resposta
 *    se declare atendimento automatizado: se só isso a vetar, a recusa é reenviada com a apresentação
 *    na frente (a recusa não pode ficar sem sair por causa de uma formalidade). DEPOIS disso a conversa
 *    é passada ao advogado (motivo `triagem_recusa`, item de severidade BAIXA: "confira se a recusa
 *    estava certa") e o robô se cala neste turno e nos seguintes — sem isso o cliente que escrevesse de
 *    novo teria a história colhida por quem acabou de ser recusado. Se a recusa SAIU, o cliente já a leu
 *    e não recebe novo aviso; se NÃO saiu (veto do envio, canal, rascunho), ele recebe o aviso genérico
 *    e o retorno ao modelo e o briefing dizem que a recusa não saiu.
 *  - `passar_ao_advogado`: a passagem acontece AQUI, sem esperar o modelo chamar
 *    `request_human_handoff`. Conflito de interesses NUNCA é contado ao cliente (sigilo: a outra parte
 *    é cliente do escritório) — o aviso é o genérico "um advogado vai responder".
 *
 * O que volta ao modelo depois de uma entrega NÃO carrega o conflito nem os trechos de urgência: ele
 * não precisa saber, e o que ele sabe pode acabar escrito ao cliente.
 */
import type { MotivoDoAviso } from "@/lib/escalacao/aviso-ao-lead";
import type { MotivoDaPassagem, OrigemDaPassagem } from "@/lib/escalacao/passagem";

import type { DecisaoDeTriagem } from "./registrar-triagem";
import { ROTULO_DA_URGENCIA, type UrgenciaJuridica } from "./urgencia-juridica";

/** Instrução curta de sistema: chamar a triagem cedo, com a parte contrária antes da história. */
export const TRIAGEM_SYSTEM_BLOCK =
  "## Triagem jurídica\n" +
  "Assim que entender o assunto do cliente, chame `registrar_triagem` — cedo, antes de colher a história. " +
  "Pergunte primeiro o nome da outra parte (a pessoa ou empresa do outro lado) e só depois peça o relato do caso. " +
  "Obedeça o campo `instrucao` do resultado. Nunca opine sobre o caso nem diga ao cliente se ele tem direito, " +
  "e nunca fale de conflito de interesses com o cliente.";

/** A apresentação que as travas da OAB exigem na 1ª mensagem ao contato. */
export const APRESENTACAO_DA_RECUSA = "Sou o assistente virtual do escritório, um atendimento automatizado.";

export type EntregaAoAdvogado = {
  /** O cliente já leu algo que explica a passagem (a recusa): não manda novo aviso. */
  semAviso?: boolean;
  /** Severidade do item da Central; ausente = crítica (o padrão de toda passagem). */
  severidade?: "info" | "warn" | "critical";
  reason: string;
  motivoCodigo: MotivoDaPassagem;
  origem: OrigemDaPassagem;
  motivoDoAviso: MotivoDoAviso;
  tentativa: { o_que: string; desfecho: string };
  inboxTitle?: string;
  log: string;
};

export type RespostaDoEnvio = { ok?: boolean; status?: string; error?: { code: string } };

export type GanchosDoTurno = {
  /** Envia pelo `send_message` do turno (cadeia inteira). */
  enviarRecusa: (texto: string) => Promise<RespostaDoEnvio>;
  /** Marca a equipe no turno e faz a passagem (aviso ao cliente, depois `performHumanHandoff`). */
  entregar: (entrega: EntregaAoAdvogado) => Promise<void>;
};

type Erro = { ok: false; error: { code: string; message: string } };
type SemCaso = { acao: "passar_ao_advogado"; motivo: "sem_caso" };

/** O envio entregou (ou o canal aceitou entregar) a mensagem ao cliente? Rascunho ou veto não contam. */
export function saiu(envio: RespostaDoEnvio): boolean {
  return envio.ok === true && (envio.status === "enviada" || envio.status === "aceita_aguardando_canal");
}

function entregaDaRecusa(area: string, saiuAoCliente: boolean): EntregaAoAdvogado {
  return {
    reason: "triagem_recusa",
    motivoCodigo: "triagem_recusa",
    origem: "triagem_juridica",
    // Só usado quando a recusa NÃO saiu: aí o cliente ainda não leu nada, e o aviso é o genérico.
    motivoDoAviso: "advogado_vai_responder",
    semAviso: saiuAoCliente,
    severidade: "info",
    tentativa: {
      o_que: `Triagem jurídica: recusa de área (${area})`,
      desfecho: saiuAoCliente
        ? "a recusa educada foi enviada ao cliente; confira se estava certa"
        : "a recusa NÃO chegou ao cliente (envio vetado, canal ou rascunho); ele recebeu o aviso genérico de que um advogado vai responder",
    },
    inboxTitle: "A triagem recusou este contato — confira se a recusa estava certa",
    log: "handoff humano acionado pela triagem jurídica (recusa de área)",
  };
}

const ENCERRE =
  "Não envie mais nenhuma mensagem e encerre o turno agora. Não comente a triagem com o cliente.";

function entregaDaUrgencia(urgencias: readonly UrgenciaJuridica[]): EntregaAoAdvogado {
  const achadas = urgencias.map((u) => `${ROTULO_DA_URGENCIA[u.tipo]}: «${u.trecho}»`).join(" | ");
  return {
    reason: "urgencia_juridica",
    motivoCodigo: "urgencia_juridica",
    origem: "triagem_juridica",
    motivoDoAviso: "urgencia_juridica",
    tentativa: {
      o_que: "Triagem jurídica: urgência",
      desfecho: achadas === "" ? "urgência marcada pelo agente; ver a ficha do caso" : achadas,
    },
    inboxTitle: "Urgência jurídica — o advogado precisa ver agora",
    log: "handoff humano acionado pela triagem jurídica (urgência)",
  };
}

/** Urgência descrita pelo cliente, ANTES do modelo: o mesmo desfecho, a partir do léxico. */
export function entregaPorUrgenciaDoCliente(urgencias: readonly UrgenciaJuridica[]): EntregaAoAdvogado {
  return {
    ...entregaDaUrgencia(urgencias),
    log: "handoff humano acionado por urgência jurídica descrita pelo cliente (detecção determinística)",
  };
}

function entregaDe(decisao: Extract<DecisaoDeTriagem, { acao: "passar_ao_advogado" }> | SemCaso): EntregaAoAdvogado {
  if (decisao.motivo === "urgencia" && "urgencias" in decisao) return entregaDaUrgencia(decisao.urgencias);
  if (decisao.motivo === "conflito") {
    return {
      reason: "triagem_conflito",
      motivoCodigo: "triagem_conflito",
      origem: "triagem_juridica",
      // Aviso GENÉRICO: o cliente nunca ouve a palavra "conflito".
      motivoDoAviso: "advogado_vai_responder",
      tentativa: {
        o_que: "Triagem jurídica: conflito de interesses",
        desfecho: "a parte contrária pode ser cliente do escritório; detalhes na ficha do caso",
      },
      log: "handoff humano acionado pela triagem jurídica (possível conflito de interesses)",
    };
  }
  return {
    reason: "triagem_area",
    motivoCodigo: "triagem_area",
    origem: "triagem_juridica",
    motivoDoAviso: "advogado_vai_responder",
    tentativa: {
      o_que: "Triagem jurídica: área do direito",
      desfecho: "o escritório não tem regra para esta área; o advogado decide se atende",
    },
    log: "handoff humano acionado pela triagem jurídica (área a decidir)",
  };
}

export async function desvioDaTriagem(
  decisao: DecisaoDeTriagem | Erro | SemCaso,
  g: GanchosDoTurno,
): Promise<unknown> {
  if (!("acao" in decisao)) return decisao; // erro de ensino da ferramenta: volta como veio
  if (decisao.acao === "seguir") return decisao;

  if (decisao.acao === "recusar") {
    let envio = await g.enviarRecusa(decisao.texto);
    if (envio.ok === false && envio.error?.code === "trava_oab_identificacao") {
      envio = await g.enviarRecusa(`${APRESENTACAO_DA_RECUSA} ${decisao.texto}`);
    }
    if (envio.ok === false && envio.error?.code === "trava_oab") {
      // A trava da OAB barrou a própria recusa e o turno JÁ entregou a conversa ao advogado
      // (`send_message`): uma segunda passagem duplicaria a linha e o aviso.
      return { ok: false, error: { code: "trava_oab", message: `A conversa foi entregue ao advogado. ${ENCERRE}` } };
    }
    const saiuAoCliente = saiu(envio);
    // A passagem acontece do mesmo jeito: a recusa saindo ou não, o robô não colhe a história.
    await g.entregar(entregaDaRecusa(decisao.area, saiuAoCliente));
    if (!saiuAoCliente) {
      return {
        acao: "recusar",
        enviada: false,
        entregue: true,
        instrucao: `A recusa NÃO chegou ao cliente (${envio.error?.code ?? envio.status ?? "não enviada"}). A conversa foi entregue ao advogado e o cliente foi avisado de que um advogado vai responder. ${ENCERRE}`,
      };
    }
    return {
      acao: "recusar",
      enviada: true,
      entregue: true,
      instrucao: `A recusa já foi enviada ao cliente e a conversa foi passada ao advogado para conferir. ${ENCERRE}`,
    };
  }

  await g.entregar(entregaDe(decisao));
  return {
    acao: "passar_ao_advogado",
    entregue: true,
    instrucao: `A conversa foi entregue ao advogado e o cliente já foi avisado. ${ENCERRE}`,
  };
}
