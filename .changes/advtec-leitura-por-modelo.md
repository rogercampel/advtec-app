---
impacto: capacidade_nova
secao: adicionado
titulo: Leitura de processo — envie o PDF e receba o documento com a página de cada afirmação
---

AdvTec (fork), spec 0003 (#35, #39, #41). Nova tela Leitura de processo, no hub ao lado da Pesquisa no acervo: quem tem papel de atendente ou acima envia o PDF do processo (até 10 MB), vê antes as páginas, os minutos e o custo estimado, e confirma. A leitura roda em segundo plano e a lista se atualiza sozinha. O documento traz quem é quem, a linha do tempo, o que cada lado alega (pedido, causa de pedir, defesa, decisão), contradições, lacunas e as páginas para ler inteiras — toda afirmação com a página dos autos e o trecho literal, e o que não foi lido aparece no topo, com o motivo. PDF digitalizado sem texto é recusado com o motivo. Há uma versão para imprimir. O modelo é o gpt-6-luna, pela assinatura do ChatGPT da organização ou, se ela recusar, pela chave de API da OpenAI cadastrada em Credenciais (medido: menos de um centavo de dólar por peça de 34 páginas). Migration 9007 (`acervo_leituras`), aplicada na atualização. Sem variável de ambiente nova. O PDF não é guardado, só o documento.
