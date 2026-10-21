---
impacto: nada_mudou
secao: adicionado
titulo: Leitura de PDF página a página, com o número real da página
---

AdvTec (fork), spec 0003.E1. `lePaginasDoPdf` (`lib/acervo/paginas-do-pdf.ts`) lê o PDF uma página por vez e devolve o texto de cada página com o número que ela tem no arquivo. Folha sem texto no meio dos autos não desloca a numeração: ela vai para a lista `paginasSemTexto`. PDF inteiro sem camada de texto (digitalização) é recusado com o motivo, e não vira leitura vazia. Medido no teste com 400 páginas. Sem migration e sem variável de ambiente nova.
