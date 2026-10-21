-- manifest: **A consulta fica guardada com o resultado, porque a base do CNJ muda todo dia.** Traz `datajud_recortes` (a pergunta que o escritório faz ao DataJud, com a consulta Elasticsearch exata em `jsonb`) e `datajud_processos` (o espelho do que veio, na data em que foi visto). Sem o par pergunta+data, o número que o advogado viu ontem não é reproduzível hoje — e estatística que não se reproduz não se defende. **A FK é COMPOSTA `(recorte_id, organization_id)`**, com o `unique (id, organization_id)` correspondente no pai, e não `references datajud_recortes(id)`: FK simples deixava gravar o processo do recorte do escritório A sob o `organization_id` do B, e a policy de SELECT — que filtra por `organization_id` — entregaria a linha ao inquilino errado. Num produto jurídico isso é quebra de sigilo, não bug de listagem; **medido por mutação**, com a FK simples o insert cruzado PASSA. **`data_ajuizamento_bruto` guarda a string como veio.** O CNJ devolve `YYYYMMDDHHMMSS` (medido 18/08/2026 no TJSP: `"20260629120145"`, e a fixture do repositório usava ISO — os testes ficavam verdes e o insert em `timestamptz` quebraria na primeira coleta real), e o formato **não declara fuso**: interpretamos UTC porque a coluna exige uma decisão, e a suposição não foi confirmada com o CNJ. Se estiver errada são 3 horas em toda data, e esta coluna faz a correção ser um `update` em vez de recoletar a base. **`ultimo_total` e `ultima_coleta_truncada`** existem porque `vistos` lia como "quantos processos o órgão tem" e é o tamanho da página: a spec 0007 cita órgão com 2.653.656 processos e o recorte padrão pede 500. Escrita revogada de `authenticated` e `anon` **com TRUNCATE junto** (privilégio separado, e IGNORA RLS), e o `grant` **não inclui `anon`** — a chave do navegador não tem caminho legítimo para processo de cliente, e devolvê-la depois do bloco da varredura desarma a cura no mesmo run. Isolamento, FK e grants provados contra Postgres em `tests/invariants/datajud-isolamento.test.ts`; os 18 testes de unidade do ticket **não podiam** pegar nada disso, porque o fake deles é um `Map` e `Map` não tem chave estrangeira. Idempotente: `if not exists` em tabelas e índices, `drop policy if exists` antes de cada `create policy`, e `revoke` é idempotente por natureza.
--
-- ═══ POR QUE ESPELHAR, EM VEZ DE CONSULTAR NA HORA ═══
--
-- O DataJud é um Elasticsearch público do CNJ. Chave documentada, medida em
-- 18/08/2026 (`docs/advtec/FONTES-DE-DADOS.md`): responde, agrega, e devolve
-- `movimentos` com data e hora — é de lá que sai desfecho e tempo de tramitação.
--
-- Consultar na hora, toda vez, tem um defeito que só aparece tarde: **duas
-- perguntas iguais em dias diferentes devolvem números diferentes**, porque a
-- base do CNJ é atualizada continuamente. Uma estatística que muda sozinha não
-- pode ser mostrada a advogado — ele decide estratégia com ela, e depois não
-- consegue reproduzir o número que viu.
--
-- Por isso o recorte é guardado com a consulta que o gerou e a data em que foi
-- coletado. Toda estatística da spec 0007 cita esse par. É o critério de aceite
-- 8: "toda estatística mostra o filtro que a gerou e a data da coleta".
--
-- ═══ O QUE NÃO SE FAZ AQUI ═══
--
-- Esta migration não julga dado. Data de ajuizamento em 1888 — medida, existe —
-- entra no espelho como veio. Descartar na coleta esconderia o tamanho da
-- sujeira; quem descarta, contando quantos descartou, é a **E2**.
--
-- ═══ RBAC ═══
--
-- Lição da 9001: o invariante da 0150 reprova tabela nova com policy `ALL`
-- só-tenancy, e com razão — o PostgREST vai ao browser.
--
--   `datajud_processos` — espelho. Escrito só pelo coletor, com service role.
--                         SELECT para o escritório; insert/update/delete
--                         revogados de `authenticated` e `anon`.
--   `datajud_recortes`  — configuração: qual pergunta o escritório acompanha.
--                         SELECT para o escritório, escrita com
--                         `fn_role_at_least(org,'admin')`.

