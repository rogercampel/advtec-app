/**
 * Spec 0001.E3, critério 9 — urgência jurídica, com frases de cliente leigo. Como um acerto tira a conversa
 * do robô, os dois lados são testados: o que DEVE acender e o que NÃO pode.
 *
 * MUTAÇÕES (24/10/2026; `C:/t/mut-triagem/mutar2.cjs`; cada uma aplicada, acusada pelo teste citado e desfeita):
 *   - apagar a regra crua `meu prazo vence/acaba` → "meu prazo vence amanhã" e "o prazo acaba sexta" acusam;
 *   - tirar o `exigeNaFrase` do prazo com complemento → "o prazo da minha proposta vence amanhã" acusa;
 *   - tirar a PERGUNTA_GERAL → "Preciso entender o que é uma liminar" e "li uma matéria sobre prisão civil" acusam;
 *   - afrouxar a delegacia para "delegacia" solta → "Fui na delegacia fazer um boletim…" acusa;
 *   - afrouxar liminar/despejo para a palavra solta → "como funciona o despejo…" e "o que é uma liminar" acusam;
 *   - apagar o `vetoDepois` do "preso" → "estou preso no trânsito" e "ficou preso no elevador" acusam;
 *   - apagar `(?<!\bnao )` do prazo → "o prazo não vence agora" acusa;
 *   - apagar a regra de "pensão atrasada" → as frases de pensão acusam;
 *   - `tipoDeUrgenciaDoTexto` aceitando qualquer texto → "não há urgência" acusa.
 */
import { describe, expect, it } from "vitest";

import { detectaUrgenciaJuridica, detectaUrgenciasJuridicas, tipoDeUrgenciaDoTexto } from "./urgencia-juridica";

const casos: Array<[string, string, string]> = [
  // [frase do cliente, tipo esperado, trecho esperado (contém)]
  ["Doutor, meu prazo vence amanhã e não sei o que fazer", "prazo", "prazo vence"],
  ["o prazo acaba sexta, recebi a intimação ontem", "prazo", "prazo acaba"],
  ["meu prazo no processo vence amanhã", "prazo", "prazo no processo vence"],
  ["Recebi uma citação hoje de manhã, o oficial de justiça veio aqui em casa", "prazo", "Recebi uma citação"],
  ["fui intimado a responder o processo", "prazo", "fui intimado"],
  ["o prazo do recurso está vencendo e eu não achei advogado", "prazo", "prazo do recurso está vencendo"],
  ["perdi o prazo da contestação, tem como resolver?", "prazo", "perdi o prazo"],
  ["faltam 2 dias para o prazo de recurso", "prazo", "faltam 2 dias"],
  ["Tenho audiência marcada pra segunda-feira", "audiencia", "audiência"],
  ["marcaram uma audiência para dia 30", "audiencia", "audiência"],
  ["a audiência é amanhã", "audiencia", "audiência é amanhã"],
  ["Meu filho foi preso ontem à noite", "preso", "foi preso"],
  ["meu filho foi preso ontem", "preso", "foi preso"],
  ["estou preso", "preso", "estou preso"],
  ["prenderam meu marido em flagrante", "preso", "prenderam"],
  ["meu irmão tá preso desde ontem", "preso", "tá preso"],
  ["ele foi pego em flagrante", "preso", "pego em flagrante"],
  ["estou na delegacia agora", "preso", "na delegacia"],
  ["meu filho está na delegacia", "preso", "na delegacia"],
  ["levaram meu marido para a delegacia", "preso", "delegacia"],
  ["o juiz deu uma liminar mandando eu sair", "liminar", "liminar"],
  ["o juiz deu liminar contra mim", "liminar", "deu liminar"],
  ["vou ser despejado sexta", "despejo", "vou ser despejado"],
  ["recebi ordem de despejo", "despejo", "ordem de despejo"],
  ["recebi uma notificação de despejo", "despejo", "despejo"],
  ["vão me despejar do apartamento", "despejo", "me despejar"],
  ["meu aluguel está atrasado e o dono falou em despejo", "despejo", "falou em despejo"],
  ["o pai do meu filho não paga a pensão há 3 meses", "alimentos_atrasados", "não paga a pensão"],
  ["ele não paga a pensão há 3 meses e vou pedir a prisão", "alimentos_atrasados", "não paga a pensão"],
  ["estou com a pensão atrasada e disseram que posso ir preso", "alimentos_atrasados", "pensão atrasada"],
  ["tenho medo de prisão civil por causa da pensão", "alimentos_atrasados", "medo de prisão civil"],
];

