-- manifest: **O prazo só é fato depois que alguém do escritório confirma a data final.** A pauta (spec 0009) mostra prazo sempre como sugestão; esta migration guarda a confirmação humana na própria publicação: a data em que vence, quem confirmou e quando, e uma observação curta. Não há contagem automática aqui (a 0006.E4 espera o questionário de contagem): quem conta é o escritório (papel de atendente ou acima), e o sistema só guarda e mostra. Escrita só pela rota do servidor (service role), que grava quem confirmou e quando; corrigir regrava os três, sem histórico da data anterior; o papel autenticado continua sem UPDATE em `djen_publicacoes` (migration 9001). Idempotente: `add column if not exists`, `drop constraint if exists` antes do `add`, `create index if not exists`.

alter table public.djen_publicacoes add column if not exists prazo_vence_em date;
alter table public.djen_publicacoes add column if not exists prazo_confirmado_em timestamptz;
alter table public.djen_publicacoes add column if not exists prazo_confirmado_por uuid references auth.users(id) on delete set null;
alter table public.djen_publicacoes add column if not exists prazo_observacao text;

-- Confirmação é tudo ou nada: a data final e o momento da confirmação andam
-- juntos. `prazo_confirmado_por` pode ficar nulo depois (usuário removido), por
-- isso fica fora da regra. A observação é curta e opcional.
alter table public.djen_publicacoes drop constraint if exists djen_publicacao_prazo_confirmado_completo;
alter table public.djen_publicacoes add constraint djen_publicacao_prazo_confirmado_completo check (
  ((prazo_vence_em is null) = (prazo_confirmado_em is null))
  and (prazo_observacao is null or length(prazo_observacao) <= 300)
);

-- A pauta lê À PARTE os prazos confirmados a partir do corte do vencido, por
-- escritório, para nenhum cair fora pelo teto das publicações recentes.
create index if not exists djen_publicacoes_prazo_idx
  on public.djen_publicacoes (organization_id, prazo_vence_em)
  where prazo_vence_em is not null;

notify pgrst, 'reload schema';