-- ── o recorte: a pergunta, guardada junto da resposta ──────────────────────
create table if not exists public.datajud_recortes (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,

  rotulo                 text not null,
  tribunal               text not null,          -- ex.: 'tjsp' (o alias do índice)
  classe_codigo          integer,
  assunto_codigo         integer,
  orgao_julgador_codigo  integer,

  -- a consulta exata mandada ao Elasticsearch. É o que torna o número conferível.
  consulta               jsonb not null,

  ativo                  boolean not null default true,
  ultima_coleta_em       timestamptz,

  -- `hits.total` da última coleta, e se a página cortou. Sem os dois, `vistos`
  -- parece "quantos processos o órgão tem" e é só o tamanho da página: a spec
  -- 0007 cita órgão com 2.653.656 processos, e o espelho guarda 500.
  ultimo_total           bigint,
  ultima_coleta_truncada boolean not null default false,
  created_at             timestamptz not null default now(),

  constraint datajud_recorte_unico unique (organization_id, tribunal, rotulo),

  -- Existe só para a tabela filha poder apontar para o PAR (id, organização).
  -- Sem ela, `datajud_processos` conseguiria referenciar um recorte de OUTRO
  -- escritório e a policy de SELECT entregaria o dado ao inquilino errado.
  constraint datajud_recorte_id_org unique (id, organization_id)
);

comment on table public.datajud_recortes is
  'A pergunta que o escritório faz ao DataJud. Guardada porque estatística sem filtro declarado não é conferível.';

-- ── o espelho: os processos daquele recorte, na data em que foram vistos ───
create table if not exists public.datajud_processos (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  recorte_id             uuid not null,

  -- `_id` do documento no índice do CNJ
  datajud_id             text not null,

  tribunal               text not null,
  numero_processo        text,
  grau                   text,
  data_ajuizamento       timestamptz,

  -- A string exata do CNJ, guardada ao lado da interpretada. O formato é
  -- `YYYYMMDDHHMMSS` e **não diz o fuso**: assumimos UTC para poder gravar em
  -- `timestamptz`, e essa suposição não foi confirmada com o CNJ. Se estiver
  -- errada, são 3 horas em toda data, e é isto aqui que permite corrigir sem
  -- recoletar — que é a razão de a tabela existir.
  data_ajuizamento_bruto text,

  -- 0 = público. A spec 0007 exige que só público entre em estatística; o filtro
  -- é da E3 em diante, mas o campo tem de estar aqui para poder filtrar.
  nivel_sigilo           integer,

  orgao_julgador_codigo  integer,
  orgao_julgador_nome    text,
  classe_codigo          integer,
  classe_nome            text,

  assuntos               jsonb not null default '[]'::jsonb,
  movimentos             jsonb not null default '[]'::jsonb,

  coletado_em            timestamptz not null default now(),

  constraint datajud_processo_unico unique (organization_id, recorte_id, datajud_id),

  -- FK COMPOSTA, e não `references datajud_recortes(id)`. É o banco recusando
  -- a mistura entre escritórios, em vez de a aplicação prometer não misturar.
  constraint datajud_processo_recorte_fk
    foreign key (recorte_id, organization_id)
    references public.datajud_recortes (id, organization_id)
    on delete cascade
);

comment on column public.datajud_processos.movimentos is
  'Movimentação como veio do CNJ. Desfecho (Procedência, Improcedência, Parcial) sai daqui na E3.';
comment on column public.datajud_processos.data_ajuizamento is
  'Como veio. Datas impossíveis (medido: 1888) NÃO são descartadas aqui — a E2 descarta, contando.';

create index if not exists datajud_processos_recorte_idx
  on public.datajud_processos (organization_id, recorte_id);

create index if not exists datajud_processos_orgao_idx
  on public.datajud_processos (organization_id, orgao_julgador_codigo)
  where orgao_julgador_codigo is not null;

-- ── isolamento e papel ─────────────────────────────────────────────────────
alter table public.datajud_recortes  enable row level security;
alter table public.datajud_processos enable row level security;

drop policy if exists datajud_recortes_select on public.datajud_recortes;
create policy datajud_recortes_select
  on public.datajud_recortes
  for select
  using (fn_is_platform_admin() or (organization_id in (select fn_user_org_ids())));

drop policy if exists datajud_recortes_admin on public.datajud_recortes;
create policy datajud_recortes_admin
  on public.datajud_recortes
  for all
  using  (fn_is_platform_admin() or fn_role_at_least(organization_id, 'admin'))
  with check (fn_is_platform_admin() or fn_role_at_least(organization_id, 'admin'));

drop policy if exists datajud_processos_select on public.datajud_processos;
create policy datajud_processos_select
  on public.datajud_processos
  for select
  using (fn_is_platform_admin() or (organization_id in (select fn_user_org_ids())));

-- SEM `anon`, e a razão vale para toda tabela deste produto: `anon` é a chave
-- que vai ao navegador. Dado de processo de cliente não tem caminho legítimo
-- por ela. Além disso `tests/unit/varredura-anon-e-o-ultimo-bloco.test.ts`
-- proíbe devolver `anon` depois do bloco da varredura, e este apêndice entra
-- depois dele — o grant desarmava a cura no mesmo run.
grant all on table public.datajud_recortes  to authenticated, service_role;
grant all on table public.datajud_processos to authenticated, service_role;

-- Espelho é escrito só pelo coletor (service role, que passa por cima da RLS).
-- Nenhum caminho de produto escreve processo com o JWT do usuário.
revoke insert, update, delete, truncate on table public.datajud_processos from authenticated, anon;
revoke truncate on table public.datajud_recortes from authenticated, anon;

notify pgrst, 'reload schema';
