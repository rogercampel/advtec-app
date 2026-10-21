---
impacto: nada_mudou
secao: adicionado
titulo: Leitura dos casos de um contato, para a consulta pelo WhatsApp
---

AdvTec (fork), spec 0010.E1. `casosDoContato` (`lib/djen/consulta-do-caso.ts`) devolve os negócios do funil de um contato que têm número de processo (ADR 0003), filtrando por organização e contato na própria consulta, porque o agente roda sem RLS. Ainda não há tela nem ferramenta usando a função: ela é a base da 0010.E2. Sem migration e sem variável de ambiente nova.
