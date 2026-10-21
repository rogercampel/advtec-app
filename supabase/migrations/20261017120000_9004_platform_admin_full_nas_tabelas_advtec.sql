-- manifest: **Admin de suporte somente-leitura deixa de escrever nas tabelas da AdvTec.** As policies de escrita de `djen_oabs_monitoradas` e `datajud_recortes` aceitavam `fn_is_platform_admin()`, que ignora o escopo do JWT; passam a `fn_is_platform_admin_full()`, o mesmo conserto que a 0508/0533 do original aplicou nas tabelas dele. A leitura segue nas policies `_select`, com a função pura.

-- Achado pelo invariante tests/invariants/platform-admin-full-so-escreve.test.ts
-- ("CONTA GLOBAL"), na atualização do fork com o original em 17/10/2026: as duas
-- policies nasceram (0161/0162, hoje 9001/9002) antes de a 0508 existir.
-- Idempotente: drop policy if exists antes de cada create. O baseline traz o
-- mesmo texto nos apêndices da AdvTec.

drop policy if exists djen_oabs_monitoradas_admin on public.djen_oabs_monitoradas;
create policy djen_oabs_monitoradas_admin
  on public.djen_oabs_monitoradas
  for all
  using  (fn_is_platform_admin_full() or fn_role_at_least(organization_id, 'admin'))
  with check (fn_is_platform_admin_full() or fn_role_at_least(organization_id, 'admin'));

drop policy if exists datajud_recortes_admin on public.datajud_recortes;
create policy datajud_recortes_admin
  on public.datajud_recortes
  for all
  using  (fn_is_platform_admin_full() or fn_role_at_least(organization_id, 'admin'))
  with check (fn_is_platform_admin_full() or fn_role_at_least(organization_id, 'admin'));
