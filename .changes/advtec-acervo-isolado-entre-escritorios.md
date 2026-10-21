---
impacto: nada_mudou
secao: adicionado
titulo: Prova de que o acervo de um escritório não aparece para outro
---

AdvTec (fork), spec 0002.E5. É só teste, sem mudança de comportamento: `tests/invariants/acervo-isolamento-entre-escritorios.test.ts` sobe dois escritórios reais e tenta vazar o acervo de B para A por cinco portas: a fonte de B pedida por A, o usuário de A dizendo ser B, a leitura direta de `ai_chunks` sob RLS, a busca legada com a versão de B, e o caminho da aplicação (`searchKnowledge` mais `comOrigem`). As cinco devolvem zero, e cada uma tem o par positivo. Sem migration e sem variável de ambiente nova.
