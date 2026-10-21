import { describe, expect, it } from "vitest";

import { lePrazos, lePublicacao, leTipoDeAto, legivel } from "@/lib/djen/ler";

/**
 * Ticket 0006.E3 — leitura da publicação. Critério 4 da spec: "Toda extração
 * de prazo mostra o trecho do texto que a fundamentou. Extração sem trecho é
 * falha."
 *
 * O corpus vem da MEDIÇÃO de 24/08/2026 — 100 publicações reais do DJEN, com
 * nomes trocados. Os cinco formatos de prazo e o texto com HTML são de lá,
 * não de imaginação.
 *
 * MUTAÇÕES (24/08/2026), feitas e conferidas uma a uma:
 *  - decodificação de entidade removida → vermelho no bloco de HTML real.
 *  - ramo do extenso removido → vermelho em "quinze dias" só por extenso.
 *  - contagem fixa em nao_declarada → vermelho em dias úteis/corridos.
 *  - achado sem número suprimido → vermelho na remissão ao art. 903.
 *  - prioridade de tipo invertida → vermelho no cabeçalho composto.
 *  - sombra sem tirar acento → vermelho em "três dias".
 */

/** Medido: o texto vem com entidade HTML e &nbsp; — 44 de 100 itens. */
const TEXTO_COM_HTML =
  "FULANO DE TAL (OAB SP000000) DESPACHO/DECIS&Atilde;O Vistos. Concedo o prazo " +
  "suplementar de 15 dias, interregno que reputo suficiente para as pretens&otilde;es " +
  "do autor. Intimem-se. &nbsp; &nbsp;";

describe("o texto legível", () => {
  it("decodifica as entidades que a fonte manda de verdade", () => {
    expect(legivel("DECIS&Atilde;O")).toBe("DECISÃO");
    expect(legivel("cart&oacute;rio")).toBe("cartório");
    expect(legivel("&sect;2&ordm; do art. 903")).toBe("§2º do art. 903");
  });

  it("tira tag e colapsa o espaço que sobra", () => {
    expect(legivel("Vistos.<br/><br/>Intime-se. &nbsp; ")).toBe("Vistos. Intime-se.");
  });

  it("entidade desconhecida fica como veio — inventar é pior que mostrar", () => {
    expect(legivel("x &naoexiste; y")).toBe("x &naoexiste; y");
  });
});

describe("os cinco formatos de prazo medidos na fonte", () => {
  it.each([
    ["dígito e extenso: no prazo de 15 (quinze) dias, sob pena de arquivamento", 15],
    ["extenso e dígito: produzir, no prazo de quinze (15) dias, justificando-as", 15],
    ["rótulo seco: Cumpra-se. Prazo: 15 dias. Int.", 15],
    ["zero à esquerda: para extratos desde o óbito. Prazo 05 dias.", 5],
    ["só extenso: para pagamento no prazo de quinze dias, sob pena de prosseguimento", 15],
  ])("%s", (texto, esperado) => {
    const prazos = lePrazos(texto);
    expect(prazos).toHaveLength(1);
    expect(prazos[0]!.dias).toBe(esperado);
  });

  it("extenso com acento: prazo de três dias → 3", () => {
    expect(lePrazos("manifeste-se no prazo de três dias")[0]!.dias).toBe(3);
  });
});

describe("o prazo que o texto tem e o número que ele não dá", () => {
  it("remissão à lei vira achado com dias null — não silêncio", () => {
    // Medido: "certifique o cartório se decorreu o prazo previsto no §2º do
    // art. 903". Dizer "sem prazo" sobre esse texto seria mentira.
    const prazos = lePrazos(
      "certifique o cart&oacute;rio se decorreu o prazo previsto no &sect;2&ordm; " +
        "do art. 903 do C&oacute;digo de Processo Civil",
    );
    expect(prazos).toHaveLength(1);
    expect(prazos[0]!.dias).toBeNull();
    expect(prazos[0]!.trecho).toContain("prazo previsto no §2º do art. 903");
  });

  it("horas não viram dias — 48 horas sai como prazo sem número de dias", () => {
    const prazos = lePrazos("manifeste-se no prazo de 48 horas");
    expect(prazos).toHaveLength(1);
    expect(prazos[0]!.dias).toBeNull();
  });

  it("texto sem prazo devolve lista vazia", () => {
    expect(lePrazos("Vistos. Arquivem-se os autos. Int.")).toHaveLength(0);
  });
});

describe("dia útil ou corrido — só o que o texto declara", () => {
  it("declara úteis → util", () => {
    expect(lePrazos("no prazo de 15 (quinze) dias úteis")[0]!.contagem).toBe("util");
  });

  it("declara corridos → corrido", () => {
    expect(lePrazos("no prazo de 10 dias corridos")[0]!.contagem).toBe("corrido");
  });

  it("não declara → nao_declarada, e a regra do CPC fica para a contagem da E4", () => {
    expect(lePrazos("no prazo de 15 (quinze) dias, sob pena")[0]!.contagem).toBe("nao_declarada");
  });
});

describe("critério 4: extração sem trecho é falha", () => {
  const CORPUS = [
    TEXTO_COM_HTML,
    "no prazo de 15 (quinze) dias, sob pena de arquivamento",
    "Prazo 05 dias. - ADV: BELTRANO (OAB 000000/SP)",
    "decorreu o prazo previsto no &sect;2&ordm; do art. 903",
    "Aguarde-se o decurso do prazo da intima&ccedil;&atilde;o do evento 100.",
  ];

  it("todo achado carrega trecho não vazio, e o trecho é substring literal do texto legível", () => {
    let achados = 0;
    for (const texto of CORPUS) {
      const leitura = lePublicacao(texto);
      const doTexto = legivel(texto);
      for (const p of leitura.prazos) {
        achados++;
        expect(p.trecho.length).toBeGreaterThan(0);
        expect(doTexto).toContain(p.trecho);
      }
      if (leitura.tipoDeAto) {
        achados++;
        expect(leitura.tipoDeAto.trecho.length).toBeGreaterThan(0);
        expect(doTexto).toContain(leitura.tipoDeAto.trecho);
      }
    }
    // Controle da varredura: o laço leu MESMO alguma coisa. Sem isto, corpus
    // que não gera achado nenhum deixaria o teste verde medindo o vazio.
    expect(achados).toBeGreaterThan(5);
  });

  it("no HTML real da fonte, o trecho sai legível — não sai &nbsp;", () => {
    const prazos = lePrazos(TEXTO_COM_HTML);
    expect(prazos).toHaveLength(1);
    expect(prazos[0]!.dias).toBe(15);
    expect(prazos[0]!.trecho).toContain("prazo suplementar de 15 dias");
    expect(prazos[0]!.trecho).not.toContain("&");
  });
});

describe("tipo de ato", () => {
  it("cabeçalho composto DESPACHO/DECISÃO vale pelo de maior peso: decisão", () => {
    const tipo = leTipoDeAto(TEXTO_COM_HTML);
    expect(tipo?.tipo).toBe("decisão");
  });

  it("sentença ganha de despacho quando os dois aparecem", () => {
    const tipo = leTipoDeAto("Publicada a senten&ccedil;a. Despacho de mero expediente.");
    expect(tipo?.tipo).toBe("sentença");
  });

  it("texto sem tipo conhecido devolve null — não se inventa tipo", () => {
    expect(leTipoDeAto("Vistos. Arquivem-se os autos.")).toBeNull();
  });
});
