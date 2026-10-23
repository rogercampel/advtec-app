import fs from "node:fs";
import path from "node:path";

import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  BEFORE_SEND_GATES,
  evaluateBeforeSend,
  runBeforeSend,
  type GateContext,
} from "@/lib/agent-engine/guardrails/before-send";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { SPINNING_DEFAULTS } from "@/lib/agent-engine/spinning/defaults";
import { textoDoAviso } from "@/lib/escalacao/aviso-ao-lead";
import { comIdentificacaoSeForOPrimeiro } from "@/lib/oab/identificacao-do-aviso";
import { defereAoAdvogado, seIdentificaComoMaquina } from "@/lib/oab/travas";
import {
  CODIGO_TRAVA_OAB,
  CODIGO_TRAVA_OAB_IDENTIFICACAO,
  CODIGO_TRAVA_OAB_PEDIU_HUMANO,
  desfechoDaTravaDaOab,
  FRASE_DE_IDENTIFICACAO,
  FRASE_DE_IDENTIFICACAO_ES,
  INSTRUCAO_DE_REFORMULAR,
  motivosDosValoresDoTemplate,
  motivosDoTrace,
  semOTemplate,
  travasOabGate,
  VETOS_ATE_ENTREGAR,
  VETOS_ATE_INJETAR_IDENTIFICACAO,
} from "@/lib/oab/gate-das-travas";

/**
 * AS TRAVAS DA OAB NA CADEIA before_send — gate, fiação e as regras da revisão de 23/10/2026.
 *
 * MUTAÇÕES FEITAS em 23/10/2026. Em cada uma a regra foi apagada, o(s) teste(s) citado(s)
 * acusaram, e a regra voltou (a lista das regras novas está no fim do arquivo, no bloco
 * "mutações da revisão"):
 *   1. gate: `armado === undefined` -> no-op removido: "campo ausente é no-op" e "a cadeia
 *      sem o campo envia o MESMO corpo" vermelhos.
 *   2. gate: ramo `mensagemDoCliente === null` desligado: "follow-up (null) só confere as
 *      proibições" vermelho.
 *   3. gate: ramo do veto retentável de identificação removido: vermelhos.
 *   4. gate: `detail` passou a levar o corpo: "o detail leva só rótulos" vermelho.
 *   5. before-send: `travasOabGate` movido para ANTES do `disclosureGate`: vermelhos, entre
 *      eles "fica DEPOIS do disclosure" e "é o ÚLTIMO".
 *   7. gate: template contido no corpo deixa de contar como identificação: vermelho.
 *   8. travas.ts: artigo "o"/"a" fora da regra de identificação: vermelhos (inclui oab-travas).
 *
 * MUTAÇÕES DAS REGRAS DA REVISÃO (23/10/2026, 19 aplicadas, todas acusadas e desfeitas):
 *   R1  gate julga o corpo COM o template -> 3 vermelhos (regra 1).
 *   R2a o 1º veto passa a entregar -> "o 1º veto ensina…"; R2b `VETOS_ATE_ENTREGAR = 1` -> a constante;
 *       R2c o gate perde a instrução de reformular -> "erro INSTRUTIVO".
 *   R3a o gate ignora `deferiuNoTurno`; R3b o turno não guarda a deferência -> bolhas / fiação.
 *   R4  os valores do template não são julgados -> fiação do `send_template`.
 *   R5a a régua volta a ser `isFirstOutbound`; R5b o turno não consulta o modelo -> 3 vermelhos.
 *   R6  briefing com "0 enviadas" fixo -> fiação da entrega.
 *   R7  aviso sempre "com mensagem"; R7b abertura que fala em "sua mensagem" -> 4 vermelhos.
 *   R8  aviso sem a frase de identificação -> fiação do aviso.
 *   R9a o turno nunca liga `injetaIdentificacao`; R9b o gate não emenda; R9c a frase não identifica.
 *   R10 a tela perde "dispensa a vedação da OAB" -> `painel-de-seguranca.test.tsx`.
 *   R12 identificação deixa de ser retentável -> 5 vermelhos; R13 pedido de pessoa vira retentável.
 * O turno inteiro contra Postgres: `tests/invariants/travas-da-oab-no-turno.test.ts` (roda na CI).
 */

function baseCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    now: new Date("2026-07-28T13:00:00Z"), // 10h BRT, terça — dentro da janela
    body: "",
    optedOut: false,
    provider: "waha",
    pacing: {
      knobs: PACING_DEFAULTS,
      state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
      crmDailyLimit: null,
      rng: () => 0,
    },
    spinning: { knobs: SPINNING_DEFAULTS, window: [] },
    promise: { table: null },
    semanticPromise: null,
    disclosure: { template: null, isFirstOutbound: false, mode: "inject" },
    lgpd: null,
    casesEnabled: false,
    hasOpenCase: false,
    openedCaseThisTurn: false,
    ...overrides,
  };
}

