-- manifest: **O alarme precisa de memória do que rodou.** A spec 0006 chama a E6 de bloqueante — "coleta sem alarme de falha é pior que não ter coleta, porque cria confiança sem lastro" — e o critério 7 exige aviso em até 1 hora. **Uma TABELA, e não um campo de "última coleta":** o perigo real não é a coleta falhar (falha aparece), é ela PARAR DE RODAR e ninguém notar — o escritório abre a tela, vê a lista de ontem e conclui que hoje não houve publicação. Para distinguir "não houve publicação" de "não houve coleta" é preciso saber que a coleta ACONTECEU, e um campo de última-vez apaga a tentativa que falhou. `ok` nasce `false` de propósito: processo morto no meio deixa a linha em falso, que é a verdade, e não em "sem informação". `alarme_enviado_em` é o que impede avisar de hora em hora sobre a mesma falha — o critério pede avisar EM até 1 hora, não avisar TODA hora, e alarme que ninguém lê é igual a alarme que não existe. Índice parcial `where ok` porque a pergunta do alarme é "qual foi a última coleta boa desta organização". Escrita revogada de `authenticated` e `anon` com TRUNCATE junto: sem ele um usuário logado apaga o histórico e o alarme passa a achar que a coleta nunca rodou. `grant` **sem `anon`** (chave do navegador; e devolver `anon` depois do bloco da varredura desarma a cura no mesmo run). **O envio do alarme NÃO está aqui** — a migration guarda o fato e a marca de que o aviso saiu; por onde ele sai é decisão de produto. Idempotente: `if not exists`, `drop policy if exists`, e `revoke` por natureza.
--
-- A spec 0006 diz, com todas as letras: "E6 sobe junto de E1 em produção. Coleta
-- sem alarme de falha é pior que não ter coleta, porque cria confiança sem
-- lastro." O critério 7 exige alarme em até 1 hora.
--
-- ═══ POR QUE UMA TABELA, E NÃO UM CAMPO ═══
--
-- O perigo real não é a coleta falhar — falha aparece. É a coleta **parar de
-- rodar** e ninguém notar: o escritório continua abrindo a tela, vê a lista de
-- ontem, e conclui que não houve publicação nenhuma. Silêncio parece calmaria.
--
-- Para distinguir "não houve publicação" de "não houve coleta" é preciso saber
-- que a coleta ACONTECEU. Isso é um registro de execuções, e não um campo de
-- "última vez" — que some a informação da tentativa que falhou.
--
-- ═══ O QUE NÃO ESTÁ AQUI ═══
--
-- O envio do alarme. Esta migration guarda o fato e a marca de que o aviso saiu;
-- por onde ele sai (e-mail, WhatsApp, painel) é decisão de produto e vive fora.

create table if not exists public.djen_coletas (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,

  iniciada_em            timestamptz not null default now(),
  terminada_em           timestamptz,

  -- `false` até a coleta terminar bem. Nasce falso de propósito: processo morto
  -- no meio deixa a linha em falso, que é a verdade — e não em "sem informação".
  ok                     boolean not null default false,

  oabs_consultadas       integer not null default 0,
  publicacoes_vistas     integer not null default 0,
  gravadas               integer not null default 0,

  -- [{"oab":"12345/CE","motivo":"HTTP 503"}, ...]
  falhas                 jsonb not null default '[]'::jsonb,

  -- Quando o alarme desta coleta foi disparado. NULL = ainda não avisamos.
  -- É o que impede avisar de hora em hora sobre a mesma falha.
  alarme_enviado_em      timestamptz
);

comment on table public.djen_coletas is
  'Registro de execuções da coleta do DJEN. Existe para o alarme saber que a coleta PAROU, e não só que ela falhou.';

create index if not exists djen_coletas_org_inicio_idx
  on public.djen_coletas (organization_id, iniciada_em desc);

-- A pergunta do alarme é "qual foi a última coleta OK desta organização".
create index if not exists djen_coletas_org_ok_idx
  on public.djen_coletas (organization_id, iniciada_em desc)
  where ok;

-- ── isolamento e papel ─────────────────────────────────────────────────────
alter table public.djen_coletas enable row level security;

drop policy if exists djen_coletas_select on public.djen_coletas;
create policy djen_coletas_select
  on public.djen_coletas
  for select
  using (fn_is_platform_admin() or (organization_id in (select fn_user_org_ids())));

-- SEM `anon`. Este apêndice entra depois do bloco da varredura, e devolver
-- `anon` ali desarma a cura no mesmo run — além de `anon` ser a chave que vai
-- ao navegador, que não tem o que fazer com o histórico de coleta do escritório.
grant all on table public.djen_coletas to authenticated, service_role;

-- Escrita só pelo coletor, que roda com service role. TRUNCATE junto: é
-- privilégio separado e IGNORA RLS — sem revogar, um usuário logado apaga o
-- histórico inteiro e o alarme passa a achar que a coleta nunca rodou.
revoke insert, update, delete, truncate on table public.djen_coletas from authenticated, anon;

notify pgrst, 'reload schema';