describe("urgência jurídica: o que o cliente leigo escreve", () => {
  it.each(casos)("%s", (frase, tipo, trecho) => {
    const achadas = detectaUrgenciasJuridicas(frase);
    const u = achadas.find((x) => x.tipo === tipo);
    expect(u, `tipos achados: ${achadas.map((x) => x.tipo).join(",")}`).toBeDefined();
    expect(u!.trecho).toContain(trecho);
  });

  it("devolve o trecho como o cliente escreveu (acento e caixa preservados)", () => {
    expect(detectaUrgenciaJuridica("MEU PRAZO VENCE AMANHÃ!")?.trecho).toBe("MEU PRAZO VENCE");
    expect(detectaUrgenciaJuridica("Tenho AUDIÊNCIA marcada")?.trecho).toBe("Tenho AUDIÊNCIA");
  });

  it("a mais grave vem primeiro: preso antes de prazo", () => {
    const todas = detectaUrgenciasJuridicas("meu filho foi preso e o prazo vence amanhã");
    expect(todas.map((u) => u.tipo)).toEqual(["preso", "prazo"]);
    expect(detectaUrgenciaJuridica("meu filho foi preso e o prazo vence amanhã")?.tipo).toBe("preso");
  });

  it("pergunta geral numa oração e urgência real em outra: a real acende", () => {
    expect(detectaUrgenciasJuridicas("Queria saber o que fazer, meu filho foi preso agora")[0]?.tipo).toBe("preso");
    expect(detectaUrgenciasJuridicas("Como funciona isso? Recebi ordem de despejo")[0]?.tipo).toBe("despejo");
  });
});

describe("urgência jurídica: controles negativos (o que NÃO pode tirar a conversa do robô)", () => {
  const semUrgencia = [
    // os cinco que o turno acendia sem motivo
    "Fui na delegacia fazer um boletim porque caí num golpe",
    "Preciso entender o que é uma liminar",
    "Como funciona o despejo por falta de pagamento?",
    "o prazo da minha proposta vence amanhã",
    "li uma matéria sobre prisão civil",
    // outras frases do mesmo tipo
    "Qual o prazo de recurso? Ele vence em 15 dias, certo?",
    "Quero saber como funciona o despejo",
    "o que é uma liminar?",
    "o que é habeas corpus?",
    "li uma notícia sobre prisão preventiva",
    "o prazo do meu plano de saúde vence amanhã",
    // a palavra solta, dita como definição e não como o caso de alguém
    "liminar é uma decisão provisória do juiz",
    "despejo é o que acontece quando o inquilino não paga",
    "prisão civil é aplicada só a devedor de pensão",
    "o prazo do recurso não vence agora, tenho tempo",
    "o prazo não vence agora, tenho tempo",
    // preso de outra coisa
    "estou preso no trânsito, chego atrasado na consulta",
    "estou preso no elevador",
    "ficou preso no elevador por uma hora",
    "o carro está preso na lama",
    "meu cabelo ficou preso na porta",
    // o resto
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

describe("a marca de urgência que o modelo manda: só um tipo conhecido conta", () => {
  it.each([
    ["prazo", "prazo"],
    ["Prazo correndo", "prazo"],
    ["audiência", "audiencia"],
    ["preso", "preso"],
    ["pessoa presa", "preso"],
    ["despejo", "despejo"],
    ["liminar", "liminar"],
    ["alimentos_atrasados", "alimentos_atrasados"],
    ["pensão atrasada", "alimentos_atrasados"],
  ])("%s -> %s", (texto, tipo) => expect(tipoDeUrgenciaDoTexto(texto)).toBe(tipo));

  it.each(["não há urgência", "sem urgência aparente", "nenhuma urgência", "urgente", "talvez prazo na semana que vem", "nao", "", "   "])(
    "'%s' não é um tipo",
    (texto) => expect(tipoDeUrgenciaDoTexto(texto)).toBeNull(),
  );
});
