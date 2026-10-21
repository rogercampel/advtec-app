import { describe, expect, it } from "vitest";

import type { DesfechoDaTese } from "@/lib/acervo/desfecho-das-pecas";
import type { Tese } from "@/lib/acervo/tese";
import { citacoesDe, retiraCitacoesExternas, textoDaTese, travaDaTese } from "@/lib/acervo/trava-da-tese";

/**
 * Ticket 0004.E5 — as três travas. Critério 5 (todo commit): citação de acórdão
 * externo não aparece em forma nenhuma. Critério 6: nenhuma saída chama tese do
 * escritório de jurisprudência. Critério 7: nenhuma probabilidade ou previsão.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - comparar a citação pela string em vez da chave (sigla + dígitos);
 *   - manter a frase e tirar só a citação (o resto da frase fala do julgado);
 *   - tirar a regra de "jurisprudência" da trava 2.
 * A checagem em tempo de execução do enquadramento foi APAGADA: sobreviveu à
 * mutação porque o enquadramento só tem números; quem guarda é o teste abaixo.
 */

const ACERVO = [
  "Conforme o REsp nº 1.737.412/SE, a cobrança após o cancelamento é indevida.",
  "Aplica-se a Súmula 479 do STJ.",
];

describe("trava 1: julgado de fora do acervo não sai", () => {
  it("frase com julgado inventado sai inteira; frase com julgado do acervo fica, em qualquer grafia", () => {
    const candidato =
      "A cobrança é indevida. Nesse sentido, REsp 1.999.999/SP. Ver também resp 1737412. Incide a súmula nº 479. E o AgInt no AREsp 2.000.111/RJ.";
    const r = retiraCitacoesExternas(candidato, ACERVO);
    expect(r.texto).toBe("A cobrança é indevida. Ver também resp 1737412. Incide a súmula nº 479.");
    expect(r.retiradas.map((c) => c.replace(/\D/g, ""))).toEqual(["1999999", "2000111"]);
    expect(r.texto).not.toMatch(/1\.?999\.?999|2\.?000\.?111/);
  });

  it("acervo vazio: toda citação sai", () => {
    expect(retiraCitacoesExternas("Ver Súmula 7. A tese é boa.", []).texto).toBe("A tese é boa.");
  });

  it("reconhece as formas comuns", () => {
    expect(citacoesDe("REsp 1.2/SP, AgRg no AREsp 3, HC 4, Apelação Cível nº 5, Súmula Vinculante 13").length).toBe(5);
  });
});

describe("trava 2: tese do escritório não é jurisprudência", () => {
  it.each([
    "Esta é a jurisprudência do escritório.",
    "Entendimento consolidado nas peças do escritório.",
    "A questão está pacificada.",
    "Os tribunais entendem assim, segundo o acervo.",
  ])("recusa: %s", (frase) => {
    expect(travaDaTese(frase)).toMatchObject({ liberado: false, motivos: expect.arrayContaining(["tese_como_jurisprudencia"]) });
  });

  it("texto do sistema não pode citar julgado, nem do acervo", () => {
    expect(travaDaTese("Veja o REsp 1.737.412/SE.").motivos).toContain("citacao_no_texto_do_sistema");
  });
});

describe("trava 3: desfecho não é previsão", () => {
  it("recusa chance e caso individual", () => {
    expect(travaDaTese("Seu caso tem boa chance.").liberado).toBe(false);
  });
});

describe("o texto da tela passa pelas três", () => {
  const tese: Tese = {
    representante: {
      texto: "Conforme a jurisprudência pacífica, a cobrança após o cancelamento é indevida.",
      similaridade: 0.9,
      origem: { documento: "d", nome: "Inicial.pdf", paginaInicial: 3, paginaFinal: 3 },
      citacao: "Inicial.pdf, p. 3",
      processo: null,
    },
    trechos: [],
    processos: [],
  };
  tese.trechos = [tese.representante];
  const desfecho: DesfechoDaTese = {
    n: 7,
    procedencia: { n: 5, de: 7, percentual: null },
    improcedencia: { n: 1, de: 7, percentual: null },
    procedencia_parcial: { n: 1, de: 7, percentual: null },
    casosInsuficientes: true,
    consultadoEm: { de: "2026-10-19T08:00:00Z", ate: "2026-10-19T08:00:00Z" },
    fora: { pecasSemProcesso: 0, semEspelho: 0, descartados: 0, semDesfecho: 0 },
  };

  it("enquadramento descritivo, com N e data; o trecho literal vai entre aspas, com a origem", () => {
    const t = textoDaTese(tese, desfecho);
    expect(t).toContain("procedência: 5 de 7 processos");
    expect(t).toContain("Consulta ao DataJud de 2026-10-19");
    expect(t).toContain('"Conforme a jurisprudência pacífica');
    expect(t).toContain("Fontes: Inicial.pdf, p. 3.");
    // O enquadramento (tudo menos a linha do trecho literal) passa nas travas.
    const doSistema = t.split("\n").filter((l) => !l.startsWith('"'));
    for (const l of doSistema.filter((l) => !l.startsWith("Fontes:"))) expect(travaDaTese(l).liberado).toBe(true);
  });

  it("sem desfecho no espelho, diz isso — não some", () => {
    expect(textoDaTese(tese, null)).toContain("nenhum processo destas peças com desfecho");
  });
});
