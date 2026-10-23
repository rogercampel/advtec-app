---
impacto: capacidade_nova
secao: adicionado
titulo: Minuta para conferência no acervo — o advogado pede a peça, lê a origem de cada bloco e baixa o rascunho (0005.E2)
---

AdvTec (fork), spec 0005.E2 (#37 do repositório de specs).

**Tela.** A página do acervo (`/app/acervo`) ganha "Minuta para conferência". O advogado:
- descreve a peça;
- diz quais documentos deixar de fora, pelo nome (a peça que ele mesmo escreveu, que vira o gabarito da conferência);
- lê a minuta com a origem de cada bloco: documento e página, ou "texto novo";
- lê a lista do que faltou;
- baixa o rascunho em `.md`.

**Rota.** `POST /api/v1/acervo/minutas`:
- exige `agent` ou acima, tem teto de 10 por pessoa por hora e o modo de acompanhamento só leitura não escreve;
- a busca é feita com a sessão do usuário;
- nada é gravado, e a minuta volta só para quem pediu;
- o teto mensal de IA da organização é cobrado antes da chamada ao modelo.

**Prova da 0005.E5.** A rota é o primeiro arquivo de produção que importa a minuta. A prova foi relida e a trava de releitura passou a aceitar exatamente essa rota. O próximo importador acende a trava de novo.

**Reaproveitamento.** O buscador da sessão saiu da rota de pesquisa para `lib/acervo/buscador-da-sessao.ts`, e as duas rotas usam o mesmo.

Sem migration e sem variável de ambiente nova. Cada minuta é uma chamada de modelo e de embedding na chave do escritório.
