---
impacto: capacidade_nova
secao: adicionado
titulo: Tela de Publicações com a caixa das intimações que não casam com caso nenhum
---

AdvTec (fork). Nova tela em CRM › Publicações (`/app/publicacoes`). Ela lista as intimações do DJEN que não casam com nenhum caso do escritório — o caso é o negócio do funil com o número do processo no campo `numero_processo` (ADR 0003). Cada publicação tem três saídas: ligar a um negócio existente (anota o número nele), criar um caso novo num funil, ou marcar como "não é nossa", com motivo obrigatório. Nada sai da caixa sozinho, exceto quando um negócio passa a ter aquele número. Quem vê: qualquer papel; quem age: `agent` em diante. Uma migration (9005) acrescenta três colunas a `djen_publicacoes`; nenhuma variável de ambiente nova.
