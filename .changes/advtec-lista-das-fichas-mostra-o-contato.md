---
impacto: nada_mudou
secao: corrigido
titulo: Lista das fichas mostra o telefone do cliente sem nome, em vez de "Caso sem contato"
---

AdvTec (fork), visto no teste de fumaça de 22/10/2026. Na lista `/app/fichas`, caso cujo contato só tinha telefone aparecia como "Caso sem contato". A lista agora usa o rótulo da casa (`rotuloDoContato`: nome, ou o telefone), como a ficha já fazia, e "Caso sem contato" só aparece quando o caso não tem contato. A lista ganhou o teste que não tinha (`tests/unit/fichas-lista-tela.test.tsx`). Sem migration e sem variável de ambiente nova.
