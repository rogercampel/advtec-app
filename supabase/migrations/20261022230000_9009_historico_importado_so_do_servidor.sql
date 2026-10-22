-- manifest: **AdvTec: a marca de histórico importado só vale quando quem grava é o servidor.** A 9008 faz os gatilhos de `messages` ignorarem a linha com `metadata.historico_importado = true`. Mas `messages` tem `GRANT ALL` para `authenticated` e a policy `messages_insert` aceita qualquer membro da organização (`viewer` inclusive). Achado na auditoria de 22/10/2026, com PoC em Postgres real: sem a marca, o insert de recebida por usuário logado é RECUSADO (`message.received` é evento reservado ao servidor; `emit_event` levanta `reserved_message_received`); com a marca, o gatilho nem tenta emitir, e uma "fala do cliente" falsa entrava gravada, sem evento, sem demanda e sem aviso. A 9008 abriu esse caminho; não existia antes. Gatilho NOVO `trg_messages_marca_de_importado` (BEFORE INSERT), função `fn_messages_marca_de_importado`: apaga a chave `historico_importado` do `metadata` quando o papel do token (`request.jwt.claim.role` ou `request.jwt.claims`->>'role', a mesma leitura de `fn_responder_caso_por_whatsapp`) existe e não é `service_role`. Sem token (conexão direta ao Postgres: backend com pool próprio, migration, teste) continua valendo como servidor — só o PostgREST põe `authenticated`/`anon` no token. Nenhuma função existente muda. Gate: `tests/invariants/historico-importado-so-do-servidor.test.ts`. Espelhado no apêndice de `supabase/baseline.sql`.

create or replace function public.fn_messages_marca_de_importado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
  );
begin
  -- A marca cala os gatilhos de `messages` (9008). Só o servidor importa histórico;
  -- usuário logado que a manda pela API perde a chave e a linha dispara como
  -- qualquer outra.
  if v_role is not null and v_role <> 'service_role'
     and new.metadata is not null and new.metadata ? 'historico_importado' then
    new.metadata := new.metadata - 'historico_importado';
  end if;
  return new;
end;
$fn$;
revoke execute on function public.fn_messages_marca_de_importado() from public, anon, authenticated;

drop trigger if exists trg_messages_marca_de_importado on public.messages;
create trigger trg_messages_marca_de_importado
  before insert on public.messages
  for each row execute function public.fn_messages_marca_de_importado();
