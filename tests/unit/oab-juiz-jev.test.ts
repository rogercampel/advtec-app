/**
 * A segunda camada das travas da OAB (`lib/ai/decisao/travas-oab.ts`) e o que o gate faz com o veredito.
 * Mutações (cada uma derruba o teste indicado; refeitas a cada mudança da regra):
 *   M1 tirar a soma dos vetos do Jev no gate -> "o veto do Jev soma".
 *   M2 tirar o desvio de `falhou` no gate -> "Jev sem resposta".
 *   M3 `observando` contar como decidindo -> "observando: nada sai para o fornecedor".
 *   M4 nota fora de [0,1] virar "passa" -> "nota fora de 0 a 1 é falha".
 *   M5 leitura da config que falha virar "não decide" -> "configuração ilegível fecha".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const decidirNoPonto = vi.fn();
vi.mock("@/lib/ai/decisao/ponto", () => ({ decidirNoPonto: (...a: unknown[]) => decidirNoPonto(...a) }));

import type { GateContext } from "@/lib/agent-engine/guardrails/before-send";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { SPINNING_DEFAULTS } from "@/lib/agent-engine/spinning/defaults";
import { criarJuizDaOab, julgaComJev } from "@/lib/ai/decisao/travas-oab";
import { CODIGO_TRAVA_OAB, CODIGO_TRAVA_OAB_SEM_CONFERENCIA, travasOabGate } from "@/lib/oab/gate-das-travas";

function ctx(body: string, juiz: NonNullable<GateContext["travasOab"]>["juiz"]): GateContext {
  return {
    now: new Date("2026-07-28T13:00:00Z"),
    body,
    optedOut: false,
    provider: "waha",
    pacing: { knobs: PACING_DEFAULTS, state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null }, crmDailyLimit: null, rng: () => 0 },
    spinning: { knobs: SPINNING_DEFAULTS, window: [] },
    promise: { table: null },
    semanticPromise: null,
    disclosure: { template: null, isFirstOutbound: false, mode: "inject" },
    lgpd: null,
    casesEnabled: false,
    hasOpenCase: false,
    openedCaseThisTurn: false,
    travasOab: {
      mensagemDoCliente: null,
      primeiraRespostaDoModelo: false,
      deferiuNoTurno: false,
      injetaIdentificacao: false,
      ...(juiz !== undefined ? { juiz } : {}),
    },
  };
}

// Frase que a trava por padrão deixa passar (scripts/corpus-oab-jev.json: 15 das 24 proibidas escapam dela).
const ESCAPA_DA_TRAVA = "Nesse tipo de situação a empresa sempre acaba pagando.";
const ALVO = { organizationId: "org", contactId: "c1", agentId: "a1" };

/** Admin falso: as linhas gravadas em `llm_calls`. */
function admin(linhas: Record<string, unknown>[] = []) {
  return { from: () => ({ insert: async (l: Record<string, unknown>) => (linhas.push(l), { error: null }) }) } as never;
}
/** Banco falso: a linha de `organizations` com os `settings`. */
const banco = (settings: unknown) => ({ query: async () => ({ rows: [{ settings }] }) }) as never;
const jev = (estado: string) => ({
  jev: { ligado: true, aceite: { em: "2026-10-25T10:00:00Z", por: "00000000-0000-4000-8000-000000000001" }, tarefas: { travas_oab: { estado } } },
});
const ok = (n: Record<string, number>) => ({
  ok: true,
  modelo: "jev-1.13.0",
  latenciaMs: 200,
  uso: { tokensDeEntrada: 600, tokensDeSaida: 3 },
  respostas: Object.fromEntries(Object.entries(n).map(([k, v]) => [k, { tipo: "noul", noul: v }])),
});
const LIMPO = { promete: 0.02, orienta: 0.03, merito: 0.01 };

beforeEach(() => decidirNoPonto.mockReset());

describe("o gate com o veredito do Jev", () => {
  it("o veto do Jev soma: a frase que escapa da trava por padrão é barrada", () => {
    expect(travasOabGate.evaluate(ctx(ESCAPA_DA_TRAVA, undefined)).pass).toBe(true);
    const v = travasOabGate.evaluate(ctx(ESCAPA_DA_TRAVA, { barra: ["promessa_de_resultado"] }));
    expect(v.pass).toBe(false);
    if (!v.pass) expect(v.code).toBe(CODIGO_TRAVA_OAB);
  });

  it("Jev sem resposta: nada sai e o código é o de entrega imediata", () => {
    const v = travasOabGate.evaluate(ctx("Olá! O advogado vai analisar o seu caso.", "falhou"));
    expect(v.pass).toBe(false);
    if (!v.pass) {
      expect(v.code).toBe(CODIGO_TRAVA_OAB_SEM_CONFERENCIA);
      expect(v.detail?.motivos).toBe("jev_sem_resposta");
    }
  });

  it("Jev que deixa passar não apaga o veto da trava por padrão", () => {
    expect(travasOabGate.evaluate(ctx("Você vai ganhar com certeza.", { barra: [] })).pass).toBe(false);
  });
});

