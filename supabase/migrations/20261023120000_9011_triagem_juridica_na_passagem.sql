-- manifest: **AdvTec: a passagem para o advogado ganha os motivos da triagem jurídica (`urgencia_juridica`, `triagem_conflito`, `triagem_area`, `triagem_recusa`) e a origem `triagem_juridica`.** A triagem no turno (spec 0001.E3) passa a conversa ao advogado sem esperar o modelo: urgência jurídica descrita pelo cliente (prazo, audiência, pessoa presa) é detectada por léxico ANTES do modelo; conflito de interesses, área a decidir e recusa de área saem da ferramenta `registrar_triagem` (a recusa passa a conversa ao advogado para ele conferir, com item de severidade baixa e sem novo aviso ao cliente). Cada caso precisa de uma linha de `passagens_de_atendimento` que diga o que houve — `requested_human` mentiria, o cliente não pediu uma pessoa. Só ALARGA os dois CHECKs (`origem` e `motivo_codigo`), como a 9010: nenhuma linha existente viola os novos. Par de `ORIGENS_DA_PASSAGEM`/`MOTIVOS_DA_PASSAGEM`/`FRASE_DO_MOTIVO` em `lib/escalacao/passagem.ts`, cobrado por `tests/invariants/vocabulario-banco-x-typescript.test.ts`. No `baseline.sql` os valores entram nos blocos únicos das duas constraints; o apêndice só registra isso em comentário.

-- 9011 — MOTIVOS E ORIGEM NOVOS NA PASSAGEM: triagem jurídica
--
-- `triagem_conflito` é registrado para QUEM ASSUME (o advogado); o cliente nunca é avisado
-- do conflito — a outra parte é cliente do escritório (sigilo). O aviso ao cliente é o
-- genérico "um advogado vai responder".
--
-- TS e banco mudam no MESMO commit, ou o INSERT falha com 23514 no caminho pouco exercitado.

alter table public.passagens_de_atendimento
  drop constraint if exists passagens_de_atendimento_origem_check;
alter table public.passagens_de_atendimento
  add constraint passagens_de_atendimento_origem_check
  check (origem in (
    'pedido_explicito','opt_out_provavel','ferramenta_do_modelo',
    'teto_de_gasto','caso_escalado','sentimento','legado_pedido',
    'legado_juridico','legado_etapa','legado_confianca','legado_teto',
    'mcp_externo','runtime_nativo','trava_de_saida','triagem_juridica'));

alter table public.passagens_de_atendimento
  drop constraint if exists passagens_de_atendimento_motivo_codigo_check;
alter table public.passagens_de_atendimento
  add constraint passagens_de_atendimento_motivo_codigo_check
  check (motivo_codigo in (
    'requested_human','suspected_optout','orcamento_de_ia','low_sentiment',
    'low_confidence','critical_stage','legal_mention','refund_mention',
    'caso_escalado','verificacao_manual','trava_da_oab',
    'urgencia_juridica','triagem_conflito','triagem_area','triagem_recusa'));

notify pgrst, 'reload schema';
