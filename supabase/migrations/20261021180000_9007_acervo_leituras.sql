-- manifest: **A leitura de um processo é guardada, do escritório, e só o servidor escreve nela.** Spec 0003.E6: o advogado envia o PDF, a leitura leva minutos (blocos de páginas pelo modelo), e o documento de saída precisa ficar para ser aberto e impresso depois. `acervo_leituras` guarda o andamento (`lendo` → `pronta` ou `falhou`), o documento (`jsonb`, com toda afirmação já com página) e o motivo da falha. **O PDF não é guardado** — só o documento, que já traz os trechos citados. O check `acervo_leitura_pronta_tem_documento` impede "pronta" sem documento e documento em leitura que falhou: a tela nunca mostra resultado parcial como se fosse o final. **Leitura do escritório pela RLS; escrita só por service role** (a rota da leitura, que recebe a organização de `requireRole`, nunca do corpo): `insert`, `update`, `delete` e `truncate` revogados de `authenticated` e `anon` — TRUNCATE é privilégio separado e ignora RLS. Sem `grant` para `anon`: o documento traz trecho de processo de cliente. Isolamento provado contra Postgres em `tests/invariants/acervo-leituras-isolamento.test.ts`. Idempotente: `create table if not exists`, `drop constraint/policy if exists` antes de cada `add/create`, `create index if not exists`.

create table if not exists public.acervo_leituras (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  criada_por uuid references auth.users(id) on delete set null,
  nome_do_arquivo text not null,
  total_de_paginas integer not null,
  estado text not null default 'lendo',
  documento jsonb,
  motivo_da_falha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.acervo_leituras drop constraint if exists acervo_leitura_estado_valido;
alter table public.acervo_leituras add constraint acervo_leitura_estado_valido check (
  estado in ('lendo', 'pronta', 'falhou')
  and length(nome_do_arquivo) between 1 and 255
  and total_de_paginas >= 0
  and (motivo_da_falha is null or length(motivo_da_falha) <= 300)
);

-- Pronta tem documento; falhou tem motivo e não tem documento; lendo não tem nenhum dos dois.
alter table public.acervo_leituras drop constraint if exists acervo_leitura_pronta_tem_documento;
alter table public.acervo_leituras add constraint acervo_leitura_pronta_tem_documento check (
  (estado = 'pronta' and documento is not null and motivo_da_falha is null)
  or (estado = 'falhou' and documento is null and motivo_da_falha is not null)
  or (estado = 'lendo' and documento is null and motivo_da_falha is null)
);

-- A tela lista as leituras do escritório, da mais nova para a mais velha.
create index if not exists acervo_leituras_org_idx on public.acervo_leituras (organization_id, created_at desc);

alter table public.acervo_leituras enable row level security;

drop policy if exists acervo_leituras_select on public.acervo_leituras;
create policy acervo_leituras_select
  on public.acervo_leituras
  for select
  using (fn_is_platform_admin() or (organization_id in (select fn_user_org_ids())));

grant all on table public.acervo_leituras to authenticated, service_role;
revoke insert, update, delete, truncate on table public.acervo_leituras from authenticated, anon;

notify pgrst, 'reload schema';
