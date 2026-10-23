---
impacto: nada_mudou
secao: adicionado
titulo: A lista do que faltou na minuta passa a incluir o que o modelo esqueceu de listar (0005.E4)
---

AdvTec (fork), spec 0005.E4 (#42), critério 5: "toda minuta traz a lista do que não foi fundamentado; lista vazia só é válida se tudo tiver origem".

**Antes.** A lista era só o que o modelo escrevia em `faltou`. Bloco sem fonte e lugar a preencher deixado no texto e esquecido na lista saíam com a lista vazia.

**Agora o código completa a lista:**
- todo colchete no texto próprio do modelo vira item (`[A COMPLETAR: x]`, `[A COMPLETAR]`, `[PREENCHER: x]`, `[NOME DO RÉU]`, colchete sem par);
- o colchete vazio entra pela própria grafia, nunca como item em branco;
- bloco sem fonte acrescenta o aviso `FALTOU_TEXTO_NOVO`;
- repetido é só o mesmo item (sem caixa, acento e ponto final), não o item que contém o outro.

**O que NÃO muda.** "Origem" continua sendo a fonte que o modelo declara para o bloco. O código confere que o trecho existe, não que o argumento está nele (limite do critério 2, já declarado em `lib/acervo/minuta.ts`).

**Testes.** Ficam em `tests/unit/acervo-minuta.test.ts` e incluem uma varredura com oráculo próprio sobre as respostas gravadas do modelo. As mutações novas estão em `scripts/mutar-minuta.mjs`.

Sem migration, sem variável de ambiente nova e sem chamada de modelo nova.
