/**
 * Spec 0001.E3, critério 9 — urgência jurídica, com frases de cliente leigo.
 *
 * MUTAÇÕES (23/10/2026; cada uma foi aplicada, o teste acusou, e foi desfeita):
 *   - apagar a regra `prazo ... vence/acaba` → "meu prazo vence amanhã" e "o prazo acaba sexta" acusam;
 *   - apagar o `vetoDepois` do "preso" → "estou preso no trânsito" e "ficou preso no elevador" acusam;
 *   - apagar `(?<!\bnao )` da regra do prazo → "o prazo não vence agora" acusa;
 *   - apagar a regra de "pensão atrasada" → as três frases de pensão acusam.
 */
import { describe, expect, it } from "vitest";

import { detectaUrgenciaJuridica, detectaUrgenciasJuridicas } from "./urgencia-juridica";

const casos: Array<[string, string, string]> = [
  // [frase do cliente, tipo esperado, trecho esperado (contém)]
  ["Doutor, meu prazo vence amanhã e não sei o que fazer", "prazo", "prazo vence"],
  ["o prazo acaba sexta, recebi a intimação ontem", "prazo", "prazo acaba"],
  ["Recebi uma citação hoje de manhã, o oficial de justiça veio aqui em casa", "prazo", "Recebi uma citação"],
  ["fui intimado a responder o processo", "prazo", "fui intimado"],
  ["o prazo do recurso está vencendo e eu não achei advogado", "prazo", "prazo do recurso está vencendo"],
  ["perdi o prazo da contestação, tem como resolver?", "prazo", "perdi o prazo"],
  ["faltam 2 dias para o prazo de recurso", "prazo", "faltam 2 dias"],
  ["Tenho audiência marcada pra segunda-feira", "audiencia", "audiência"],
  ["marcaram uma audiência para dia 30", "audiencia", "audiência"],
  ["Meu filho foi preso ontem à noite", "preso", "foi preso"],
  ["prenderam meu marido em flagrante", "preso", "prenderam"],
  ["meu irmão tá preso desde ontem", "preso", "tá preso"],
  ["estou na delegacia agora", "preso", "delegacia"],
  ["o juiz deu uma liminar mandando eu sair", "liminar", "liminar"],
  ["recebi uma notificação de despejo", "despejo", "despejo"],
  ["vão me despejar do apartamento", "despejo", "despejar"],
  ["o pai do meu filho não paga a pensão há 3 meses", "alimentos_atrasados", "não paga a pensão"],
  ["estou com a pensão atrasada e disseram que posso ir preso", "alimentos_atrasados", "pensão atrasada"],
  ["pode ter prisão civil por causa da pensão?", "alimentos_atrasados", "prisão civil"],
];

describe("urgência jurídica: o que o cliente leigo escreve", () => {
  it.each(casos)("%s", (frase, tipo, trecho) => {
    const achadas = detectaUrgenciasJuridicas(frase);
    const u = achadas.find((x) => x.tipo === tipo);
    expect(u, `tipos achados: ${achadas.map((x) => x.tipo).join(",")}`).toBeDefined();
    expect(u!.trecho).toContain(trecho);
  });

  it("devolve o trecho como o cliente escreveu (acento e caixa preservados)", () => {
    expect(detectaUrgenciaJuridica("MEU PRAZO VENCE AMANHÃ!")?.trecho).toBe("PRAZO VENCE");
    expect(detectaUrgenciaJuridica("Tenho AUDIÊNCIA marcada")?.trecho).toBe("Tenho AUDIÊNCIA");
  });

  it("a mais grave vem primeiro: preso antes de prazo", () => {
    const todas = detectaUrgenciasJuridicas("meu filho foi preso e o prazo vence amanhã");
    expect(todas.map((u) => u.tipo)).toEqual(["preso", "prazo"]);
    expect(detectaUrgenciaJuridica("meu filho foi preso e o prazo vence amanhã")?.tipo).toBe("preso");
  });
});

describe("urgência jurídica: controles negativos (o óbvio que não é urgência)", () => {
  const semUrgencia = [
    "estou preso no trânsito, chego atrasado na consulta",
    "ficou preso no elevador por uma hora",
    "o carro está preso na lama",
    "meu cabelo ficou preso na porta",
    "o prazo não vence agora, tenho tempo",
    "como funciona uma audiência de conciliação?",
    "não tenho audiência nenhuma marcada",
    "o que é uma citação?",
    "fui na delegacia do trabalho e me mandaram procurar advogado",
    "quanto custa a pensão alimentícia em média?",
    "meu pai não recebe a pensão por morte do INSS",
    "bom dia, quero saber como funciona o escritório",
    "fui mandado embora semana passada e quero meus direitos",
    "",
    "   ",
  ];
  it.each(semUrgencia)("%s", (frase) => {
    expect(detectaUrgenciasJuridicas(frase)).toEqual([]);
  });
});
