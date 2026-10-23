import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as Queue from "@/lib/agent-engine/queue/queue";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";

/**
 * AS TRAVAS DA OAB NO TURNO REAL, CONTRA POSTGRES DE VERDADE.
 *
 * Spec 0001, E2/E3: "Ao disparar qualquer trava: não responde por conta própria, marca a
 * conversa e entrega para o advogado." e "Nenhuma conversa real antes desta etapa."
 * `lib/oab/travas.ts` existia e só a resposta de andamento do DJEN o chamava; o agente
 * que fala com o cliente não. Este arquivo prova a ligação no turno inteiro: modelo
 * roteirizado, canal que CAPTURA, `createInboundTurnHandler` real.
 *
 * Molde: `handoff-avisa-o-lead.test.ts` (a ordem aviso -> passagem) e
 * `limite-de-envios-por-turno.test.ts` (modelo que chama `send_message`).
 *
 * MUTAÇÕES: NÃO foram feitas contra este arquivo (o Docker caiu no meio da rodada). A
 * cobertura por mutação das mesmas regras está em `tests/unit/gate-das-travas-oab.test.ts`
 * (fiação do turno e gate). Quem refizer: apagar o bloco `chain.code === CODIGO_TRAVA_OAB` do
 * inbound-turn, trocar o padrão da camada para `false`, tirar o aviso de
 * `entregarAoAdvogadoPorTrava`, e tirar `trava_da_oab` do CHECK do baseline — cada uma deve
 * deixar um caso daqui vermelho.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "placeholder-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service";

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "ffff0000-0000-4000-8000-000000000001";
const CONTACT = "ffff0000-0000-4000-8000-000000000002";
const SESSION = "ffff0000-0000-4000-8000-000000000003";
const CONV = "ffff0000-0000-4000-8000-000000000004";

type Modules = {
  createInboundTurnHandler: typeof InboundTurn.createInboundTurnHandler;
  queue: typeof Queue;
  createLogger: typeof ObsLogger.createLogger;
  createFakeRegistry: typeof Providers.createFakeRegistry;
};
let m: Modules;

interface EnvioCapturado {
  body: string;
  /** `contacts.force_human` NO INSTANTE do envio — a ordem aviso -> passagem. */
  forceHumanNoEnvio: boolean;
}
let enviados: EnvioCapturado[] = [];
/** Todo resultado de tool que o modelo VIU. */
let resultadosVistos: string[] = [];

const CHECKPOINT = JSON.stringify({
  commitments: [],
  objections: [],
  next_action: null,
  rolling_summary: "turno de teste",
});
const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** O modelo manda, em ordem, cada corpo do roteiro com `send_message`; depois encerra. */
function modeloQueManda(roteiro: string[]) {
  let i = 0;
  return async (opts: { prompt?: unknown }) => {
    const msgs = (opts.prompt ?? []) as Array<{ role: string; content?: unknown }>;
    for (const msg of msgs) {
      if (!Array.isArray(msg.content)) continue;
      for (const parte of msg.content as Array<Record<string, unknown>>) {
        if (parte.type === "tool-result") resultadosVistos.push(JSON.stringify(parte.output ?? parte));
      }
    }
    if (i < roteiro.length) {
      const body = roteiro[i]!;
      i += 1;
      return {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: `c${i}`,
            toolName: "send_message",
            input: JSON.stringify({ body }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: USO,
        warnings: [],
      };
    }
    return {
      content: [{ type: "text" as const, text: CHECKPOINT }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: USO,
      warnings: [],
    };
  };
}

function montaHandler(doGenerate: unknown) {
  return m.createInboundTurnHandler({
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: "fake" } as never,
    knobs: {
      historyLimit: 10,
      maxContextTokens: 1000,
      notesIndexMaxTokens: 500,
      maxSteps: 12,
      queuedRetryDelayMs: 1000,
      breaker: {
        exactFailureWarn: 2,
        exactFailureBlock: 5,
        sameToolFailureWarn: 3,
        sameToolFailureHalt: 8,
        noProgressWarn: 3,
        noProgressBlock: 5,
      },
    },
    log: m.createLogger(),
    registry: m.createFakeRegistry(doGenerate as never),
    channel: () =>
      ({
        channel: "captura",
        send: async (i: { body: string }) => {
          const { rows } = await pool.query<{ force_human: boolean }>(
            "select force_human from contacts where id = $1",
            [CONTACT],
          );
          enviados.push({ body: i.body, forceHumanNoEnvio: rows[0]?.force_human === true });
          return {
            kind: "sent" as const,
            idempotencyKey: `k${enviados.length}`,
            messageId: `m${enviados.length}`,
          };
        },
        sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: "BRL", cents: 0 }),
      }) as never,
    // Terça, 15h BRT: dentro da janela anti-ban (7h-22h), senão o `pacing` veta por horário.
    clock: () => new Date("2026-07-28T18:00:00Z"),
    sleep: async () => {},
  });
}

