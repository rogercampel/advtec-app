/**
 * "PRIMEIRA RESPOSTA DO MODELO" — a régua da identificação como máquina (Recomendação nº 001/2024
 * do CFOAB), para o gate `travas_oab`.
 *
 * Até aqui a régua era `disclosure.isFirstOutbound`: "nenhum envio aceito antes para este
 * contato". Ela conta TUDO que o motor mandou — template, aviso de escalação, follow-up
 * determinístico — e por isso o cliente que só recebeu um template e respondeu nunca ouvia o
 * modelo se declarar máquina: o veto de identificação não disparava.
 *
 * Aqui só conta o envio ACEITO escrito pelo MODELO:
 *
 *  - `send_ledger.status = 'accepted'`, deste contato;
 *  - de um job de turno do agente: `inbound_turn`, `case_reply_turn`, ou `followup_turn` SEM
 *    `payload.purpose` (o follow-up dirigido por fluxo tem `purpose` e manda texto fixo);
 *  - `seq > 0`: o aviso de escalação usa `SEQ_DO_AVISO = 0` (`aviso-de-escalacao.ts`);
 *  - a mensagem gravada é texto livre (`messages.type = 'text'`; o `send_template` grava
 *    `template`). `messages.id` é a chave do ledger (`internalMessageId`).
 *
 * LIMITE declarado: o ledger não guarda quem escreveu. Esta é a melhor aproximação que o schema
 * permite, e erra para o lado SEGURO — ela pode deixar de contar um envio do modelo (e então
 * cobrar a identificação de novo), mas não conta como "do modelo" o que o motor mandou por
 * template, aviso ou fluxo. O envio aprovado por humano (`approved_reply`) e o `operator_turn`
 * também ficam de fora.
 */
import type { Queryable } from "@/lib/agent-engine/queue/queue";

export async function modeloJaRespondeuAoContato(db: Queryable, tenantId: string, leadId: string): Promise<boolean> {
  const { rows } = await db.query<{ existe: boolean }>(
    `select exists(
       select 1
         from send_ledger sl
         join job_queue j on j.organization_id = sl.organization_id and j.id = sl.job_id
         join messages m on m.organization_id = sl.organization_id and m.id = sl.id
        where sl.organization_id = $1
          and sl.contact_id = $2
          and sl.status = 'accepted'
          and sl.seq > 0
          and m.type = 'text'
          and (
            j.kind in ('inbound_turn', 'case_reply_turn')
            or (j.kind = 'followup_turn' and j.payload->>'purpose' is null)
          )
     ) as existe`,
    [tenantId, leadId],
  );
  return rows[0]?.existe === true;
}
