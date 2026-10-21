import { describe, expect, it } from "vitest";

import type { Alegacao } from "@/lib/acervo/alegacoes";
import { itensDosAutos, leContradicoes, MAXIMO_DE_LACUNAS } from "@/lib/acervo/contradicoes";
import type { ChamadaDoModelo } from "@/lib/acervo/leitura-por-modelo";
import type { Evento } from "@/lib/acervo/linha-do-tempo";

/**
 * Ticket 0003.E5 (#39) — contradições, lacunas e páginas que importam.
 *
 * O que não pode acontecer:
 *   - citação nova inventada: o modelo só fala por NÚMERO de item já ancorado;
 *     número que não existe sai e é contado;
 *   - valor ou data inventados na explicação ou na lacuna: todo número tem de
 *     estar nos itens que ela cita;
 *   - contradição de um item com ele mesmo;
 *   - página com decisão do juízo fora da lista do que ler;
 *   - modelo calado, ou resposta sem as três chaves, virando "nada encontrado":
 *     vira "não procurado", com o motivo.
 *
 * Mutações: ver o fim do arquivo.
 */

const alegacoes: Alegacao[] = [
  { tipo: "causa_de_pedir", lado: "autor", texto: "O autor cancelou o plano em 10 de março de 2024.", pagina: 3, trecho: "o autor solicitou o cancelamento em 10 de março de 2024" },
  { tipo: "defesa", lado: "reu", texto: "A ré diz que o pedido de cancelamento chegou em 1º de abril de 2024.", pagina: 41, trecho: "o pedido de cancelamento só foi recebido em 1º de abril de 2024" },
  { tipo: "pedido", lado: "autor", texto: "O autor pede indenização por dano moral.", pagina: 9, trecho: "a condenação da ré ao pagamento de indenização por danos morais" },
  { tipo: "decisao", lado: "juizo", texto: "O juiz negou a liminar.", pagina: 60, trecho: "indefiro, por ora, o pedido de tutela de urgência" },
  { tipo: "defesa", lado: "reu", texto: "A ré diz que o autor nunca pediu o cancelamento.", pagina: 41, trecho: "não há qualquer registro de pedido de cancelamento feito pelo autor" },
];
const eventos: Evento[] = [{ data: "2024-03-10", pagina: 3, trecho: "Em 10 de março de 2024 pediu o cancelamento." }];
const itens = itensDosAutos(alegacoes, eventos);
const vazio = { contradicoes: [], lacunas: [], paginas: [] };
const modelo = (r: unknown | Error): ChamadaDoModelo => async () => {
  if (r instanceof Error) throw r;
  return { texto: typeof r === "string" ? r : JSON.stringify({ ...vazio, ...(r as object) }) };
};
const zeradas = { numero_inexistente: 0, mesmo_item: 0, numero_sem_apoio: 0, acima_do_teto: 0, repetido: 0 };

describe("numeração do que já está ancorado", () => {
  it("alegações viram A1…, eventos viram E1…, com página e trecho de origem", () => {
    expect(itens.map((i) => [i.id, i.tipo, i.pagina])).toEqual([
      ["A1", "causa_de_pedir", 3],
      ["A2", "defesa", 41],
      ["A3", "pedido", 9],
      ["A4", "decisao", 60],
      ["A5", "defesa", 41],
      ["E1", "evento", 3],
    ]);
  });
});

