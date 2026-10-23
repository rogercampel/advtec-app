---
impacto: capacidade_nova
secao: adicionado
titulo: Painel de medição com os cinco números do funil do escritório
---

AdvTec (fork), spec 0001 etapa E5. Nova tela em CRM › Painel de medição (`/app/painel`) com o funil que a implantação é medida por 30 dias: atendimentos fora do horário → triados → agendados → compareceram → viraram cliente. Cada número vem com a definição ao lado e a taxa de passagem para a etapa anterior; o período é 7, 30 (padrão) ou 90 dias do calendário do escritório, no fuso da organização. Onde o dado não existe a tela diz "não medido" e o motivo, em vez de inventar: sem horário de funcionamento configurado no agente não há "fora do horário", e sem ninguém registrar o desfecho da consulta não há "compareceram". Triados lê a área do direito que a triagem vai gravar no caso (hoje ninguém grava, e a tela diz isso). As quatro últimas etapas contam os casos abertos no período e não são forçadas a ser subconjuntos umas das outras. Só leitura com a sessão, recortada pela RLS e pela organização ativa; sem migration e sem variável de ambiente nova.
