/**
 * A consulta do caso como ferramenta do agente do WhatsApp — spec 0010.E3
 * (AdvTec). O resto do motor é do original; daqui ele recebe duas peças:
 *   - `DEFS_DA_ADVTEC`, espalhada em `AGENT_TOOL_DEFS`;
 *   - `ferramentasDaAdvTec(...)`, espalhada em `rawTools`.
 * Mais `consultar_andamento` em `READ_ONLY_TOOLS` (só lê).
 *
 * O que entra vem da LINHA DO JOB (escritório, contato, conversa), nunca do
 * modelo — a ferramenta não tem argumento. A pergunta do cliente é lida do
 * banco (a última mensagem RECEBIDA desta conversa, deste contato): sem ela não
 * há resposta (critério 6), e o modelo não consegue reescrever uma pergunta de
 * mérito para fazê-la passar (critério 4).
 *
 * Quem envia é o `send_message` do motor. No modo assistido ele vira rascunho e
 * nada sai sem aprovação (critério 7). A ferramenta devolve o texto montado ou a
 * ordem de passar para humano; obedecer é do modelo, e por isso o envio direto
 * não deve ser ligado para escritório que use esta ferramenta.
 */
import { z } from "zod";

import { tool } from "@/lib/agent-engine/edge/llm/run-model-call";
import { consultaDoCaso, type Consultavel } from "@/lib/djen/consulta-do-caso";
import { decideAndamento, type DecisaoDeAndamento } from "@/lib/djen/resposta-de-andamento";

export const DEFS_DA_ADVTEC = {
  consultar_andamento: {
    description:
      "Quando o cliente pergunta como está o processo dele: lê as últimas publicações dos casos LIGADOS a este contato " +
      "e devolve a resposta pronta (data e tipo de ato) ou a ordem de passar para humano. Envie o `texto` exatamente " +
      "como veio, sem acrescentar interpretação, previsão ou opinião. Se vier `passar_para_humano`, não fale do processo: " +
      "chame request_human_handoff.",
    inputSchema: z.object({}),
  },
} as const;

export type QuemEstaNoTurno = { organizationId: string; contactId: string; conversationId: string };

/** A última mensagem recebida nesta conversa, deste contato. Vazio = ninguém perguntou. */
export async function ultimaPerguntaDoCliente(db: Consultavel, quem: QuemEstaNoTurno): Promise<string> {
  const { rows } = await db.query<{ body: string | null }>(
    `select m.body
       from public.messages m
       join public.conversations c on c.id = m.conversation_id and c.organization_id = m.organization_id
      where m.organization_id = $1
        and m.conversation_id = $2
        and c.contact_id = $3
        and m.direction = 'inbound'
      order by m.created_at desc
      limit 1`,
    [quem.organizationId, quem.conversationId, quem.contactId],
  );
  return rows[0]?.body ?? "";
}

/** Separado do `tool()` do SDK para ser testável sem o motor. */
export async function executaConsultarAndamento(
  db: Consultavel,
  quem: QuemEstaNoTurno,
  contexto: { primeiraResposta: boolean },
): Promise<DecisaoDeAndamento> {
  const pergunta = await ultimaPerguntaDoCliente(db, quem);
  // Sem pergunta não se consulta nada: a decisão já sai "sem_mensagem".
  if (pergunta.trim() === "") return decideAndamento("", { casos: [], andamentos: [], sigiloso: false }, contexto);
  const consulta = await consultaDoCaso(db, { organizationId: quem.organizationId, contactId: quem.contactId });
  return decideAndamento(pergunta, consulta, contexto);
}

/**
 * As ferramentas que o motor espalha em `rawTools`. `tool` vem do mesmo módulo
 * que o motor usa, para o SDK ver a mesma forma.
 */
export function ferramentasDaAdvTec(ctx: {
  pool: Consultavel;
  tenantId: string;
  leadId: string;
  conversationId: string;
}) {
  return {
    consultar_andamento: tool({
      ...DEFS_DA_ADVTEC.consultar_andamento,
      execute: async (): Promise<DecisaoDeAndamento | { ok: false; error: { code: string; message: string } }> => {
        // Sem contato ou conversa (prévia, teste do agente): não há de quem falar.
        if (!ctx.leadId || !ctx.conversationId) return { acao: "passar_para_humano", motivo: "sem_caso" };
        try {
          return await executaConsultarAndamento(
            ctx.pool,
            { organizationId: ctx.tenantId, contactId: ctx.leadId, conversationId: ctx.conversationId },
            // A frase não se identifica como máquina; quem identifica é a abertura do agente.
            { primeiraResposta: false },
          );
        } catch {
          return {
            ok: false,
            error: { code: "internal_error", message: "a consulta do processo falhou — passe para humano." },
          };
        }
      },
    }),
  };
}