/** Grava um inbound e roda UM turno completo por cima dele. */
async function rodaTurno(textoDoCliente: string, roteiro: string[]): Promise<void> {
  const msgId = crypto.randomUUID();
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via, sent_at)
     values ($1,$2,$3,$4,$5,'text','inbound','delivered',$6,'external_device', now())`,
    [msgId, ORG, CONV, SESSION, CONTACT, textoDoCliente],
  );
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const { job } = await m.queue.enqueueJob(pool, ORG, {
    kind: "inbound_turn",
    leadId: CONTACT,
    payload: {
      conversation_id: CONV,
      contact_id: CONTACT,
      channel_session_id: SESSION,
      inbound_message_id: msgId,
      crm_event_id: crypto.randomUUID(),
    },
    maxAttempts: 1,
  });
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "travas-oab", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await montaHandler(modeloQueManda(roteiro))(claimed!, pool, { workerId: "travas-oab" });
    await m.queue.completeJob(pool, claimed!.id, "travas-oab");
  } catch (err) {
    await m.queue.failJob(pool, claimed!.id, "travas-oab", err);
    throw err;
  }
}

async function forceHuman(): Promise<boolean> {
  const { rows } = await pool.query<{ force_human: boolean }>(
    "select force_human from contacts where id = $1",
    [CONTACT],
  );
  return rows[0]!.force_human;
}

beforeAll(async () => {
  m = {
    createInboundTurnHandler: (await import("@/lib/agent-engine/agent/inbound-turn"))
      .createInboundTurnHandler,
    queue: await import("@/lib/agent-engine/queue/queue"),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
  };

  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1,'travas-oab','Travas OAB','Travas OAB') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,'travas-oab-session','WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await pool.query(
    `with v as (
       insert into playbook_versions (organization_id, layer, content)
       select null, 'platform', E'## Identidade\nAssistente de teste.'
       where not exists (select 1 from playbook_pointers where organization_id is null and layer = 'platform')
       returning id)
     insert into playbook_pointers (organization_id, layer, version_id)
     select null, 'platform', id from v`,
  );
});

beforeEach(async () => {
  enviados = [];
  resultadosVistos = [];
  // Estado limpo: `force_human` é irrevogável em produção — um caso herdando a trava do
  // anterior mediria o turno pulado, não a trava da OAB.
  await pool.query("delete from passagens_de_atendimento where organization_id = $1", [ORG]);
  await pool.query("delete from org_guardrail_layers where organization_id = $1", [ORG]);
  await pool.query("delete from messages where organization_id = $1", [ORG]);
  await pool.query("delete from send_ledger where organization_id = $1", [ORG]);
  await pool.query("delete from outbound_copies where organization_id = $1", [ORG]);
  await pool.query("delete from agent_inbox_items where organization_id = $1", [ORG]);
  await pool.query("delete from conversations where organization_id = $1", [ORG]);
  await pool.query("delete from contacts where organization_id = $1", [ORG]);
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number, force_human)
     values ($1,$2,'Cliente do escritório','+5511900000555', false)`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false)`,
    [CONV, ORG, CONTACT, SESSION],
  );
});

const PROMESSA = "Sou o assistente virtual do escritório. Você vai ganhar com certeza.";
const LIMPA =
  "Sou o assistente virtual do escritório, um atendimento automatizado. Pode me contar o que aconteceu?";

describe("o modelo promete resultado -> a conversa vai ao advogado", () => {
  it("nada sai ao cliente além do aviso, e a promessa nunca chega ao canal", async () => {
    await rodaTurno("Bom dia, fui demitido sem justa causa", [PROMESSA]);

    expect(
      enviados.map((e) => e.body).filter((b) => /ganhar|certeza/i.test(b)),
      "a promessa de resultado SAIU ao cliente",
    ).toEqual([]);
    expect(enviados, "o cliente recebe UM aviso, e só").toHaveLength(1);
    expect(enviados[0]!.body).toMatch(/advogado/i);
    // A ordem do molde: avisa e só então arma a trava.
    expect(enviados[0]!.forceHumanNoEnvio, "avisou depois de armar a trava que veta o aviso").toBe(false);
  });

  it("contacts.force_human fica true e a conversa volta à fila humana", async () => {
    await rodaTurno("Bom dia, fui demitido sem justa causa", [PROMESSA]);

    expect(await forceHuman(), "a conversa não foi entregue ao advogado").toBe(true);
    const { rows } = await pool.query<{ status: string; silencio: string | null; motivo: string | null }>(
      `select status, bot_silenced_until::text as silencio, last_handoff_reason as motivo
         from conversations where id = $1`,
      [CONV],
    );
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.silencio).toBe("infinity");
    expect(rows[0]!.motivo).toBe("trava_da_oab");
  });

  it("a passagem é registrada com o motivo e a origem novos, sem o texto barrado", async () => {
    await rodaTurno("Bom dia, fui demitido sem justa causa", [PROMESSA]);

    const { rows } = await pool.query<{
      origem: string;
      motivo_codigo: string;
      body: string;
      cliente_avisado: boolean | null;
    }>(
      `select origem, motivo_codigo, body, cliente_avisado
         from passagens_de_atendimento where organization_id = $1 and conversation_id = $2`,
      [ORG, CONV],
    );
    expect(rows, "a passagem não foi registrada (CHECK do banco sem o valor novo?)").toHaveLength(1);
    expect(rows[0]!.motivo_codigo).toBe("trava_da_oab");
    expect(rows[0]!.origem).toBe("trava_de_saida");
    expect(rows[0]!.cliente_avisado).toBe(true);
    // Quem assume lê POR QUE: o rótulo da trava, não o rascunho nem um código cru.
    expect(rows[0]!.body).toMatch(/promessa de resultado/);
    expect(rows[0]!.body).not.toMatch(/com certeza/);
  });

  it("o modelo recebe o aviso de que a conversa foi entregue e não tenta de novo", async () => {
    // O roteiro tem uma 2ª promessa: se o veto fosse retentável, o modelo a mandaria.
    await rodaTurno("Bom dia, fui demitido sem justa causa", [PROMESSA, PROMESSA + " Garanto."]);

    const vistos = resultadosVistos.join("\n");
    expect(vistos).toMatch(/entregue ao advogado/);
    expect(vistos).toMatch(/encerre o turno/);
    expect(enviados.filter((e) => /certeza|Garanto/i.test(e.body))).toEqual([]);
  });
});

describe("o desfecho legítimo continua saindo", () => {
  it("controle: resposta limpa, que se identifica, sai e não passa a conversa", async () => {
    await rodaTurno("Bom dia, fui demitido sem justa causa", [LIMPA]);

    expect(enviados.map((e) => e.body)).toEqual([LIMPA]);
    expect(await forceHuman(), "resposta legítima virou passagem — o teste mediu outra coisa").toBe(false);
  });

  it("pergunta de mérito respondida deferindo ao advogado sai (e não vira passagem)", async () => {
    const defere =
      "Sou o assistente virtual do escritório, um atendimento automatizado. Essa análise é do advogado; vou passar o seu caso hoje.";
    await rodaTurno("Eu ganho essa causa?", [defere]);

    expect(enviados.map((e) => e.body)).toEqual([defere]);
    expect(await forceHuman()).toBe(false);
  });

  it("pergunta de mérito respondida com opinião vai ao advogado", async () => {
    await rodaTurno("Eu ganho essa causa?", [
      "Sou o assistente virtual do escritório, um atendimento automatizado. Pelo que você contou, a chance é boa.",
    ]);

    expect(enviados, "só o aviso").toHaveLength(1);
    expect(enviados[0]!.body).toMatch(/advogado/i);
    expect(await forceHuman()).toBe(true);
  });
});

describe("resposta a mensagem sem texto (mídia)", () => {
  it("houve entrada do cliente: a resposta limpa sai, e a promessa continua barrada", async () => {
    await rodaTurno("", [LIMPA]);
    expect(enviados.map((e) => e.body)).toEqual([LIMPA]);
    expect(await forceHuman(), "mídia sem texto virou 'sem mensagem' e foi ao advogado").toBe(false);

    await pool.query("delete from send_ledger where organization_id = $1", [ORG]);
    await rodaTurno("", [PROMESSA]);
    expect(enviados.map((e) => e.body).filter((b) => /certeza/.test(b))).toEqual([]);
    expect(await forceHuman()).toBe(true);
  });
});

describe("a identificação da 1ª resposta é retentável", () => {
  it("sem se identificar: o modelo é ensinado a reescrever, reescreve, e a conversa NÃO vai ao advogado", async () => {
    await rodaTurno("Bom dia, preciso de ajuda", ["Olá! Como posso ajudar?", LIMPA]);

    expect(resultadosVistos.join("\n")).toMatch(/trava_oab_identificacao/);
    expect(enviados.map((e) => e.body)).toEqual([LIMPA]);
    expect(await forceHuman(), "falta de identificação virou passagem: deveria ser retentável").toBe(false);
  });
});

describe("a camada é escolha da organização", () => {
  it("padrão (sem linha) é LIGADA — já coberto acima; com a linha desligada, o corpo sai", async () => {
    await pool.query(
      `insert into org_guardrail_layers (organization_id, layer, enabled) values ($1,'travas_oab',false)`,
      [ORG],
    );
    await rodaTurno("Bom dia, fui demitido sem justa causa", [PROMESSA]);

    expect(enviados.map((e) => e.body)).toEqual([PROMESSA]);
    expect(await forceHuman()).toBe(false);
  });
});