describe("julgaComJev", () => {
  it("nota no limiar barra, com o motivo da pergunta, e grava o custo", async () => {
    const linhas: Record<string, unknown>[] = [];
    decidirNoPonto.mockResolvedValueOnce(ok({ promete: 0.5, orienta: 0.49, merito: 0.1 }));
    expect(await julgaComJev(admin(linhas), ALVO, "x")).toEqual({ barra: ["promessa_de_resultado"] });
    expect(linhas).toEqual([
      expect.objectContaining({
        organization_id: "org", contact_id: "c1", agent_id: "a1", purpose: "travas_oab", status: "ok",
        input_tokens: 600, output_tokens: 3, origem_da_escolha: "jev",
      }),
    ]);
  });

  it("falha do provedor é `falhou`, e vira linha de erro em Execuções", async () => {
    const linhas: Record<string, unknown>[] = [];
    decidirNoPonto.mockResolvedValueOnce({ ok: false, motivo: "sem_credencial", exigeAcao: false, defeitoNosso: false, status: null });
    expect(await julgaComJev(admin(linhas), ALVO, "x")).toBe("falhou");
    expect(linhas).toEqual([expect.objectContaining({ purpose: "travas_oab", status: "erro", error_code: "jev_sem_credencial" })]);
  });

  it("resposta incompleta ou nota fora de 0 a 1 é falha, nunca 'passa'", async () => {
    decidirNoPonto.mockResolvedValueOnce(ok({ promete: 0.1, orienta: 0.1 }));
    expect(await julgaComJev(admin(), ALVO, "x")).toBe("falhou");
    decidirNoPonto.mockResolvedValueOnce(ok({ promete: -0.2, orienta: 0.1, merito: 0.1 }));
    expect(await julgaComJev(admin(), ALVO, "x")).toBe("falhou");
  });

  it("o CPF e o telefone do cliente não saem para o fornecedor", async () => {
    decidirNoPonto.mockResolvedValueOnce(ok(LIMPO));
    await julgaComJev(admin(), ALVO, "Anotei seu CPF 123.456.789-09 e o telefone (11) 98765-4321.");
    const enviado = JSON.stringify(decidirNoPonto.mock.lastCall![0].estado);
    expect(enviado).not.toContain("123.456.789-09");
    expect(enviado).not.toContain("98765-4321");
  });
});

describe("criarJuizDaOab — o juiz do turno", () => {
  const sem = () => null;

  it("observando: nada sai para o fornecedor", async () => {
    const julgar = criarJuizDaOab(banco(jev("observando")), admin(), ALVO, sem);
    expect(await julgar(ESCAPA_DA_TRAVA)).toBeUndefined();
    expect(decidirNoPonto).not.toHaveBeenCalled();
  });

  it("configuração ilegível fecha: não pergunta e não deixa sair", async () => {
    const quebrado = { query: async () => { throw new Error("banco fora"); } } as never;
    expect(await criarJuizDaOab(quebrado, admin(), ALVO, sem)(ESCAPA_DA_TRAVA)).toBe("falhou");
    expect(decidirNoPonto).not.toHaveBeenCalled();
  });

  it("decidindo: pergunta uma vez por corpo (os re-runs da cadeia reaproveitam)", async () => {
    decidirNoPonto.mockResolvedValue(ok({ ...LIMPO, promete: 0.9 }));
    const julgar = criarJuizDaOab(banco(jev("decidindo")), admin(), ALVO, sem);
    expect(await julgar(ESCAPA_DA_TRAVA)).toEqual({ barra: ["promessa_de_resultado"] });
    await julgar(ESCAPA_DA_TRAVA);
    expect(decidirNoPonto).toHaveBeenCalledTimes(1);
  });

  it("não pergunta o que já sai barrado: trava por padrão pegou, ou o cliente pediu uma pessoa", async () => {
    const julgar = criarJuizDaOab(banco(jev("decidindo")), admin(), ALVO, () => "quero falar com um advogado");
    expect(await julgar("Você vai ganhar com certeza.")).toBeUndefined();
    expect(await julgar("Claro, já vou te ajudar com isso.")).toBeUndefined();
    expect(decidirNoPonto).not.toHaveBeenCalled();
  });
});
