/**
 * `registrar_triagem` como ferramenta do agente — spec 0001.E3, para o
 * orquestrador LIGAR no turno (esta etapa não toca `inbound-turn.ts`).
 *
 * Mesmo molde de `lib/djen/ferramenta-do-agente.ts`:
 *   - `DEFS_DA_TRIAGEM`, para espalhar em `AGENT_TOOL_DEFS`;
 *   - `ferramentasDaTriagem(...)`, para espalhar em `rawTools`.
 *
 * ⚠️ Esta ferramenta ESCREVE (grava no caso). NÃO a ponha em `READ_ONLY_TOOLS`.
 *
 * Escritório, contato e conversa vêm da LINHA DO JOB, nunca do modelo: o
 * `inputSchema` não tem campo para eles. Sem contato ou conversa (prévia, teste
 * do agente) não há de quem triar, e a resposta é passar para humano.
 */
import { tool } from "@/lib/agent-engine/edge/llm/run-model-call";

import type { Consultavel } from "./banco";
import { executaRegistrarTriagem, registrarTriagemSchema, type DecisaoDeTriagem } from "./registrar-triagem";

export const DEFS_DA_TRIAGEM = {
  registrar_triagem: {
    description:
      "Triagem jurídica: chame assim que entender o assunto do cliente. Registra a área do direito, o resumo do caso (texto limpo, " +
      "sem opinião), o nome da parte contrária (a outra pessoa ou empresa) e qualquer urgência (prazo correndo, audiência marcada, " +
      "alguém preso; `urgencia` aceita `true` ou um destes tipos: preso, prazo, audiencia, despejo, liminar, alimentos_atrasados — " +
      "qualquer outro texto, como \"sem urgência\", não conta). Devolve o que fazer: seguir (e o que ainda falta pedir), recusar com um texto pronto, ou passar ao advogado. " +
      "Obedeça o campo `instrucao`. Nunca dê orientação jurídica nem diga ao cliente se ele tem direito.",
    inputSchema: registrarTriagemSchema,
  },
} as const;

type Erro = { ok: false; error: { code: string; message: string } };

export function ferramentasDaTriagem(ctx: {
  pool: Consultavel;
  tenantId: string;
  /** No motor, "lead" é o CONTATO (`job.contact_id`). */
  leadId: string;
  conversationId: string;
}) {
  return {
    registrar_triagem: tool({
      ...DEFS_DA_TRIAGEM.registrar_triagem,
      execute: async (entrada): Promise<DecisaoDeTriagem | Erro | { acao: "passar_ao_advogado"; motivo: "sem_caso" }> => {
        if (!ctx.leadId || !ctx.conversationId) return { acao: "passar_ao_advogado", motivo: "sem_caso" };
        try {
          return await executaRegistrarTriagem(
            ctx.pool,
            { organizationId: ctx.tenantId, contactId: ctx.leadId, conversationId: ctx.conversationId },
            entrada,
          );
        } catch {
          return {
            ok: false,
            error: { code: "internal_error", message: "a triagem falhou — passe para humano." },
          };
        }
      },
    }),
  };
}
