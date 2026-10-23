-- manifest: **AdvTec: a passagem para o advogado ganha o motivo `trava_da_oab` e a origem `trava_de_saida`.** Quando o filtro de saída das travas da OAB (`lib/oab/gate-das-travas.ts`, gate `travas_oab` da cadeia before_send) barra a resposta do modelo, o turno não deixa o modelo tentar de novo: entrega a conversa ao advogado. A linha de `passagens_de_atendimento` precisa dizer o que houve — `requested_human` mentiria na primeira frase de quem assume, porque o cliente não pediu uma pessoa. Só ALARGA os dois CHECKs (`origem` e `motivo_codigo`): nenhuma linha existente viola os novos. Par de `ORIGENS_DA_PASSAGEM`/`MOTIVOS_DA_PASSAGEM`/`FRASE_DO_MOTIVO` em `lib/escalacao/passagem.ts`, cobrado por `tests/invariants/vocabulario-banco-x-typescript.test.ts`. No `baseline.sql` os valores entram nos blocos únicos das duas constraints (e nos CHECKs inline do `create table`); o apêndice só registra isso em comentário.

-- 9010 — MOTIVO E ORIGEM NOVOS NA PASSAGEM: `trava_da_oab` / `trava_de_saida`
--
-- Spec 0001 (E2/E3): "Ao disparar qualquer trava: não responde por conta própria,
-- marca a conversa e entrega para o advogado." A entrega usa o mesmo caminho do
-- pedido explícito de atendente (`performHumanHandoff`), mas o motivo é outro: o
-- cliente não pediu uma pessoa; a resposta que o assistente ia dar não podia sair.
-- A origem diz QUE PARTE do sistema decidiu — o filtro de saída, não a detecção
-- determinística de entrada nem a ferramenta do modelo.
--
-- TS e banco mudam no MESMO commit, ou o INSERT falha com 23514 no caminho pouco
-- exercitado que existe justamente para o caso raro.

alter table public.passagens_de_atendimento
  drop constraint if exists passagens_de_atendimento_origem_check;
alter table public.passagens_de_atendimento
  add constraint passagens_de_atendimento_origem_check
  check (origem in (
    'pedido_explicito','opt_out_provavel','ferramenta_do_modelo',
    'teto_de_gasto','caso_escalado','sentimento','legado_pedido',
    'legado_juridico','legado_etapa','legado_confianca','legado_teto',
    'mcp_externo','runtime_nativo','trava_de_saida'));

alter table public.passagens_de_atendimento
  drop constraint if exists passagens_de_atendimento_motivo_codigo_check;
alter table public.passagens_de_atendimento
  add constraint passagens_de_atendimento_motivo_codigo_check
  check (motivo_codigo in (
    'requested_human','suspected_optout','orcamento_de_ia','low_sentiment',
    'low_confidence','critical_stage','legal_mention','refund_mention',
    'caso_escalado','verificacao_manual','trava_da_oab'));

notify pgrst, 'reload schema';