describe("o modelo só fala por número; o resto é dos autos", () => {
  it("contradição entre páginas distantes aparece com os dois lados inteiros", async () => {
    const r = await leContradicoes(itens, modelo({ contradicoes: [{ a: "A1", b: "A2", explicacao: "10 de março de 2024 contra 1º de abril de 2024 para o mesmo pedido." }] }));
    expect(r.contradicoes).toHaveLength(1);
    expect(r.contradicoes[0]!.a).toMatchObject({ pagina: 3, trecho: alegacoes[0]!.trecho });
    expect(r.contradicoes[0]!.b).toMatchObject({ pagina: 41, trecho: alegacoes[1]!.trecho });
    expect(r.removidas).toEqual(zeradas);
  });

  it("valor ou data que nenhum dos dois itens traz: a contradição sai", async () => {
    const r = await leContradicoes(itens, modelo({ contradicoes: [{ a: "A1", b: "A2", explicacao: "O contrato era de R$ 100 e a ré diz R$ 900." }] }));
    expect(r.contradicoes).toEqual([]);
    expect(r.removidas.numero_sem_apoio).toBe(1);
  });

  it("número que não existe sai; item contra ele mesmo sai; repetido (B×A) entra uma vez e é contado", async () => {
    const r = await leContradicoes(
      itens,
      modelo({
        contradicoes: [
          { a: "A1", b: "A9", explicacao: "inventada" },
          { a: "A2", b: "A2", explicacao: "consigo mesmo" },
          { a: "A1", b: "A2", explicacao: "datas diferentes" },
          { a: "A2", b: "A1", explicacao: "a mesma, invertida" },
        ],
        lacunas: [{ item: "Z1", falta: "inventada" }],
        paginas: [{ item: "X3", motivo: "inventada" }],
      }),
    );
    expect(r.contradicoes).toHaveLength(1);
    expect(r.lacunas).toEqual([]);
    expect(r.removidas).toEqual({ ...zeradas, numero_inexistente: 3, mesmo_item: 1, repetido: 1 });
  });

  it("lacuna aponta a alegação de origem e diz o que falta; número inventado na lacuna sai", async () => {
    const r = await leContradicoes(
      itens,
      modelo({
        lacunas: [
          { item: "A3", falta: "Não há, entre os trechos lidos, prova do abalo moral alegado." },
          { item: "A3", falta: "Falta provar os R$ 30.000,00 de dano moral." },
        ],
      }),
    );
    expect(r.lacunas).toEqual([{ item: itens[2], falta: "Não há, entre os trechos lidos, prova do abalo moral alegado." }]);
    expect(r.removidas.numero_sem_apoio).toBe(1);
  });

  it("o teto de lacunas vale sobre as válidas: número inventado no topo não come vaga, e o excedente é contado", async () => {
    const nomes = ["primeira", "segunda", "terceira", "quarta", "quinta", "sexta", "sétima"];
    const lacunas = [{ item: "Z9", falta: "inventada" }, ...["A1", "A2", "A3", "A4", "A5", "E1", "A1"].map((item, i) => ({ item, falta: `lacuna ${nomes[i]}` }))];
    const r = await leContradicoes(itens, modelo({ lacunas }));
    expect(r.lacunas.map((l) => l.falta)).toEqual(["lacuna primeira", "lacuna segunda", "lacuna terceira", "lacuna quarta", "lacuna quinta"]);
    expect(r.lacunas).toHaveLength(MAXIMO_DE_LACUNAS);
    expect(r.removidas).toMatchObject({ numero_inexistente: 1, acima_do_teto: 2 });
  });
});

describe("o que não foi procurado não vira 'nada encontrado'", () => {
  it("modelo fora do ar: 'não procurado' com o motivo — e a página da decisão entra mesmo assim", async () => {
    const r = await leContradicoes(itens, modelo(new Error("403")));
    expect(r.naoLido).toEqual({ motivo: "Error: 403" });
    expect(r.paginasQueImportam).toEqual([{ pagina: 60, motivos: ["decisão do juízo — o que já vale no processo"] }]);
  });

  it.each([
    ["prosa", "Não encontrei contradições."],
    ["objeto vazio", "{}"],
    ["chave com acento", JSON.stringify({ "contradições": [], lacunas: [], paginas: [] })],
  ])("%s é 'não procurado', nunca 'nenhuma contradição'", async (_, texto) => {
    const r = await leContradicoes(itens, async () => ({ texto }));
    expect(r.naoLido).toEqual({ motivo: "resposta do modelo fora do formato" });
  });

  it("as três chaves vazias é 'procurado e nada achado'", async () => {
    expect((await leContradicoes(itens, modelo({}))).naoLido).toBeNull();
  });
});

describe("páginas que importam", () => {
  it("as páginas dos dois lados de uma contradição entram, em ordem, com os motivos juntos", async () => {
    const r = await leContradicoes(
      itens,
      modelo({
        contradicoes: [{ a: "A2", b: "A1", explicacao: "datas diferentes" }],
        paginas: [{ item: "A1", motivo: "a data do cancelamento decide o dano" }],
      }),
    );
    expect(r.paginasQueImportam.map((p) => p.pagina)).toEqual([3, 41, 60]);
    expect(r.paginasQueImportam[0]!.motivos).toEqual(["um lado de uma contradição", "a data do cancelamento decide o dano"]);
  });

  it("os dois lados na mesma página dão um motivo só (a ré se contradiz na pág. 41)", async () => {
    const r = await leContradicoes(itens, modelo({ contradicoes: [{ a: "A2", b: "A5", explicacao: "a ré diz que o pedido chegou e que nunca houve pedido" }] }));
    expect(r.paginasQueImportam.find((p) => p.pagina === 41)!.motivos).toEqual(["um lado de uma contradição"]);
  });

  it("com um item só não há o que comparar: nenhuma chamada ao modelo", async () => {
    let chamou = false;
    const r = await leContradicoes(itensDosAutos([alegacoes[3]!], []), async () => {
      chamou = true;
      return { texto: "{}" };
    });
    expect(chamou).toBe(false);
    expect(r.naoLido).toBeNull();
    expect(r.paginasQueImportam.map((p) => p.pagina)).toEqual([60]);
  });
});

/*
 * Mutações (21/10/2026), todas acusadas: sem a página de decisão sempre na
 * lista; número de item inexistente aceito; item contra ele mesmo; repetido sem
 * tirar nem contar; valor na explicação ou na lacuna sem apoio nos itens; teto
 * de lacunas ausente ou aplicado antes do filtro; `{}` aceito como "nada
 * achado"; motivo da falha perdido; chamada com um item só; motivo repetido na
 * mesma página; páginas sem ordem.
 */
