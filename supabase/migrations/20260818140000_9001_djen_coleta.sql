-- manifest: **A publicação do DJEN entra inteira, não duplica, e a prova do prazo não sai da mesa.** Traz `djen_oabs_monitoradas` (quais OABs o escritório vigia) e `djen_publicacoes` (o espelho do que a fonte mandou). **`texto` é `not null` de propósito:** a publicação tem de continuar legível com a API do CNJ fora do ar — que é o dia em que ela mais importa; medido em 300 itens de três consultas, 0% vinham sem teor e 2,7% sem `link`, por isso `link` é nulável e `texto` não. A unicidade é **`(organization_id, djen_id)`**, e não `djen_id` global: a MESMA publicação do DJEN pode intimar advogados de escritórios diferentes, e chave global recusaria a segunda — o segundo escritório perderia o prazo sem erro nenhum. **`oabs` é `jsonb`, não par de colunas** (`oab_numero`/`oab_uf`): uma publicação pode intimar DOIS advogados da mesma casa, e a versão inicial guardava só o primeiro que a deduplicação encontrasse; num produto de prazo, quem foi intimado decide quem tem de agir. Índice GIN porque a pergunta da tela é "quais são do advogado X". **Escrita revogada de `authenticated` e `anon`, TRUNCATE incluído** — `revoke insert, update, delete` NÃO cobre TRUNCATE, que é privilégio separado e **ignora RLS por definição**: sem ele, um usuário logado apagaria a prova de prazo de todos os escritórios de uma vez. **E o `grant` não inclui `anon`**, ao contrário do padrão do dump: `anon` é a chave que vai ao navegador, e intimação de cliente não tem caminho legítimo por ela; além disso `tests/unit/varredura-anon-e-o-ultimo-bloco.test.ts` proíbe devolver `anon` depois do bloco da varredura, e este apêndice entra depois dele. Isolamento e grants provados contra Postgres em `tests/invariants/djen-isolamento.test.ts` — os 12 testes de unidade do ticket **não podiam** pegar isso, porque `Map` não tem RLS, `unique` nem `grant`. Idempotente: `create table if not exists`, `create index if not exists`, `drop policy if exists` antes de cada `create policy`, e `revoke` é idempotente por natureza.
--
-- ═══ POR QUE ESTA TABELA EXISTE ═══
--
-- O advogado pessoa física é intimado pelo DJEN. Medido em 18/08/2026
-- (`docs/advtec/FONTES-DE-DADOS.md`): a API do CNJ é pública, sem chave, e
-- filtra por OAB — `numeroOab=100000&ufOab=SP` devolveu 2.712 publicações.
--
-- A tentação seria guardar só o `link` e buscar o teor quando precisar. Isso
-- transforma a prova do que foi publicado numa dependência de terceiro
-- permanecer no ar. Prazo perdido não aceita "a API estava fora".
--
-- Medido em 300 itens reais de três consultas: **0% vêm sem `texto`**, mas
-- **2,7% vêm sem `link`**. Ou seja, o campo que falta é justamente o ponteiro.
-- Por isso `texto` é NOT NULL e `link` é nullable — e não o contrário.
--
-- ═══ DEDUPLICAÇÃO ═══
--
-- A coleta é diária e a janela se sobrepõe de propósito — buscar só "hoje"
-- perde o que a fonte publicou com atraso. Sobreposição sem chave única vira
-- duplicata, e duplicata em lista de prazo é ruído que faz o advogado parar de
-- olhar. `(organization_id, djen_id)` é a chave: `djen_id` é o `id` do próprio
-- CNJ, estável entre coletas.
--
-- ═══ RBAC: POR QUE NÃO TEM POLICY `ALL` SÓ-TENANCY ═══
--
-- A primeira versão desta migration copiou o padrão de `ai_chunks`: uma policy
-- `for all` checando apenas `fn_user_org_ids()`. O invariante da 0150
-- (`tests/invariants/rbac-config-ia-canais.test.ts`) reprovou, e com razão:
--
--     nenhuma tabela NOVA entra com policy ALL só-tenancy
--     expected [ 'djen_oabs_monitoradas', 'djen_publicacoes' ] to deeply equal []
--
-- O PostgREST é exposto ao browser por construção. Policy `ALL` só-tenancy
-- significa que o papel mais fraco do escritório escreve na tabela com o próprio
-- JWT. Aqui isso seria: estagiário apagando publicação, ou editando o teor de
-- uma intimação — a prova do prazo.
--
-- Então cada tabela recebe o tratamento que o seu uso pede:
--
--   `djen_publicacoes`      — SELECT para o escritório; escrita SÓ pelo coletor,
--                             que roda com service role. `revoke` de insert,
--                             update e delete para `authenticated` e `anon`,
--                             no mesmo padrão que a 0160 aplicou a `ai_budgets`.
--
--   `djen_oabs_monitoradas` — configuração: quem decide quais OABs o escritório
--                             acompanha é admin. SELECT para o escritório,
--                             escrita com `fn_role_at_least(org,'admin')`.

