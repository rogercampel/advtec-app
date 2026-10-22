-- manifest: **AdvTec: mensagem de histórico importado não dispara nada.** O importador sob demanda do histórico do WhatsApp (`lib/waha/historico.ts`) grava mensagens antigas com `metadata.historico_importado = true`, a marca que a 0686 já prevê e respeita. Três gatilhos de `messages` não a olhavam. Medido em 22/10/2026 no banco local, numa transação desfeita: uma mensagem recebida importada EMITIA `message.received` (o evento que push, webhook de saída, campanha, follow-up e o agente escutam — responderiam AGORA uma mensagem de meses atrás) e somava +1 em `conversations.reply_context_revision`; pelo mesmo caminho, `fn_service_inbound` reabriria a conversa e abriria demanda. O corte fica no CORPO das três funções, junto do corte da reação que já existe e pelo mesmo motivo que o upstream escreveu para ela ("o corte fica no corpo, onde a regra é lida"): `fn_emit_message_event`, `fn_demanda_abre_no_inbound` e `fn_reply_inbound_revision` passam a sair cedo também quando `coalesce(new.metadata ->> 'historico_importado', '') = 'true'`, a mesma expressão da 0686. O resto de cada corpo é o da ÚLTIMA definição do `baseline.sql`, byte a byte, e a ACL é a dela. Mensagem sem a marca segue exatamente como antes. Gate: `tests/invariants/historico-importado-nao-dispara.test.ts`. Espelhado no apêndice de `supabase/baseline.sql`.

create or replace function public.fn_emit_message_event() returns trigger
language plpgsql set search_path to 'public', 'pg_temp' as $fn$
declare
  v_event text;
begin
  -- A reação não vira evento. O `type='reaction'` sai antes de escolher o
  -- evento: sem isto, a linha emitia `message.received` (ou, quando o operador
  -- reagia, `message.outbound`) e acordava push, webhook de saída, campanha e
  -- follow-up — consumidores que não filtram o tipo. Nenhum evento é a resposta
  -- certa: reação não é mensagem, e não existe evento de reação.
  --
  -- AdvTec (9008): o histórico importado também não. Ele é passado, e todo
  -- consumidor deste evento age como se a mensagem tivesse acabado de chegar.
  if new.type = 'reaction' or coalesce(new.metadata ->> 'historico_importado', '') = 'true' then
    return new;
  end if;
  if new.direction = 'inbound' then
    if exists (select 1 from public.conversations c
               where c.id = new.conversation_id and c.organization_id = new.organization_id and c.is_group) then
      v_event := 'message.group_received';
    else
      v_event := 'message.received';
    end if;
  else
    v_event := case new.status
                 when 'sending' then 'message.sending'
                 when 'sent' then 'message.sent'
                 when 'failed' then 'message.failed'
                 else 'message.outbound'
               end;
  end if;

  perform public.fn_log_event(
    new.organization_id, v_event,
    jsonb_build_object(
      'message_id', new.id, 'conversation_id', new.conversation_id,
      'contact_id', new.contact_id, 'direction', new.direction,
      'type', new.type, 'status', new.status, 'external_id', new.external_id,
      'channel_session_id', new.channel_session_id,
      'body_preview', "left"(new.body, 280)
    )
  );
  return new;
end$fn$;
grant all on function public.fn_emit_message_event() to anon;
grant all on function public.fn_emit_message_event() to authenticated;
grant all on function public.fn_emit_message_event() to service_role;

create or replace function public.fn_demanda_abre_no_inbound()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  -- A REAÇÃO NÃO É MENSAGEM RECEBIDA. Sem este corte, o INSERT da linha
  -- `type='reaction'` chamava `fn_service_inbound`, que reabre a conversa
  -- encerrada e abre uma demanda nova para um gesto que não é fala.
  --
  -- AdvTec (9008): o histórico importado também não reabre nem abre demanda.
  if new.type = 'reaction' or coalesce(new.metadata ->> 'historico_importado', '') = 'true' then
    return new;
  end if;
  perform public.fn_service_inbound(new.id);
  return new;
end; $fn$;
revoke execute on function public.fn_demanda_abre_no_inbound() from public,anon,authenticated;

create or replace function public.fn_reply_inbound_revision() returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  -- A revisão de contexto é "o cliente falou de novo" — e a reação não é fala.
  -- Sem o corte, um 👍 somava +1 e invalidava o rascunho de resposta da tela à
  -- toa, além de contar junto com a reabertura (que este bloco também acabou de
  -- desligar).
  --
  -- AdvTec (9008): o histórico importado não é "falou de novo".
  if new.direction='inbound' and new.type <> 'reaction'
     and coalesce(new.metadata ->> 'historico_importado', '') <> 'true' then
    update public.conversations set reply_context_revision=reply_context_revision+1 where organization_id=new.organization_id and id=new.conversation_id and contact_id=new.contact_id;
  end if;
  return new;
end;$fn$;
revoke all on function public.fn_reply_inbound_revision() from public,anon,authenticated;
