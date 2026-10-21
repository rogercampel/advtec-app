import { describe, expect, it } from "vitest";

import { perfilDoRecorte, type LinhaDoRecorte } from "@/lib/datajud/recorte";
import { textoDoPerfil, travaDaJurimetria } from "@/lib/datajud/trava";

/**
 * Ticket 0007.E6 — a trava de linguagem da jurimetria.
 *
 * Critério 5: nenhuma saída contém probabilidade, chance, previsão ou
 * recomendação sobre um caso individual. Critério 6: nenhuma saída nomeia
 * magistrado. Critério 1: percentual sem N é falha. Teste de varredura: todo
 * texto que `textoDoPerfil` produz, em recortes variados, passa pela trava.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - tirar a regra de previsão; tirar a de magistrado;
 *   - tirar a checagem de "%" sem "de N processos";
 *   - mostrar o nome do órgão mesmo quando ele traz nome de pessoa.
 */

describe("a trava recusa", () => {
  it.each([
    ["previsao", "Seu processo tem 70% de chance de êxito (de 100 processos)."],
    ["previsao", "A probabilidade de procedência é alta."],
    ["previsao", "Provavelmente o juízo vai julgar procedente."],
    ["previsao", "A vara tende a ganhar tempo."],
    ["previsao", "Expectativa de êxito: boa."],
    ["recomendacao", "Recomendamos entrar com a ação nesta vara."],
    ["recomendacao", "Vale a pena acordar."],
    ["caso_individual", "No seu caso, 62% terminaram procedentes (62 de 100 processos)."],
    ["magistrado", "O juiz da 3ª Vara julga rápido."],
    ["magistrado", "Gabinete Des. Fulano de Tal"],
    ["magistrado", "Dra. Maria decide em 200 dias."],
    ["percentual_sem_n", "Procedência: 62%"],
  ])("%s: %s", (motivo, frase) => {
    const v = travaDaJurimetria(frase);
    expect(v.liberado).toBe(false);
    expect(v.violacoes.map((x) => x.motivo)).toContain(motivo);
  });
});

describe("controle: a trava libera o que é descrição", () => {
  it.each([
    "Procedência: 62% (62 de 100 processos)",
    "1º Juizado Especial Cível de São Paulo: 300 processos no espelho.",
    "Juízo de Direito da 2ª Vara: mediana de 400 dias (50 processos medidos).",
    "Do ajuizamento à sentença: amostra insuficiente (12 processos medidos; o mínimo é 30).",
    "Isto descreve processos deste recorte já registrados no DataJud. Não diz nada sobre um processo específico.",
  ])("%s", (frase) => {
    expect(travaDaJurimetria(frase)).toEqual({ liberado: true, violacoes: [] });
  });
});

describe("varredura: todo texto montado passa pela trava", () => {
  const linha = (orgao: number, codigo: number | null, nome: string): LinhaDoRecorte => ({
    data_ajuizamento: "2025-01-01T00:00:00.000Z",
    data_ajuizamento_bruto: "20250101000000",
    nivel_sigilo: 0,
    orgao_julgador_codigo: orgao,
    orgao_julgador_nome: nome,
    classe_codigo: 7,
    movimentos: codigo === null ? [] : [{ codigo, nome: "x", dataHora: "2025-09-01T00:00:00.000Z" }],
  });
  const recortes: Array<[string, LinhaDoRecorte[]]> = [
    ["amostra grande", [...Array.from({ length: 50 }, (_, i) => linha(1, 219 + (i % 3), "1ª Vara Cível")), ...Array.from({ length: 40 }, () => linha(2, 220, "2ª Vara"))]],
    ["amostra pequena", Array.from({ length: 5 }, () => linha(1, 219, "Juizado Especial"))],
    ["sem processo nenhum", []],
    ["órgão com nome de pessoa", Array.from({ length: 35 }, () => linha(1, 220, "Gabinete Des. Fulano de Tal"))],
  ];

  it.each(recortes)("%s", (_, linhas) => {
    const texto = textoDoPerfil(
      perfilDoRecorte({
        filtro: { rotulo: "Teste", tribunal: "tjsp", classe_codigo: 7, assunto_codigo: null, orgao_julgador_codigo: 1 },
        coletadoEm: "2026-10-19T08:00:00Z",
        linhas,
        hoje: new Date("2026-10-20T12:00:00Z"),
      }),
    );
    expect(travaDaJurimetria(texto).liberado).toBe(true);
    expect(texto).toContain("Coleta de 19/10/2026."); // critério 8
    expect(texto).not.toMatch(/Fulano/); // critério 6
  });
});
