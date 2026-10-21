---
impacto: nada_mudou
secao: adicionado
titulo: Linha do tempo do processo, na ordem dos fatos e com página
---

AdvTec (fork), spec 0003.E3. `linhaDoTempo` (`lib/acervo/linha-do-tempo.ts`) acha as datas dos autos (12/03/2024, 12.03.2024 e "12 de março de 2024") e devolve cada evento com a data, a página e a frase literal que contém a data, em ordem cronológica e não na ordem dos autos. Data inexistente (31/02) e ano absurdo não entram. A mesma frase copiada em outra folha entra uma vez. Os carimbos processuais ("assinado eletronicamente em", "juntado em") saem contados, sem virar fato. Não resume nem interpreta. Sem migration e sem variável de ambiente nova.
