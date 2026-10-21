---
impacto: capacidade_nova
secao: adicionado
titulo: Resumo da manhã com a pauta de hoje, por e-mail, para a equipe do escritório
---

AdvTec (fork), spec 0009.E5. Todo dia às 7h de Brasília (`0 10 * * *` UTC, rota `api/v1/cron/djen-resumo`), cada escritório com OAB monitorada e em operação recebe a pauta de hoje por e-mail. São três blocos: o que chegou desde ontem, os prazos sugeridos pendentes de confirmação (com o trecho do texto) e quantas publicações estão sem caso. Vai um e-mail por pessoa, para os usuários ativos do escritório com papel `agent`, `manager` ou `admin`. Ficam de fora `viewer`, quem é só dono da instalação e qualquer contato de cliente. No dia vazio, o assunto diz "nada novo". Usa o e-mail já configurado (SMTP ou Resend); sem migration e sem variável de ambiente nova. Ainda não há envio por WhatsApp nem horário configurável.
