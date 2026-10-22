---
impacto: nada_mudou
secao: corrigido
titulo: Buscar mensagens antigas no WhatsApp ganha teto de pedidos
---

AdvTec (fork), achado da auditoria de 22/10/2026 (OWASP API4). Cada pedido a `POST /api/v1/conversations/[id]/historico` lê até 5.000 mensagens por endereço no servidor do canal, e não havia teto: um laço de cliques martelava o canal. Agora o pedido passa por um teto de 10 por pessoa e 40 por organização a cada minuto, no molde da exportação da conversa; acima disso a resposta é 429 com `Retry-After`, sem tocar no canal. Conversa que a pessoa não vê continua 404 antes de gastar o teto. Sem migration e sem variável de ambiente nova.
