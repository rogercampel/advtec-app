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
import { seIdentificaComoMaquina } from "@/lib/oab/travas";
import {
  CODIGO_TRAVA_OAB,
  CODIGO_TRAVA_OAB_IDENTIFICACAO,
  motivosDoTrace,
  travasOabGate,
} from "@/lib/oab/gate-das-travas";

/**
 * MUTAÇÕES FEITAS em 23/10/2026. Em cada uma a regra foi apagada, o(s) teste(s) citado(s)
 * acusaram, e a regra voltou:
 *   1. gate: `armado === undefined` -> no-op removido: "campo ausente é no-op" e "a cadeia
 *      sem o campo envia o MESMO corpo" vermelhos.
 *   2. gate: ramo `mensagemDoCliente === null` desligado: "follow-up (null) só confere as
 *      proibições" vermelho.
 *   3. gate: ramo do veto retentável de identificação removido: 3 vermelhos (1ª resposta sem
 *      identificação, template contido, contraste na cadeia).
 *   4. gate: `detail` passou a levar o corpo: "o detail leva só rótulos" vermelho.
 *   5. before-send: `travasOabGate` movido para ANTES do `disclosureGate`: 6 vermelhos, entre
 *      eles "fica DEPOIS do disclosure" e "é o ÚLTIMO".
 *   6. gate: tratamento de `motivos: []` (pediu_humano/sem_mensagem) removido: vermelho.
 *   7. gate: template contido no corpo deixa de contar como identificação: vermelho.
 *   8. travas.ts: artigo "o"/"a" fora da regra de identificação: 3 vermelhos (inclui
 *      oab-travas.test.ts).
 *   9. inbound-turn: `camadaLigada(camadas.travas_oab, true)` -> `false`: "a fiação" vermelho.
 *  10. inbound-turn: texto vazio deixa de virar `null`: "turno de resposta sem TEXTO" vermelho.
 * O turno inteiro contra Postgres: `tests/invariants/travas-da-oab-no-turno.test.ts`.
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
        travasOab: { mensagemDoCliente: "Oi, preciso de ajuda com uma rescisão" },
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
    expect(v.detail?.motivos).toMatch(/promessa_de_resultado/);
  });

  it("pergunta de mérito + resposta que opina -> trava_oab (pergunta_de_merito)", () => {
    const v = veto(
      baseCtx({
        body: "Pelo que você contou, a chance é boa.",
        travasOab: { mensagemDoCliente: "Eu ganho essa causa?" },
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
    expect(v.detail?.motivos).toBe("pergunta_de_merito");
  });

  it("pergunta de mérito + resposta que defere ao advogado -> passa", () => {
    const v = travasOabGate.evaluate(
      baseCtx({
        body: "Essa análise é do advogado; vou passar o seu caso hoje.",
        travasOab: { mensagemDoCliente: "Eu ganho essa causa?" },
      }),
    );
    expect(v.pass).toBe(true);
  });

  it("deferir não dá licença para prometer na mesma frase", () => {
    const v = veto(
      baseCtx({
        body: "O advogado vai avaliar, mas garanto que você vai ganhar.",
        travasOab: { mensagemDoCliente: "Eu ganho essa causa?" },
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
  });

  it("pedido de humano e mensagem vazia entregam, com motivo próprio no detail", () => {
    // `decideResposta` devolve `motivos: []` nos dois casos; sem tratar, o trace
    // registraria um veto sem motivo nenhum.
    const humano = veto(
      baseCtx({
        body: "Claro, já vou ajudar!",
        travasOab: { mensagemDoCliente: "quero falar com um advogado" },
      }),
    );
    expect(humano.code).toBe(CODIGO_TRAVA_OAB);
    expect(humano.detail?.motivos).toBe("pediu_humano");

    const vazia = veto(baseCtx({ body: "Olá!", travasOab: { mensagemDoCliente: "   " } }));
    expect(vazia.code).toBe(CODIGO_TRAVA_OAB);
    expect(vazia.detail?.motivos).toBe("sem_mensagem");
  });

  it("resposta limpa a uma mensagem comum passa", () => {
    const v = travasOabGate.evaluate(
      baseCtx({
        body: "Posso anotar o seu nome completo e o assunto?",
        travasOab: { mensagemDoCliente: "Bom dia, preciso de ajuda" },
      }),
    );
    expect(v.pass).toBe(true);
  });
});

describe("travasOabGate — a identificação da 1ª resposta é retentável", () => {
  const primeira = { template: null, isFirstOutbound: true, mode: "inject" as const };

  it("1ª resposta sem se declarar atendimento automatizado -> trava_oab_identificacao", () => {
    const v = veto(
      baseCtx({
        disclosure: primeira,
        body: "Olá! Como posso ajudar?",
        travasOab: { mensagemDoCliente: "Bom dia, preciso de ajuda" },
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB_IDENTIFICACAO);
    // É instrução ao modelo: precisa dizer o que escrever, não só o que está errado.
    expect(v.reason).toMatch(/automatizado/);
    expect(v.reason).toMatch(/Reescreva/);
  });

  it("a mesma 1ª resposta, agora se identificando -> passa", () => {
    const v = travasOabGate.evaluate(
      baseCtx({
        disclosure: primeira,
        body: `Olá! ${IDENTIFICACAO} Como posso ajudar?`,
        travasOab: { mensagemDoCliente: "Bom dia, preciso de ajuda" },
      }),
    );
    expect(v.pass).toBe(true);
  });

  it("identificação faltando + outra violação -> trava_oab (não é retentável)", () => {
    // Reescrever só a apresentação deixaria a promessa passar à tentativa seguinte.
    const v = veto(
      baseCtx({
        disclosure: primeira,
        body: "Olá! Você vai ganhar com certeza.",
        travasOab: { mensagemDoCliente: "Bom dia" },
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
    expect(v.detail?.motivos).toMatch(/promessa_de_resultado/);
    expect(v.detail?.motivos).toMatch(/sem_identificacao_de_maquina/);
  });

  it("o template de apresentação da organização, contido no corpo, conta como identificação", () => {
    // Um template que NÃO casa o regex de `seIdentificaComoMaquina` vetaria toda 1ª mensagem
    // em loop: o disclosure o injeta, o gate o rejeita, o modelo não tem como consertá-lo.
    const template = "Bem-vindo ao Escritório Silva! Este canal é de atendimento inicial.";
    const corpo = `${template}

Como posso ajudar?`;
    const travasOab = { mensagemDoCliente: "Bom dia, preciso de ajuda" };
    expect(seIdentificaComoMaquina(template)).toBe(false); // controle: o template não casa
    expect(
      travasOabGate.evaluate(
        baseCtx({ disclosure: { template, isFirstOutbound: true, mode: "inject" }, body: corpo, travasOab }),
      ).pass,
    ).toBe(true);
    // Contraste: o mesmo corpo, sem o template configurado, é vetado pela identificação.
    expect(
      veto(baseCtx({ disclosure: { template: null, isFirstOutbound: true, mode: "inject" }, body: corpo, travasOab })).code,
    ).toBe(CODIGO_TRAVA_OAB_IDENTIFICACAO);
    // E com template configurado mas AUSENTE do corpo, continua vetando.
    expect(
      veto(
        baseCtx({
          disclosure: { template, isFirstOutbound: true, mode: "inject" },
          body: "Olá! Como posso ajudar?",
          travasOab,
        }),
      ).code,
    ).toBe(CODIGO_TRAVA_OAB_IDENTIFICACAO);
  });

  it("o template contido não dá licença para prometer", () => {
    const template = "Bem-vindo ao Escritório Silva! Este canal é de atendimento inicial.";
    const v = veto(
      baseCtx({
        disclosure: { template, isFirstOutbound: true, mode: "inject" },
        body: `${template} Você vai ganhar com certeza.`,
        travasOab: { mensagemDoCliente: "Bom dia" },
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
  });

  it("a partir da 2ª resposta a identificação não é cobrada", () => {
    const v = travasOabGate.evaluate(
      baseCtx({
        body: "Posso anotar o seu nome completo?",
        travasOab: { mensagemDoCliente: "Bom dia" },
      }),
    );
    expect(v.pass).toBe(true);
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
          travasOab: { mensagemDoCliente: null },
        }),
      ).pass,
    ).toBe(true);
    // ...mas a promessa continua barrada.
    const v = veto(
      baseCtx({
        body: "Bom dia! Lembrando que você vai ganhar o processo.",
        travasOab: { mensagemDoCliente: null },
      }),
    );
    expect(v.code).toBe(CODIGO_TRAVA_OAB);
    expect(v.detail?.motivos).toMatch(/promessa_de_resultado/);
  });

  it("o detail leva só rótulos — nunca o trecho, o valor nem o nome do caso", () => {
    const v = veto(
      baseCtx({
        body: "João, garanto que você vai receber R$ 30 mil na ação trabalhista.",
        travasOab: { mensagemDoCliente: "Oi" },
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

describe("travasOabGate — na cadeia real", () => {
  const TEMPLATE = "Sou o assistente virtual do Escritório Silva, um atendimento automatizado.";

  it("fica DEPOIS do disclosure: a apresentação injetada é vista (1ª mensagem passa)", () => {
    const nomes = BEFORE_SEND_GATES.map((g) => g.name);
    expect(nomes.indexOf("travas_oab")).toBeGreaterThan(nomes.indexOf("disclosure"));

    const r = evaluateBeforeSend(
      baseCtx({
        body: "Olá! Como posso ajudar?",
        disclosure: { template: TEMPLATE, isFirstOutbound: true, mode: "inject" },
        travasOab: { mensagemDoCliente: "Bom dia, preciso de ajuda" },
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
        travasOab: { mensagemDoCliente: "Bom dia, preciso de ajuda" },
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
        travasOab: { mensagemDoCliente: "Bom dia" },
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
      ...(args.armado ? { travasOab: { mensagemDoCliente: "Oi, tudo bem?" } } : {}),
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
  it("send_message arma pela camada da organização, com padrão LIGADO", () => {
    expect(corpoDoExecute("send_message: tool({", "update_lead_state: tool({")).toMatch(
      /camadaLigada\(camadas\.travas_oab,\s*true\)/,
    );
  });

  it("send_message só arma a mensagem do cliente no turno de resposta", () => {
    const corpo = corpoDoExecute("send_message: tool({", "update_lead_state: tool({");
    expect(corpo).toMatch(/eTurnoDeResposta\(liveJob\(\)\) \? mensagemDoClienteNoTurno : null/);
  });

  it("turno de resposta sem TEXTO do cliente (mídia) vira null — só as proibições, sem entregar", () => {
    expect(FONTE_INBOUND).toContain("textoDoClienteNoTurno === '' ? null : textoDoClienteNoTurno");
  });

  it("send_template, follow-up e prévia NÃO armam", () => {
    expect(corpoDoExecute("send_template: tool({", "search_knowledge: tool({")).not.toMatch(/travasOab/);
    expect(lerFonte("lib/agent-engine/agent/followup-turn.ts")).not.toMatch(/travasOab/);
    expect(lerFonte("lib/agent-engine/agent/preview.ts")).not.toMatch(/travasOab/);
  });

  it("o veto `trava_oab` NÃO é retentável: entrega ao advogado, avisando o cliente antes", () => {
    const corpo = corpoDoExecute("send_message: tool({", "update_lead_state: tool({");
    const bloco = corpo.slice(corpo.indexOf("chain.code === CODIGO_TRAVA_OAB"));
    expect(bloco.slice(0, 400)).toMatch(/await entregarAoAdvogadoPorTrava\(/);
    // E a identificação segue o caminho normal de erro retentável (nenhum desvio dela).
    expect(FONTE_INBOUND).not.toMatch(/CODIGO_TRAVA_OAB_IDENTIFICACAO/);
    const entrega = FONTE_INBOUND.slice(
      FONTE_INBOUND.indexOf("const entregarAoAdvogadoPorTrava"),
      FONTE_INBOUND.indexOf("const entregarAoAdvogadoPorTrava") + 2500,
    );
    expect(entrega.indexOf("avisarLeadDaEscalacao(")).toBeGreaterThan(-1);
    expect(entrega.indexOf("avisarLeadDaEscalacao(")).toBeLessThan(entrega.indexOf("performHumanHandoff("));
    expect(entrega).toMatch(/passouParaAEquipe = true/);
  });
});
