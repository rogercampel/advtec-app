import { describe, expect, it } from "vitest";

import { linhaDoTempo } from "@/lib/acervo/linha-do-tempo";

/**
 * Ticket 0003.E3 — linha do tempo.
 *
 * Critério 6: datas na ordem cronológica correta, não na ordem de aparição.
 * Critério 2: todo evento tem página. E o evento é a frase LITERAL dos autos.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - não ordenar (fica a ordem dos autos);
 *   - aceitar 31/02 (data inexistente);
 *   - não filtrar carimbo processual;
 *   - tirar o formato por extenso;
 *   - casar no texto original em vez da sombra ("março" com acento não casa).
 */

const HOJE = new Date("2026-10-20T12:00:00Z");
const pag = (numero: number, texto: string) => ({ numero, texto });

const AUTOS = [
  pag(1, "PETIÇÃO INICIAL. O autor contratou o plano em 05/01/2023. Em 10 de março de 2024 pediu o cancelamento."),
  pag(2, "Documento assinado eletronicamente em 02/09/2024 por Fulano.\nA ré continuou cobrando em 15/04/2024; as faturas seguem anexas."),
  pag(7, "CONTESTAÇÃO. A ré alega que o pedido de cancelamento só chegou em 1º de abril de 2024."),
];

describe("critério 6: ordem do fato, não dos autos", () => {
  const r = linhaDoTempo(AUTOS, { hoje: HOJE });

  it("as datas saem em ordem cronológica, cada uma com a página", () => {
    expect(r.eventos.map((e) => [e.data, e.pagina])).toEqual([
      ["2023-01-05", 1],
      ["2024-03-10", 1],
      ["2024-04-01", 7],
      ["2024-04-15", 2],
    ]);
  });

  it("o evento é a frase literal que contém a data", () => {
    expect(r.eventos[1]!.trecho).toBe("Em 10 de março de 2024 pediu o cancelamento.");
    expect(r.eventos[3]!.trecho).toBe("A ré continuou cobrando em 15/04/2024;");
  });

  it("carimbo processual sai contado, não vira fato", () => {
    expect(r.carimbos).toBe(1);
    expect(r.eventos.some((e) => e.trecho.includes("assinado eletronicamente"))).toBe(false);
  });
});

describe("datas que não são datas", () => {
  it("31/02 e ano absurdo não entram", () => {
    const r = linhaDoTempo([pag(1, "Vencimento em 31/02/2024. Contrato de 12/05/1888. Prazo até 10/10/2099.")], { hoje: HOJE });
    expect(r.eventos).toEqual([]);
  });

  it("número de lei ou valor não vira data", () => {
    const r = linhaDoTempo([pag(1, "Lei 8.078/1990, art. 42. Valor de R$ 1.234,56.")], { hoje: HOJE });
    expect(r.eventos).toEqual([]);
  });
});

describe("autos com peça copiada", () => {
  it("a mesma frase repetida em outra folha entra uma vez, na primeira página", () => {
    const frase = "O autor contratou o plano em 05/01/2023.";
    const r = linhaDoTempo([pag(3, frase), pag(40, frase)], { hoje: HOJE });
    expect(r.eventos).toEqual([{ data: "2023-01-05", pagina: 3, trecho: frase }]);
  });

  it("mesma data em páginas diferentes, frases diferentes: as duas, na ordem das páginas", () => {
    const r = linhaDoTempo([pag(9, "Audiência em 03/06/2024."), pag(4, "Intimação para a audiência de 03/06/2024.")], { hoje: HOJE });
    expect(r.eventos.map((e) => e.pagina)).toEqual([4, 9]);
  });
});
