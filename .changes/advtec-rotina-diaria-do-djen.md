---
impacto: capacidade_nova
secao: adicionado
titulo: A busca de intimações no DJEN roda sozinha todo dia, e a Central avisa quando ela para
---

AdvTec (fork). O scheduler passa a chamar `api/v1/cron/djen-coleta` de hora em hora. Para cada escritório com OAB cadastrada em `djen_oabs_monitoradas` e ativa, a rotina faz uma coleta bem-sucedida por dia (fuso de Brasília) nas publicações do DJEN, grava sem duplicar em `djen_publicacoes` e registra cada rodada em `djen_coletas`. Se a coleta falhar ou parar de rodar, a Central da equipe recebe um aviso dizendo há quanto tempo o escritório está sem coleta boa; o aviso não se repete por 12 horas e se fecha sozinho quando a coleta volta. Escritório suspenso ou arquivado fica fora da rodada. Nada é enviado a cliente. Sem OAB cadastrada, nada muda. Nenhuma mudança de banco nem variável de ambiente nova.
