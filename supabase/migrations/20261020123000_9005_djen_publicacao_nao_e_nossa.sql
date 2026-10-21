-- manifest: **"Não é nosso" tem autor, data e motivo.** A caixa de publicações não reconhecidas (spec 0009.E2) só deixa sair uma publicação por três caminhos — ligar a um caso, criar caso, ou descartar com motivo. As duas primeiras usam o negócio do funil (ADR 0003); esta guarda a terceira na própria publicação, sem tabela nova. Escrita só pela rota do servidor (service role); o papel autenticado continua sem UPDATE.

alter table public.djen_publicacoes add column if not exists descartada_em timestamptz;
alter table public.djen_publicacoes add column if not exists descartada_por uuid references auth.users(id) on delete set null;
alter table public.djen_publicacoes add column if not exists descartada_motivo text;

-- Descarte é tudo ou nada: data e motivo andam juntos. `descartada_por` pode
-- ficar nulo depois (usuário removido), por isso fica fora da regra.
alter table public.djen_publicacoes drop constraint if exists djen_publicacao_descarte_completo;
alter table public.djen_publicacoes add constraint djen_publicacao_descarte_completo check (
  (descartada_em is null and descartada_motivo is null)
  or (descartada_em is not null and length(btrim(descartada_motivo)) between 3 and 300)
);

notify pgrst, 'reload schema';
