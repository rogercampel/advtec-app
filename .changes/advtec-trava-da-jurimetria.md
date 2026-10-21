---
impacto: nada_mudou
secao: adicionado
titulo: Trava de linguagem da jurimetria: descreve, nunca prevê
---

AdvTec (fork), spec 0007.E6. `travaDaJurimetria` (`lib/datajud/trava.ts`) recusa todo texto de jurimetria que fale em chance, probabilidade ou previsão, que recomende, que se dirija ao caso individual ("seu caso"), que nomeie magistrado ou que traga percentual sem "de N processos" na mesma linha. `textoDoPerfil` monta o texto da tela por código, passa pela trava e falha alto se ela recusar. Quando o nome do órgão traz nome de pessoa, como "Gabinete Des. Fulano", vai o código do órgão no lugar. Sem migration e sem variável de ambiente nova.