-- ── OABs que o escritório monitora ─────────────────────────────────────────
create table if not exists public.djen_oabs_monitoradas (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  numero           text not null,
  uf               char(2) not null,
  nome_advogado    text,
  ativo            boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint djen_oab_unica_por_org unique (organization_id, numero, uf)
);

comment on table public.djen_oabs_monitoradas is
  'OABs cujas publicações o escritório acompanha no DJEN. A coleta itera por aqui.';

-- ── publicações coletadas ──────────────────────────────────────────────────
create table if not exists public.djen_publicacoes (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,

  -- id do CNJ: estável entre coletas, é o que impede duplicata
  djen_id                bigint not null,

  numero_processo        text,
  tipo_comunicacao       text,
  sigla_tribunal         text,
  nome_orgao             text,
  data_disponibilizacao  date not null,

  -- inteiro teor. NOT NULL de propósito: ver o cabeçalho.
  texto                  text not null,
  link                   text,

  -- o que veio da fonte e não foi modelado, preservado como está
  payload                jsonb not null default '{}'::jsonb,

  -- Por quais OABs monitoradas esta publicação entrou. ARRAY, e não par de
  -- colunas: a mesma publicação pode intimar DOIS advogados do escritório, e a
  -- versão anterior guardava só o primeiro que a deduplicação encontrasse. Num
  -- produto de prazo, quem foi intimado não é detalhe.
  --   [{"numero":"12345","uf":"CE"}, ...]
  oabs                   jsonb not null default '[]'::jsonb,

  coletado_em            timestamptz not null default now(),

  constraint djen_publicacao_unica unique (organization_id, djen_id)
);

comment on column public.djen_publicacoes.texto is
  'Inteiro teor guardado na coleta. NOT NULL: a publicação tem de continuar legível com a API fora do ar.';

create index if not exists djen_publicacoes_org_data_idx
  on public.djen_publicacoes (organization_id, data_disponibilizacao desc);

create index if not exists djen_publicacoes_processo_idx
  on public.djen_publicacoes (organization_id, numero_processo)
  where numero_processo is not null;

-- "quais publicações são do advogado X" é a pergunta que a tela faz.
create index if not exists djen_publicacoes_oabs_idx
  on public.djen_publicacoes using gin (oabs);

-- ── isolamento e papel ─────────────────────────────────────────────────────
alter table public.djen_oabs_monitoradas enable row level security;
alter table public.djen_publicacoes      enable row level security;

-- limpa a versão só-tenancy da primeira tentativa
drop policy if exists tenant_isolation_djen_oabs_monitoradas_all on public.djen_oabs_monitoradas;
drop policy if exists tenant_isolation_djen_publicacoes_all      on public.djen_publicacoes;

-- publicações: o escritório lê; ninguém escreve pelo JWT do usuário
drop policy if exists djen_publicacoes_select on public.djen_publicacoes;
create policy djen_publicacoes_select
  on public.djen_publicacoes
  for select
  using (fn_is_platform_admin() or (organization_id in (select fn_user_org_ids())));

-- OABs monitoradas: leitura para o escritório, escrita para admin
drop policy if exists djen_oabs_monitoradas_select on public.djen_oabs_monitoradas;
create policy djen_oabs_monitoradas_select
  on public.djen_oabs_monitoradas
  for select
  using (fn_is_platform_admin() or (organization_id in (select fn_user_org_ids())));

drop policy if exists djen_oabs_monitoradas_admin on public.djen_oabs_monitoradas;
create policy djen_oabs_monitoradas_admin
  on public.djen_oabs_monitoradas
  for all
  using  (fn_is_platform_admin() or fn_role_at_least(organization_id, 'admin'))
  with check (fn_is_platform_admin() or fn_role_at_least(organization_id, 'admin'));

-- SEM `anon`. Duas razões, e as duas bastam sozinhas:
--
-- 1. `tests/unit/varredura-anon-e-o-ultimo-bloco.test.ts` proíbe devolver `anon`
--    depois do bloco da varredura, e este apêndice entra depois dele.
-- 2. `anon` é a chave que vai para o navegador. Prazo e intimação de cliente não
--    têm caminho legítimo por ela — nem para SELECT, que a RLS filtraria mas a
--    própria existência do grant já expõe no schema do PostgREST.
grant all on table public.djen_oabs_monitoradas to authenticated, service_role;
grant all on table public.djen_publicacoes      to authenticated, service_role;

-- O coletor roda com service role, que passa por cima da RLS. Nenhum caminho de
-- produto escreve publicação com o JWT do usuário — então a escrita sai da mesa
-- em vez de depender de policy. Idempotente por natureza.
revoke insert, update, delete, truncate on table public.djen_publicacoes from authenticated, anon;

-- TRUNCATE e privilegio separado e IGNORA RLS. Sem revogar, um usuario logado
-- apaga a prova de prazo de todos os escritorios de uma vez.
revoke truncate on table public.djen_oabs_monitoradas from authenticated, anon;

notify pgrst, 'reload schema';