/** O que o turno arma: por padrão, não é a 1ª resposta do modelo e nada foi dito antes no turno. */
function armado(
  mensagemDoCliente: string | null,
  extra: Partial<NonNullable<GateContext["travasOab"]>> = {},
): NonNullable<GateContext["travasOab"]> {
  return {
    mensagemDoCliente,
    primeiraRespostaDoModelo: false,
    deferiuNoTurno: false,
    injetaIdentificacao: false,
    ...extra,
  };
}

const IDENTIFICACAO = "Sou o assistente virtual do escritório, um atendimento automatizado.";

function veto(ctx: GateContext) {
  const v = travasOabGate.evaluate(ctx);
  if (v.pass) throw new Error("esperava veto, mas o gate passou");
  return v;
}

describe("travasOabGate — a resposta que não pode sair", () => {
  it("promessa de resultado no corpo -> trava_oab", () => {
    const v = veto(
      baseCtx({
        body: "Você vai ganhar com certeza.",
        travasOab: armado("Oi, preciso de ajuda com uma rescisão"),
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
    expect(v.detail?.motivos).toMatch(/promessa_de_resultado/);
  });

  it("o veto de conteúdo é erro INSTRUTIVO: o texto não foi enviado e o modelo é orientado a reformular deferindo", () => {
    const v = veto(baseCtx({ body: "Você vai ganhar com certeza.", travasOab: armado("Oi") }));
    expect(v.reason).toBe(INSTRUCAO_DE_REFORMULAR);
    expect(v.reason).toMatch(/NÃO foi enviado/);
    expect(v.reason).toMatch(/Reformule/);
    expect(v.reason).toMatch(/cabe ao advogado/);
    expect(v.reason).toMatch(/sem prometer resultado/);
    expect(v.reason).toMatch(/entregue ao advogado/);
  });

  it("pergunta de mérito + resposta que opina -> trava_oab (pergunta_de_merito)", () => {
    const v = veto(
      baseCtx({
        body: "Pelo que você contou, a chance é boa.",
        travasOab: armado("Eu ganho essa causa?"),
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
    expect(v.detail?.motivos).toBe("pergunta_de_merito");
  });

  it("pergunta de mérito + resposta que defere ao advogado -> passa", () => {
    const v = travasOabGate.evaluate(
      baseCtx({
        body: "Essa análise é do advogado; vou passar o seu caso hoje.",
        travasOab: armado("Eu ganho essa causa?"),
      }),
    );
    expect(v.pass).toBe(true);
  });

  it("deferir não dá licença para prometer na mesma frase", () => {
    const v = veto(
      baseCtx({
        body: "O advogado vai avaliar, mas garanto que você vai ganhar.",
        travasOab: armado("Eu ganho essa causa?"),
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
  });

  it("pedido de humano -> trava_oab_pediu_humano (reformular não resolve: entrega já)", () => {
    const v = veto(baseCtx({ body: "Claro, já vou ajudar!", travasOab: armado("quero falar com um advogado") }));
    expect(v.code).toBe(CODIGO_TRAVA_OAB_PEDIU_HUMANO);
    expect(v.detail?.motivos).toBe("pediu_humano");
  });

  it("mensagem só de espaços não é mensagem: vale como turno sem mensagem nova (não há motivo 'sem_mensagem')", () => {
    // O motivo `sem_mensagem` era inalcançável: o turno entrega `null` quando o texto é vazio.
    // Se chegar uma string vazia por outro montador, ela se comporta como `null` — não vira entrega.
    expect(travasOabGate.evaluate(baseCtx({ body: "Olá!", travasOab: armado("   ") })).pass).toBe(true);
    const v = veto(baseCtx({ body: "Você vai ganhar com certeza.", travasOab: armado("   ") }));
    expect(String(v.detail?.motivos)).not.toMatch(/sem_mensagem/);
  });

  it("resposta limpa a uma mensagem comum passa", () => {
    const v = travasOabGate.evaluate(
      baseCtx({
        body: "Posso anotar o seu nome completo e o assunto?",
        travasOab: armado("Bom dia, preciso de ajuda"),
      }),
    );
    expect(v.pass).toBe(true);
  });
});

describe("travasOabGate — o template de disclosure não é julgado como texto do modelo (regra 1)", () => {
  const TEMPLATE = "Sou o assistente virtual do escritório. Não garantimos resultado em nenhum caso.";

  it("controle: a frase do template, sozinha, É uma promessa para as travas", () => {
    const v = veto(baseCtx({ body: "Não garantimos resultado em nenhum caso.", travasOab: armado("Bom dia") }));
    expect(v.detail?.motivos).toMatch(/promessa_de_resultado/);
  });

  it("template com 'não garantimos resultado' + 1ª resposta normal do modelo -> passa", () => {
    const corpo = `${TEMPLATE}\n\nPosso anotar o seu nome completo e o assunto?`;
    const v = travasOabGate.evaluate(
      baseCtx({
        body: corpo,
        disclosure: { template: TEMPLATE, isFirstOutbound: true, mode: "inject" },
        travasOab: armado("Bom dia, preciso de ajuda", { primeiraRespostaDoModelo: true }),
      }),
    );
    expect(v.pass).toBe(true);
  });

  it("na cadeia real: o template é injetado, e a 1ª resposta normal não é vetada por ele", () => {
    const r = evaluateBeforeSend(
      baseCtx({
        body: "Posso anotar o seu nome completo e o assunto?",
        disclosure: { template: TEMPLATE, isFirstOutbound: true, mode: "inject" },
        travasOab: armado("Bom dia, preciso de ajuda", { primeiraRespostaDoModelo: true }),
      }),
    );
    expect(r.veto).toBeNull();
    expect(r.body.startsWith(TEMPLATE)).toBe(true);
  });

  it("a promessa do MODELO ao lado do template continua barrada", () => {
    const v = veto(
      baseCtx({
        body: `${TEMPLATE}\n\nVocê vai ganhar com certeza.`,
        disclosure: { template: TEMPLATE, isFirstOutbound: true, mode: "inject" },
        travasOab: armado("Bom dia", { primeiraRespostaDoModelo: true }),
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
  });

  it("template que cita 'o advogado' NÃO conta como deferência na pergunta de mérito", () => {
    const template = "Sou o assistente virtual. Quem atende é o advogado do escritório.";
    const v = veto(
      baseCtx({
        body: `${template}\n\nPelo que você contou, a chance é boa.`,
        disclosure: { template, isFirstOutbound: true, mode: "inject" },
        travasOab: armado("Eu ganho essa causa?", { primeiraRespostaDoModelo: true }),
      }),
    );
    expect(v.detail?.motivos).toBe("pergunta_de_merito");
  });

  it("semOTemplate tira o trecho sem caixa e com qualquer espaço, e devolve o corpo se não acha", () => {
    expect(semOTemplate("SOU o  assistente\nvirtual. Posso ajudar?", "Sou o assistente virtual.")).toBe("Posso ajudar?");
    expect(semOTemplate("Posso ajudar?", "Sou o assistente virtual.")).toBe("Posso ajudar?");
    expect(semOTemplate("Posso ajudar? (ok)", "   ")).toBe("Posso ajudar? (ok)");
  });
});

describe("travasOabGate — a identificação da 1ª resposta do MODELO é retentável", () => {
  const primeira = { template: null, isFirstOutbound: true, mode: "inject" as const };
  const daPrimeira = (extra: Partial<NonNullable<GateContext["travasOab"]>> = {}) =>
    armado("Bom dia, preciso de ajuda", { primeiraRespostaDoModelo: true, ...extra });

  it("1ª resposta sem se declarar atendimento automatizado -> trava_oab_identificacao", () => {
    const v = veto(baseCtx({ disclosure: primeira, body: "Olá! Como posso ajudar?", travasOab: daPrimeira() }));
    expect(v.code).toBe(CODIGO_TRAVA_OAB_IDENTIFICACAO);
    // É instrução ao modelo: precisa dizer o que escrever, não só o que está errado.
    expect(v.reason).toMatch(/automatizado/);
    expect(v.reason).toMatch(/Reescreva/);
  });

  it("a mesma 1ª resposta, agora se identificando -> passa", () => {
    const v = travasOabGate.evaluate(
      baseCtx({ disclosure: primeira, body: `Olá! ${IDENTIFICACAO} Como posso ajudar?`, travasOab: daPrimeira() }),
    );
    expect(v.pass).toBe(true);
  });

  it("a régua é a do MODELO, não a do ledger: já houve envio de template/aviso (isFirstOutbound=false) e mesmo assim cobra", () => {
    // Antes, `disclosure.isFirstOutbound` era a régua: depois de qualquer template, aviso ou follow-up
    // fixo o modelo nunca era cobrado de se declarar máquina.
    const v = veto(
      baseCtx({
        disclosure: { template: null, isFirstOutbound: false, mode: "inject" },
        body: "Olá Maria! Como posso ajudar?",
        travasOab: daPrimeira(),
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB_IDENTIFICACAO);
  });

  it("e a partir da 2ª resposta do modelo a identificação não é cobrada, mesmo que o ledger diga 'primeiro envio'", () => {
    const v = travasOabGate.evaluate(
      baseCtx({
        disclosure: primeira,
        body: "Posso anotar o seu nome completo?",
        travasOab: armado("Bom dia", { primeiraRespostaDoModelo: false }),
      }),
    );
    expect(v.pass).toBe(true);
  });

  it("identificação faltando + outra violação -> trava_oab (não é a retentável da identificação)", () => {
    const v = veto(baseCtx({ disclosure: primeira, body: "Olá! Você vai ganhar com certeza.", travasOab: daPrimeira() }));
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
    expect(v.detail?.motivos).toMatch(/promessa_de_resultado/);
    expect(v.detail?.motivos).toMatch(/sem_identificacao_de_maquina/);
  });

  it("o template de apresentação da organização, contido no corpo, conta como identificação", () => {
    // Um template que NÃO casa o regex de `seIdentificaComoMaquina` vetaria toda 1ª mensagem
    // em loop: o disclosure o injeta, o gate o rejeita, o modelo não tem como consertá-lo.
    const template = "Bem-vindo ao Escritório Silva! Este canal é de atendimento inicial.";
    const corpo = `${template}\n\nComo posso ajudar?`;
    expect(seIdentificaComoMaquina(template)).toBe(false); // controle: o template não casa
    expect(
      travasOabGate.evaluate(
        baseCtx({ disclosure: { template, isFirstOutbound: true, mode: "inject" }, body: corpo, travasOab: daPrimeira() }),
      ).pass,
    ).toBe(true);
    // Contraste: o mesmo corpo, sem o template configurado, é vetado pela identificação.
    expect(veto(baseCtx({ disclosure: primeira, body: corpo, travasOab: daPrimeira() })).code).toBe(
      CODIGO_TRAVA_OAB_IDENTIFICACAO,
    );
    // E com template configurado mas AUSENTE do corpo, continua vetando.
    expect(
      veto(
        baseCtx({
          disclosure: { template, isFirstOutbound: true, mode: "inject" },
          body: "Olá! Como posso ajudar?",
          travasOab: daPrimeira(),
        }),
      ).code,
    ).toBe(CODIGO_TRAVA_OAB_IDENTIFICACAO);
  });

  it("depois de 2 recusas no turno o gate EMENDA a frase de identificação em vez de vetar de novo (regra 9)", () => {
    const corpo = "Olá! Como posso ajudar?";
    // Sem o sinal do turno: veta.
    expect(veto(baseCtx({ disclosure: primeira, body: corpo, travasOab: daPrimeira() })).code).toBe(
      CODIGO_TRAVA_OAB_IDENTIFICACAO,
    );
    // Com o sinal: passa, emendando a frase no início — e a frase de fato identifica.
    const v = travasOabGate.evaluate(
      baseCtx({ disclosure: primeira, body: corpo, travasOab: daPrimeira({ injetaIdentificacao: true }) }),
    );
    expect(v.pass).toBe(true);
    if (!v.pass) throw new Error("inalcançável");
    expect(v.amendBody).toBe(`${FRASE_DE_IDENTIFICACAO}\n\n${corpo}`);
    expect(seIdentificaComoMaquina(FRASE_DE_IDENTIFICACAO)).toBe(true);
  });

  it("a emenda não vale para o que NÃO é só falta de identificação: a promessa continua vetada", () => {
    const v = veto(
      baseCtx({
        disclosure: primeira,
        body: "Olá! Você vai ganhar com certeza.",
        travasOab: daPrimeira({ injetaIdentificacao: true }),
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
  });

  it("na cadeia real, a emenda da identificação é o corpo que vai ao cliente", () => {
    const r = evaluateBeforeSend(
      baseCtx({
        disclosure: primeira,
        body: "Olá! Como posso ajudar?",
        travasOab: daPrimeira({ injetaIdentificacao: true }),
      }),
    );
    expect(r.veto).toBeNull();
    expect(r.body).toBe(`${FRASE_DE_IDENTIFICACAO}\n\nOlá! Como posso ajudar?`);
  });
});

describe("travasOabGate — bolhas: a deferência pode estar noutra mensagem do mesmo turno (regra 3)", () => {
  const PERGUNTA = "Eu ganho essa causa?";

  it("a bolha 'Entendi a sua dúvida.' sozinha é barrada; depois de uma bolha que deferiu, passa", () => {
    const bolha = "Entendi a sua dúvida.";
    expect(veto(baseCtx({ body: bolha, travasOab: armado(PERGUNTA) })).detail?.motivos).toBe("pergunta_de_merito");
    expect(
      travasOabGate.evaluate(baseCtx({ body: bolha, travasOab: armado(PERGUNTA, { deferiuNoTurno: true }) })).pass,
    ).toBe(true);
  });

  it("a deferência anterior não dá licença para prometer na bolha seguinte", () => {
    const v = veto(
      baseCtx({
        body: "Mas fique tranquilo, você vai ganhar.",
        travasOab: armado(PERGUNTA, { deferiuNoTurno: true }),
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
  });

  it("a bolha que deferiu é reconhecida pela mesma régua da trava", () => {
    expect(defereAoAdvogado("Essa análise é do advogado; vou passar o seu caso hoje.")).toBe(true);
    expect(defereAoAdvogado("Entendi a sua dúvida.")).toBe(false);
  });
});

describe("travasOabGate — armado ou no-op", () => {
  it("campo ausente é no-op: passa até com o corpo proibido na 1ª mensagem", () => {
    // É o que mantém os testes herdados (e o follow-up, o template, o Testar) como eram.
    const v = travasOabGate.evaluate(
      baseCtx({
        disclosure: { template: null, isFirstOutbound: true, mode: "inject" },
        body: "Garanto que você vai ganhar R$ 30 mil.",
      }),
    );
    expect(v.pass).toBe(true);
  });

  it("follow-up (mensagemDoCliente null) só confere as proibições da resposta", () => {
    // Sem mensagem nova não há pergunta a defender: o que não for proibido passa,
    // mesmo sem deferir ao advogado nem pedir nada.
    expect(
      travasOabGate.evaluate(
        baseCtx({
          body: "Bom dia! Passando para saber se ainda precisa de ajuda.",
          travasOab: armado(null),
        }),
      ).pass,
    ).toBe(true);
    // ...mas a promessa continua barrada.
    const v = veto(
      baseCtx({
        body: "Bom dia! Lembrando que você vai ganhar o processo.",
        travasOab: armado(null),
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
    expect(v.detail?.motivos).toMatch(/promessa_de_resultado/);
  });

  it("o detail leva só rótulos — nunca o trecho, o valor nem o nome do caso", () => {
    const v = veto(
      baseCtx({
        body: "João, garanto que você vai receber R$ 30 mil na ação trabalhista.",
        travasOab: armado("Oi"),
      }),
    );
    const serializado = JSON.stringify(v.detail);
    expect(serializado).not.toMatch(/Jo[ãa]o|garanto|R\$|30 mil|trabalhista/i);
    for (const motivo of String(v.detail?.motivos).split(",")) {
      expect(motivo).toMatch(/^[a-z_]+$/);
    }
    expect(v.detail?.quantidade).toBeGreaterThan(0);
  });

  it("motivosDoTrace traduz os rótulos do trace para o briefing, sem trecho", () => {
    const texto = motivosDoTrace([
      { gate: "travas_oab", verdict: "veto", code: "trava_oab", detail: { motivos: "promessa_de_resultado,pediu_humano" } },
    ]);
    expect(texto).toBe("promessa de resultado; o cliente pediu para falar com uma pessoa");
    expect(motivosDoTrace([])).toBe("motivo não registrado");
  });
});

describe("os VALORES de um template são texto do modelo (regra 4)", () => {
  it("valor com promessa de resultado ou valor de ganho é acusado; o que é neutro passa", () => {
    expect(motivosDosValoresDoTemplate({ "1": "Maria", "2": "Garanto que você vai ganhar a causa" })).toContain(
      "promessa_de_resultado",
    );
    expect(motivosDosValoresDoTemplate({ "1": "Maria", "2": "terça-feira, às 15h" })).toEqual([]);
  });

  it("não exige deferência: valor de variável não responde a pergunta nenhuma", () => {
    expect(motivosDosValoresDoTemplate({ "1": "Maria" })).toEqual([]);
  });
});

describe("o que a passagem conta sobre o turno (regra 6)", () => {
  it("diz o que de fato saiu: nenhuma, uma ou N mensagens antes da barrada", () => {
    expect(desfechoDaTravaDaOab("promessa de resultado", 0)).toBe(
      "Barrado pela trava da OAB (promessa de resultado); o texto barrado não foi enviado; nenhuma mensagem do assistente saiu ao cliente neste turno.",
    );
    expect(desfechoDaTravaDaOab("promessa de resultado", 1)).toMatch(/1 mensagem do assistente já tinha saído/);
    expect(desfechoDaTravaDaOab("promessa de resultado", 3)).toMatch(/3 mensagens do assistente já tinham saído/);
    expect(desfechoDaTravaDaOab("promessa de resultado", 2)).not.toMatch(/nenhuma/);
  });
});

describe("o aviso ao cliente quando a trava entrega a conversa", () => {
  const LEAD = "11111111-1111-4111-8111-111111111111";

  it("regra 7: sem mensagem do cliente (follow-up) o aviso não diz 'sua mensagem'", () => {
    for (const quem of [null, { total: 2, disponiveis: 1 }, { total: 2, disponiveis: 0 }]) {
      for (const idioma of ["pt-BR", "es"]) {
        const semMensagem = textoDoAviso("advogado_vai_assumir", quem, LEAD, idioma);
        expect(semMensagem, `${idioma}: ${semMensagem}`).not.toMatch(/sua mensagem|tu mensaje/i);
        expect(semMensagem).toMatch(/advogado|abogado/i);
      }
    }
    // Contraste: o aviso de quem escreveu pode (e deve) dizer que a mensagem foi encaminhada.
    const aviso = ["pt-BR", "es"].map((i) => textoDoAviso("advogado_vai_responder", null, LEAD, i));
    expect(aviso.join(" ")).toMatch(/mensagem|conversa|mensaje|conversación/i);
  });

  it("regra 7: todo lead recebe uma variante sem 'sua mensagem' (as três aberturas)", () => {
    const leads = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    for (const lead of leads) {
      expect(textoDoAviso("advogado_vai_assumir", null, lead, "pt")).not.toMatch(/sua mensagem/i);
    }
  });

  /** Um banco falso que responde às duas consultas da regra 8, pelo texto do SQL. */
  function bancoFalso(opts: { template: boolean; envioAnterior: boolean }) {
    return {
      query: vi.fn(async (sql: string) => {
        if (/disclosure_template_pointers/.test(sql)) {
          return { rows: opts.template ? [{ version_id: "v1", body: "Sou o assistente virtual." }] : [] };
        }
        return { rows: [{ existe: opts.envioAnterior }] };
      }),
    } as unknown as Parameters<typeof comIdentificacaoSeForOPrimeiro>[0];
  }
  const IDS = { tenantId: "t", leadId: "l" };
  const CORPO = "Esse assunto precisa ser respondido por um advogado do escritório.";

  it("regra 8: o aviso que é o 1º envio, sem template de disclosure, abre com a identificação", async () => {
    const r = await comIdentificacaoSeForOPrimeiro(bancoFalso({ template: false, envioAnterior: false }), IDS, CORPO, "pt-BR");
    expect(r).toBe(`${FRASE_DE_IDENTIFICACAO}\n\n${CORPO}`);
    expect(seIdentificaComoMaquina(r)).toBe(true);
    const es = await comIdentificacaoSeForOPrimeiro(bancoFalso({ template: false, envioAnterior: false }), IDS, CORPO, "es");
    expect(es.startsWith(FRASE_DE_IDENTIFICACAO_ES)).toBe(true);
  });

  it("regra 8: com template de disclosure, ou depois de outro envio, o aviso segue como está", async () => {
    expect(await comIdentificacaoSeForOPrimeiro(bancoFalso({ template: true, envioAnterior: false }), IDS, CORPO, "pt")).toBe(CORPO);
    expect(await comIdentificacaoSeForOPrimeiro(bancoFalso({ template: false, envioAnterior: true }), IDS, CORPO, "pt")).toBe(CORPO);
  });
});

describe("travasOabGate — na cadeia real", () => {
  const TEMPLATE = "Sou o assistente virtual do Escritório Silva, um atendimento automatizado.";

  it("fica DEPOIS do disclosure: a apresentação injetada é vista (1ª mensagem passa)", () => {
    const nomes = BEFORE_SEND_GATES.map((g) => g.name);
    expect(nomes.indexOf("travas_oab")).toBeGreaterThan(nomes.indexOf("disclosure"));

    const r = evaluateBeforeSend(
      baseCtx({
        body: "Olá! Como posso ajudar?",
        disclosure: { template: TEMPLATE, isFirstOutbound: true, mode: "inject" },
        travasOab: armado("Bom dia, preciso de ajuda", { primeiraRespostaDoModelo: true }),
      }),
    );
    expect(r.veto).toBeNull();
    // O corpo emendado é o que o gate julgou — e é o que vai ao cliente.
    expect(r.body.startsWith(TEMPLATE)).toBe(true);
    expect(r.trace.find((t) => t.gate === "travas_oab")).toEqual({ gate: "travas_oab", verdict: "pass" });
  });

  it("contraste: sem template de apresentação, o MESMO corpo é vetado pela identificação", () => {
    const r = evaluateBeforeSend(
      baseCtx({
        body: "Olá! Como posso ajudar?",
        disclosure: { template: null, isFirstOutbound: true, mode: "inject" },
        travasOab: armado("Bom dia, preciso de ajuda", { primeiraRespostaDoModelo: true }),
      }),
    );
    expect(r.veto?.gate).toBe("travas_oab");
    expect(r.veto?.code).toBe(CODIGO_TRAVA_OAB_IDENTIFICACAO);
  });

  it("modo veto do disclosure: o veto do disclosure vem ANTES e as travas nem rodam", () => {
    const r = evaluateBeforeSend(
      baseCtx({
        body: "Olá! Como posso ajudar?",
        disclosure: { template: TEMPLATE, isFirstOutbound: true, mode: "veto" },
        travasOab: armado("Bom dia"),
      }),
    );
    expect(r.veto?.gate).toBe("disclosure");
    expect(r.trace.find((t) => t.gate === "travas_oab")).toEqual({ gate: "travas_oab", verdict: "skipped" });
  });

  function chamaRunBeforeSend(args: { body: string; armado: boolean }) {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn().mockResolvedValue({ rows: [{ id: "trace-1" }] }),
    } as unknown as pg.Pool;
    const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return runBeforeSend({
      pool,
      log,
      tenantId: "00000000-0000-4000-8000-000000000001",
      leadId: "00000000-0000-4000-8000-000000000002",
      jobId: "00000000-0000-4000-8000-000000000003",
      channelSessionId: "00000000-0000-4000-8000-000000000004",
      body: args.body,
      optedOutThisTurn: false,
      crmDailyLimit: null,
      now: new Date("2026-07-28T13:00:00Z"),
      rng: () => 0,
      sleep: async () => {},
      ...(args.armado ? { travasOab: armado("Oi, tudo bem?") } : {}),
      send: async () => ({ kind: "sent", idempotencyKey: "k", messageId: "m" }),
    });
  }

  it("runBeforeSend repassa o campo: armado veta, e o trace leva o código e os rótulos", async () => {
    const r = await chamaRunBeforeSend({ body: "Você vai ganhar com certeza.", armado: true });
    expect(r.status).toBe("vetoed");
    if (r.status !== "vetoed") throw new Error("inalcançável");
    expect(r.gate).toBe("travas_oab");
    expect(r.code).toBe(CODIGO_TRAVA_OAB);
    expect(r.trace).toContainEqual(
      expect.objectContaining({ gate: "travas_oab", verdict: "veto", code: "trava_oab" }),
    );
  });

  it("a cadeia sem o campo envia o MESMO corpo", async () => {
    const r = await chamaRunBeforeSend({ body: "Você vai ganhar com certeza.", armado: false });
    expect(r.status).toBe("sent");
    expect(r.trace).toContainEqual({ gate: "travas_oab", verdict: "pass" });
  });
});

/**
 * FIAÇÃO — asserção sobre a FONTE (o turno não tem seam isolável). É guarda de ligação;
 * a prova ponta a ponta é `tests/invariants/travas-da-oab-no-turno.test.ts`.
 */
const lerFonte = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const FONTE_INBOUND = lerFonte("lib/agent-engine/agent/inbound-turn.ts");

function corpoDoExecute(ancora: string, fim: string): string {
  const i = FONTE_INBOUND.indexOf(ancora);
  expect(i, `âncora \`${ancora}\` sumiu do turno`).toBeGreaterThan(-1);
  const j = FONTE_INBOUND.indexOf(fim, i);
  expect(j, `âncora de fim \`${fim}\` sumiu`).toBeGreaterThan(i);
  return FONTE_INBOUND.slice(i, j);
}

describe("fiação das travas da OAB no turno", () => {
  const SEND_MESSAGE = () => corpoDoExecute("send_message: tool({", "update_lead_state: tool({");
  const SEND_TEMPLATE = () => corpoDoExecute("send_template: tool({", "search_knowledge: tool({");

  it("as travas armam pela camada da organização, com padrão LIGADO, e só fora do Testar", () => {
    expect(FONTE_INBOUND).toMatch(/const travasArmadas = !preview && camadaLigada\(camadas\.travas_oab,\s*true\)/);
    expect(SEND_MESSAGE()).toMatch(/if \(travasArmadas\)/);
  });

  it("o 1º veto ensina, o 2º entrega; a emenda da identificação vem depois de 2 recusas", () => {
    expect(VETOS_ATE_ENTREGAR).toBe(2);
    expect(VETOS_ATE_INJETAR_IDENTIFICACAO).toBe(2);
  });

  it("send_message só arma a mensagem do cliente no turno de resposta", () => {
    expect(SEND_MESSAGE()).toMatch(/eTurnoDeResposta\(liveJob\(\)\) \? mensagemDoClienteNoTurno : null/);
  });

  it("a 'primeira resposta' é a do MODELO (consulta própria), e a deferência vem dos corpos já enviados", () => {
    const corpo = SEND_MESSAGE();
    expect(corpo).toMatch(/modeloJaRespondeuAoContato\(pool, tenantId, leadId\)/);
    expect(corpo).toMatch(/primeiraRespostaDoModelo: !jaRespondeu/);
    expect(corpo).toMatch(/deferiuNoTurno: corposEnviados\.some\(\(corpo\) => defereAoAdvogado\(corpo\)\)/);
    expect(corpo).not.toMatch(/isFirstOutbound/);
  });

  it("turno de resposta sem TEXTO do cliente (mídia) vira null — só as proibições, sem entregar", () => {
    expect(FONTE_INBOUND).toContain("textoDoClienteNoTurno === '' ? null : textoDoClienteNoTurno");
  });

  it("send_template confere os VALORES (texto do modelo) com o mesmo contador de vetos", () => {
    const corpo = SEND_TEMPLATE();
    expect(corpo).toMatch(/motivosDosValoresDoTemplate\(values\)/);
    expect(corpo).toMatch(/travaOabVetoCount \+= 1/);
    expect(corpo).toMatch(/travaOabVetoCount < VETOS_ATE_ENTREGAR/);
    expect(corpo).not.toMatch(/travasOab:/); // o gate da cadeia segue desarmado para o texto fixo
  });

  it("follow-up determinístico e prévia NÃO armam o gate", () => {
    expect(lerFonte("lib/agent-engine/agent/followup-turn.ts")).not.toMatch(/travasOab/);
    expect(lerFonte("lib/agent-engine/agent/preview.ts")).not.toMatch(/travasOab/);
  });

  it("o 1º veto `trava_oab` do turno ensina; o 2º (ou o pedido de pessoa) entrega ao advogado, avisando o cliente antes", () => {
    const corpo = SEND_MESSAGE();
    const bloco = corpo.slice(corpo.indexOf("chain.code === CODIGO_TRAVA_OAB_PEDIU_HUMANO"));
    expect(bloco.slice(0, 1400)).toMatch(/travaOabVetoCount \+= 1/);
    expect(bloco.slice(0, 1400)).toMatch(/travaOabVetoCount < VETOS_ATE_ENTREGAR/);
    expect(bloco.slice(0, 1400)).toMatch(/await entregarAoAdvogadoPorTrava\(/);
    const entrega = FONTE_INBOUND.slice(
      FONTE_INBOUND.indexOf("const entregarAoAdvogadoPorTrava"),
      FONTE_INBOUND.indexOf("const entregarAoAdvogadoPorTrava") + 2800,
    );
    expect(entrega.indexOf("avisarLeadDaEscalacao(")).toBeGreaterThan(-1);
    expect(entrega.indexOf("avisarLeadDaEscalacao(")).toBeLessThan(entrega.indexOf("performHumanHandoff("));
    expect(entrega).toMatch(/passouParaAEquipe = true/);
    // O briefing diz o que de fato saiu, e o aviso do follow-up não fala em "sua mensagem".
    expect(entrega).toMatch(/desfechoDaTravaDaOab\(motivosEmPortugues, outcomes\.length\)/);
    expect(entrega).toMatch(/'advogado_vai_responder' : 'advogado_vai_assumir'/);
  });

  it("o aviso de escalação só ganha a frase de identificação nos dois motivos da trava", () => {
    const fonte = lerFonte("lib/agent-engine/agent/aviso-de-escalacao.ts");
    expect(fonte).toMatch(
      /opts\.motivo === 'advogado_vai_responder' \|\| opts\.motivo === 'advogado_vai_assumir'[\s\S]{0,200}comIdentificacaoSeForOPrimeiro\(pool, ids, body, idioma\)/,
    );
  });

  it("a recusa de identificação é contada, e a 3ª tentativa vai com `injetaIdentificacao`", () => {
    const corpo = SEND_MESSAGE();
    expect(corpo).toMatch(/chain\.code === CODIGO_TRAVA_OAB_IDENTIFICACAO/);
    expect(corpo).toMatch(/identificacaoOabVetoCount \+= 1/);
    expect(corpo).toMatch(/injetaIdentificacao: identificacaoOabVetoCount >= VETOS_ATE_INJETAR_IDENTIFICACAO/);
  });
});
