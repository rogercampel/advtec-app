---
impacto: capacidade_nova
secao: adicionado
titulo: Tela Pesquisa no acervo
---

AdvTec (fork), issue #90. Nova tela em CRM › Pesquisa no acervo (`/app/acervo`), no hub e não no menu lateral. O advogado descreve o problema e vê as teses do escritório, uma por vez, como uma página de peça. O trecho literal fica no centro, e as fontes numeradas (peça, página e processo) ficam na margem. O desfecho dos processos dessas peças vem pelo DataJud: em frase, com N e data da consulta. Abaixo de 30 processos não há barra de proporção, e o que ficou fora da conta aparece motivo por motivo. Quando não há nada, a tela diz "Não há nada no acervo do escritório sobre isso.". Pesquisar é para `agent` em diante. A rota `POST /api/v1/acervo/pesquisa` lê com a sessão do usuário e tem o mesmo teto de chamadas da busca do acervo da base. Precisa de chave de embedding em Credenciais. Sem migration e sem variável de ambiente nova.
