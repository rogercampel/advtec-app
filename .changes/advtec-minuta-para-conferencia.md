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

**O filtro "deixar de fora".**
- O nome do documento e o termo são comparados sem acento, sem caixa e com espaço, `_`, `-` e `.` valendo o mesmo: "contestação silva" acha `Contestacao_Silva.pdf`, e também o nome com acento decomposto que o macOS grava.
- A busca pede o triplo de trechos e corta para o número certo depois de filtrar, para a peça excluída (a mais parecida com o pedido) não ocupar as vagas.
- A resposta traz `deixados_de_fora` (os nomes dos documentos tirados nesta busca), e a tela os lista. Um termo que não tirou nada aparece como aviso ("nenhum documento com 'X' apareceu nesta busca — confira o nome"): termo que não casa deixaria a própria peça passar sem ninguém saber.
- Se o filtro tira TODOS os trechos que vieram, a rota responde 422 ("o filtro deixou de fora todo o acervo encontrado; confira os nomes") em vez de dizer que não há base no acervo.

**Rota.** `POST /api/v1/acervo/minutas`:
- exige `agent` ou acima, tem teto de 10 por pessoa por hora e o modo de acompanhamento só leitura não escreve;
- a organização vem da sessão (o `organization_id` do corpo é ignorado) e a busca é feita com a sessão do usuário;
- nada é gravado, e a minuta volta só para quem pediu;
- o teto mensal de IA da organização é cobrado antes da chamada ao modelo;
- organização sem acervo recebe 404, e isso é checado ANTES do teto por pessoa: não gasta uma das 10 vagas da hora;
- erros com código próprio: 402 quando o orçamento mensal de IA acabou, 502 quando o modelo cai ou responde fora do formato, 422 quando o filtro tira tudo.

**Ponto de IA.** O `purpose` `minuta_do_acervo` entra no registro de pontos de IA (Configurações de IA), como ponto fixo: usa a assinatura de IA do escritório e o modelo medido, como a leitura de processo.

**Prova da 0005.E5.** A rota é o primeiro arquivo de produção que importa a minuta. A prova foi relida e a trava de releitura passou a aceitar exatamente essa rota. Os braços de rede agora olham também o PRÓPRIO arquivo de cada importador (antes só o que ele importa), e a checagem de nomes de saída cobre a minuta, o arquivo que a escreve em texto e cada importador. O próximo importador acende a trava de novo.

**Reaproveitamento.** O buscador da sessão saiu da rota de pesquisa para `lib/acervo/buscador-da-sessao.ts`, e as duas rotas usam o mesmo.

Sem migration e sem variável de ambiente nova. Cada minuta é uma chamada de modelo e de embedding na chave do escritório.
