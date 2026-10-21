---
impacto: nada_mudou
secao: adicionado
titulo: Caso em segredo de justiça fecha a consulta pelo WhatsApp
---

AdvTec (fork), spec 0010.E4. A consulta do caso (`consultaDoCaso`) devolve `sigiloso: true` e nenhum andamento quando acontece qualquer uma destas três coisas: algum caso do contato tem `custom_fields.segredo_de_justica` marcado; a marca tem um valor que não é um "não" explícito; ou uma das publicações lidas fala em segredo de justiça ou em autos sigilosos. Nesse caso, o agente passa a conversa para humano sem descrever nada. Sem migration e sem variável de ambiente nova.
