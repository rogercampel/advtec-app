---
impacto: nada_mudou
secao: adicionado
titulo: Consulta das últimas publicações dos casos de um contato
---

AdvTec (fork), spec 0010.E2. `consultaDoCaso` (`lib/djen/consulta-do-caso.ts`) devolve as últimas publicações (no máximo 5) dos casos ligados a um contato: data, tipo de ato, trecho e tribunal. Nunca devolve o teor inteiro, nem publicação de outro contato, de outro escritório ou descartada como "não é nossa". É a ferramenta que o agente do WhatsApp vai usar. Ligá-la ao agente fica para uma decisão à parte, porque mexe em arquivo do original. Sem migration e sem variável de ambiente nova.
