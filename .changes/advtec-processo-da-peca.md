---
impacto: nada_mudou
secao: adicionado
titulo: Peça do acervo amarrada ao número do processo, com dígito verificador
---

AdvTec (fork), spec 0004.E3. Na ingestão do acervo, `processoDaPeca` (`lib/acervo/processo-da-peca.ts`) extrai o número CNJ do processo da peça e o grava em `ai_chunks.metadata.processo`. Só aceita número com dígito verificador certo (Res. CNJ 65/2008, conferido em 50 números reais do DJEN). Vale o número que está no cabeçalho da primeira página, ou, fora dele, o único número válido do documento. Precedente citado no corpo não vira o processo da peça, e dois candidatos sem cabeçalho dão `null`. Sem migration e sem variável de ambiente nova.
