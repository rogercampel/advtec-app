---
impacto: capacidade_nova
secao: adicionado
titulo: Confirmar o prazo de uma publicação, e a pauta separa o que vence hoje e na semana
---

AdvTec (fork), spec 0006.E5 e 0009. Na pauta de Publicações, quem tem papel de atendente ou acima vê "Confirmar prazo" em cada publicação com prazo sugerido: digita a data final que conferiu no próprio controle e, se quiser, uma observação curta. O sistema não conta prazo; só a data digitada aparece como vencimento. As confirmadas saem de "Pendente de confirmação" e entram em "Venceu nos últimos 60 dias", "Vence hoje", "Vence nos próximos 7 dias" ou "Confirmados que vencem depois": nenhuma data confirmada some da tela, nem com o ano digitado errado, e todas têm "Corrigir a data". As não confirmadas continuam pendentes todo dia, como antes. Corrigir regrava a data, quem confirmou e quando, sem guardar a data anterior. Publicação com prazo confirmado não pode ser marcada como "não é nossa". O resumo da manhã traz os mesmos grupos, e o que venceu ou vence hoje vai no assunto do e-mail. Migration 9006 (quatro colunas em `djen_publicacoes`, com check de que data e confirmação andam juntas), aplicada na atualização. Sem variável de ambiente nova. Continue com o controle atual do escritório durante os 30 dias em paralelo da spec 0006.
