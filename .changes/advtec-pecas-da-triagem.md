---
impacto: capacidade_nova
secao: adicionado
titulo: Triagem jurídica — urgência, área do direito, conflito de interesses e registro no caso
---

AdvTec (fork), spec 0001.E3, peças em `lib/triagem/` ainda não ligadas ao turno do agente. Detector de urgência jurídica (prazo correndo, audiência marcada, pessoa presa, liminar, despejo, pensão atrasada) lido do que o cliente escreveu, com o trecho literal. Classificador de área em linguagem de cliente leigo e decisão por escritório: atende, recusa com texto educado (sem coletar a história) ou deixa para o advogado — área desconhecida nunca é recusada. A configuração mora em `organizations.settings.triagem` (`areas_atendidas`, `areas_recusadas`); sem ela, nada é recusado sozinho. Checagem de conflito: a parte contrária citada é comparada, por nome inteiro e dentro do mesmo escritório, com contatos que têm algum caso. A ferramenta `registrar_triagem` grava área, resumo, parte contrária e urgência em `crm_leads.custom_fields` do caso aberto (mesclando, pela mesma função da API) e devolve o que o turno faz: seguir, recusar ou passar ao advogado. Sem migration e sem variável de ambiente nova.
