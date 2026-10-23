import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as Queue from "@/lib/agent-engine/queue/queue";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";

/**
 * A TRIAGEM JURÍDICA NO TURNO REAL, CONTRA POSTGRES DE VERDADE (spec 0001.E3, #10 parte 3).
 *
 * `lib/triagem/` existia como peças soltas. Aqui se prova a ligação no `createInboundTurnHandler` real,
 * com modelo roteirizado e canal que CAPTURA:
 *   - URGÊNCIA descrita pelo cliente -> passagem ao advogado ANTES do modelo (zero chamadas), item
 *     crítico na Central, aviso ao cliente;
 *   - ÁREA recusada -> só o texto de recusa sai, e o cliente não é passado ao advogado;
 *   - CONFLITO -> passagem + aviso GENÉRICO: o cliente nunca ouve "conflito";
 *   - `seguir` -> o modelo continua e fala com o cliente;
 *   - camada `triagem_juridica` desligada -> nada disso acontece.
 *
 * Molde: `travas-da-oab-no-turno.test.ts`.
 *
 * MUTAÇÕES: NÃO foram feitas contra este arquivo (o Docker estava fora quando foi escrito). Quem
 * rodar `pnpm test:db` pela primeira vez deve, ao verde, aplicar uma a uma e ver o caso citado
 * acusar: (1) apagar o bloco "URGÊNCIA JURÍDICA" do inbound-turn -> "urgência… zero chamadas";
 * (2) trocar o padrão da camada para `false` -> todos os casos de desvio; (3) tirar o `entregar`
 * do ramo `passar_ao_advogado` de `desvioDaTriagem` -> "conflito…"; (4) trocar o aviso do conflito
 * por `urgencia_juridica`/texto com a palavra conflito -> "o cliente nunca ouve conflito";
 * (5) tirar `urgencia_juridica` do CHECK do baseline -> "a passagem… registrada".
 * As mesmas regras têm mutação em `tests/unit/triagem-no-turno.test.ts` (parte pura e fiação).
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

const ORG = "aaaa0000-0000-4000-8000-000000000001";
const CONTACT = "aaaa0000-0000-4000-8000-000000000002";
const SESSION = "aaaa0000-0000-4000-8000-000000000003";
const CONV = "aaaa0000-0000-4000-8000-000000000004";
const PIPE = "aaaa0000-0000-4000-8000-000000000005";
const STAGE = "aaaa0000-0000-4000-8000-000000000006";
const OUTRO_CLIENTE = "aaaa0000-0000-4000-8000-000000000007";

type Modules = {
  createInboundTurnHandler: typeof InboundTurn.createInboundTurnHandler;
  queue: typeof Queue;
  createLogger: typeof ObsLogger.createLogger;
  createFakeRegistry: typeof Providers.createFakeRegistry;
};
let m: Modules;

interface EnvioCapturado {
  body: string;
  forceHumanNoEnvio: boolean;
}
let enviados: EnvioCapturado[] = [];
let resultadosVistos: string[] = [];
let modeloChamado = 0;

const CHECKPOINT = JSON.stringify({ commitments: [], objections: [], next_action: null, rolling_summary: "turno de teste" });
const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

type Passo = { tool: string; input: Record<string, unknown> };

/** O modelo executa os passos em ordem (uma chamada de tool por passo) e encerra com o checkpoint. */
function modeloQueChama(passos: Passo[]) {
  let i = 0;
  return async (opts: { prompt?: unknown }) => {
    modeloChamado += 1;
    const msgs = (opts.prompt ?? []) as Array<{ role: string; content?: unknown }>;
    for (const msg of msgs) {
      if (!Array.isArray(msg.content)) continue;
      for (const parte of msg.content as Array<Record<string, unknown>>) {
        if (parte.type === "tool-result") resultadosVistos.push(JSON.stringify(parte.output ?? parte));
      }
    }
    if (i < passos.length) {
      const p = passos[i]!;
      i += 1;
      return {
        content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: p.tool, input: JSON.stringify(p.input) }],
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
          const { rows } = await pool.query<{ force_human: boolean }>("select force_human from contacts where id = $1", [CONTACT]);
          enviados.push({ body: i.body, forceHumanNoEnvio: rows[0]?.force_human === true });
          return { kind: "sent" as const, idempotencyKey: `k${enviados.length}`, messageId: `m${enviados.length}` };
        },
        sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: "BRL", cents: 0 }),
      }) as never,
    // Terça, 15h BRT: dentro da janela anti-ban.
    clock: () => new Date("2026-07-28T18:00:00Z"),
    sleep: async () => {},
  });
}

async function rodaTurno(textoDoCliente: string, passos: Passo[]): Promise<void> {
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
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "triagem", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await montaHandler(modeloQueChama(passos))(claimed!, pool, { workerId: "triagem" });
    await m.queue.completeJob(pool, claimed!.id, "triagem");
  } catch (err) {
    await m.queue.failJob(pool, claimed!.id, "triagem", err);
    throw err;
  }
}

async function forceHuman(): Promise<boolean> {
  const { rows } = await pool.query<{ force_human: boolean }>("select force_human from contacts where id = $1", [CONTACT]);
  return rows[0]!.force_human;
}

async function passagens() {
  const { rows } = await pool.query<{ origem: string; motivo_codigo: string; body: string; cliente_avisado: boolean | null }>(
    `select origem, motivo_codigo, body, cliente_avisado
       from passagens_de_atendimento where organization_id = $1 and conversation_id = $2`,
    [ORG, CONV],
  );
  return rows;
}

beforeAll(async () => {
  m = {
    createInboundTurnHandler: (await import("@/lib/agent-engine/agent/inbound-turn")).createInboundTurnHandler,
    queue: await import("@/lib/agent-engine/queue/queue"),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
  };

  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name, settings)
     values ($1,'triagem-turno','Triagem Turno','Triagem Turno',
       '{"triagem":{"areas_atendidas":["trabalhista"],"areas_recusadas":["criminal"]}}'::jsonb)
     on conflict (id) do update set settings = excluded.settings`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,'triagem-turno-session','WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await pool.query("insert into crm_pipelines(id,organization_id,name,slug) values($1,$2,'Casos',$1::text) on conflict (id) do nothing", [PIPE, ORG]);
  await pool.query(
    "insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values($1,$2,$3,'Novo','novo',1) on conflict (id) do nothing",
    [STAGE, ORG, PIPE],
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
  modeloChamado = 0;
  await pool.query("delete from passagens_de_atendimento where organization_id = $1", [ORG]);
  await pool.query("delete from org_guardrail_layers where organization_id = $1", [ORG]);
  await pool.query("delete from messages where organization_id = $1", [ORG]);
  await pool.query("delete from send_ledger where organization_id = $1", [ORG]);
  await pool.query("delete from outbound_copies where organization_id = $1", [ORG]);
  await pool.query("delete from agent_inbox_items where organization_id = $1", [ORG]);
  await pool.query("delete from crm_lead_activities where organization_id = $1", [ORG]);
  await pool.query("delete from crm_leads where organization_id = $1", [ORG]);
  await pool.query("delete from conversations where organization_id = $1", [ORG]);
  await pool.query("delete from contacts where organization_id = $1", [ORG]);
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number, force_human)
     values ($1,$2,'Cliente do escritório','+5511900000666', false)`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false)`,
    [CONV, ORG, CONTACT, SESSION],
  );
  // O caso aberto do cliente do turno (onde a triagem grava) e OUTRO cliente do escritório,
  // para o cenário de conflito.
  await pool.query(
    `insert into crm_leads(id,organization_id,pipeline_id,stage_id,contact_id,title,custom_fields)
     values (gen_random_uuid(),$1,$2,$3,$4,'Caso','{}'::jsonb)`,
    [ORG, PIPE, STAGE, CONTACT],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number) values ($1,$2,'Fulano de Tal Silva','+5511900000777')`,
    [OUTRO_CLIENTE, ORG],
  );
  await pool.query(
    `insert into crm_leads(id,organization_id,pipeline_id,stage_id,contact_id,title,custom_fields)
     values (gen_random_uuid(),$1,$2,$3,$4,'Caso do outro','{}'::jsonb)`,
    [ORG, PIPE, STAGE, OUTRO_CLIENTE],
  );
});

const IDENTIFICACAO = "Sou o assistente virtual do escritório, um atendimento automatizado.";

describe("urgência descrita pelo cliente -> advogado avisado antes do modelo", () => {
  const AUDIENCIA = "Minha audiência é amanhã de manhã e eu não tenho advogado";

  it("zero chamadas ao modelo; o cliente recebe só o aviso, enviado ANTES de a trava ser armada", async () => {
    await rodaTurno(AUDIENCIA, []);

    expect(modeloChamado, "o desvio passou a chamar o modelo").toBe(0);
    expect(enviados, "só o aviso").toHaveLength(1);
    expect(enviados[0]!.body).toMatch(/advogado/i);
    expect(enviados[0]!.forceHumanNoEnvio, "avisou depois de armar a trava").toBe(false);
    expect(await forceHuman()).toBe(true);
  });

  it("a passagem tem o motivo e a origem novos, e o trecho do cliente vai para quem assume", async () => {
    await rodaTurno(AUDIENCIA, []);

    const rows = await passagens();
    expect(rows, "passagem não registrada (CHECK do banco sem o valor novo?)").toHaveLength(1);
    expect(rows[0]!.motivo_codigo).toBe("urgencia_juridica");
    expect(rows[0]!.origem).toBe("triagem_juridica");
    expect(rows[0]!.cliente_avisado).toBe(true);
    expect(rows[0]!.body).toMatch(/audiência é amanhã/i);
  });

  it("o item da Central é CRÍTICO e diz que é urgência jurídica", async () => {
    await rodaTurno(AUDIENCIA, []);

    const { rows } = await pool.query<{ severity: string; title: string }>(
      "select severity, title from agent_inbox_items where organization_id = $1 and kind = 'handoff'",
      [ORG],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.severity).toBe("critical");
    expect(rows[0]!.title).toMatch(/Urgência jurídica/);
  });

  it("controle: mensagem comum não dispara o desvio e o modelo roda", async () => {
    await rodaTurno("Bom dia, preciso de ajuda com uma rescisão", [{ tool: "send_message", input: { body: `${IDENTIFICACAO} Pode me contar o que aconteceu?` } }]);

    expect(modeloChamado).toBeGreaterThan(0);
    expect(await forceHuman()).toBe(false);
    expect(enviados).toHaveLength(1);
  });

  it("com a camada desligada, a organização escolheu: a mesma mensagem vai ao modelo", async () => {
    await pool.query(`insert into org_guardrail_layers (organization_id, layer, enabled) values ($1,'triagem_juridica',false)`, [ORG]);
    await rodaTurno(AUDIENCIA, [{ tool: "send_message", input: { body: `${IDENTIFICACAO} Vou anotar.` } }]);

    expect(modeloChamado).toBeGreaterThan(0);
    expect(await forceHuman()).toBe(false);
  });
});

describe("área que o escritório não atende -> só o texto de recusa, e o robô se cala", () => {
  it("sai a recusa (com a apresentação, por ser a 1ª mensagem), a conversa vai ao advogado conferir, sem novo aviso, e a história não se guarda", async () => {
    await rodaTurno("Fui acusado de furto na loja e vou ser processado", [
      { tool: "registrar_triagem", input: { area_do_direito: "Criminal", resumo_do_caso: "acusado de furto" } },
    ]);

    expect(enviados, "só a recusa").toHaveLength(1);
    expect(enviados[0]!.body).toMatch(/não atua/);
    expect(enviados[0]!.body).toMatch(/assistente virtual/i);
    expect(enviados[0]!.forceHumanNoEnvio, "a recusa saiu DEPOIS de a trava ser armada").toBe(false);
    expect(await forceHuman(), "recusado não pode seguir falando com o robô").toBe(true);
    const rows = await passagens();
    expect(rows, "passagem não registrada (CHECK do banco sem o valor novo?)").toHaveLength(1);
    expect(rows[0]!.motivo_codigo).toBe("triagem_recusa");
    expect(rows[0]!.origem).toBe("triagem_juridica");
    expect(rows[0]!.cliente_avisado, "ele leu a recusa").toBe(true);
    expect(resultadosVistos.join("\n")).toMatch(/recusa já foi enviada/);

    const item = await pool.query<{ severity: string; title: string }>(
      "select severity, title from agent_inbox_items where organization_id = $1 and kind = 'handoff'",
      [ORG],
    );
    expect(item.rows).toHaveLength(1);
    expect(item.rows[0]!.severity, "pedido de conferência, não alarme").toBe("info");
    expect(item.rows[0]!.title).toMatch(/confira se a recusa estava certa/);

    const { rows: casos } = await pool.query<{ custom_fields: Record<string, unknown> }>(
      "select custom_fields from crm_leads where organization_id = $1 and contact_id = $2",
      [ORG, CONTACT],
    );
    expect(casos[0]!.custom_fields.area_do_direito).toBe("Criminal");
    expect(casos[0]!.custom_fields.resumo_do_caso, "a história de quem foi recusado não se guarda").toBeUndefined();
  });

  it("o cliente escreve de novo: o robô segue calado, sem modelo e sem segundo envio", async () => {
    await rodaTurno("Fui acusado de furto na loja e vou ser processado", [
      { tool: "registrar_triagem", input: { area_do_direito: "Criminal" } },
    ]);
    const antes = enviados.length;
    const modeloAntes = modeloChamado;
    await rodaTurno("Mas eu queria contar o que aconteceu, posso?", [
      { tool: "send_message", input: { body: `${IDENTIFICACAO} Pode contar.` } },
    ]);
    expect(enviados, "o robô falou depois de recusar").toHaveLength(antes);
    expect(modeloChamado, "o turno de quem já foi passado ao advogado chamou o modelo").toBe(modeloAntes);
  });
});

describe("possível conflito de interesses -> advogado, e o cliente nunca ouve a palavra", () => {
  it("passagem triagem_conflito, aviso genérico, nada de conflito na conversa", async () => {
    await rodaTurno("Fui demitido sem justa causa pela empresa do Fulano de Tal Silva", [
      {
        tool: "registrar_triagem",
        input: { area_do_direito: "Trabalhista", parte_contraria: "Fulano de Tal Silva", resumo_do_caso: "demissão" },
      },
    ]);

    expect(enviados, "só o aviso genérico").toHaveLength(1);
    expect(enviados[0]!.body).toMatch(/advogado/i);
    expect(enviados[0]!.body).not.toMatch(/conflito|cliente do escrit/i);
    expect(enviados[0]!.forceHumanNoEnvio).toBe(false);
    expect(await forceHuman()).toBe(true);

    const rows = await passagens();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.motivo_codigo).toBe("triagem_conflito");
    expect(rows[0]!.origem).toBe("triagem_juridica");

    // O que o modelo viu: sem o nome do outro cliente, sem a palavra.
    const vistos = resultadosVistos.join("\n");
    expect(vistos).toMatch(/entregue ao advogado/);
    expect(vistos).not.toMatch(/Fulano|conflito/i);
  });
});

describe("triagem sem desvio -> o modelo continua", () => {
  it("`seguir`: o modelo vê o que falta e fala com o cliente; a conversa não é passada", async () => {
    await rodaTurno("Bom dia, fui demitido sem justa causa", [
      { tool: "registrar_triagem", input: { area_do_direito: "Trabalhista" } },
      { tool: "send_message", input: { body: `${IDENTIFICACAO} Qual o nome da empresa onde você trabalhava?` } },
    ]);

    expect(resultadosVistos.join("\n")).toMatch(/seguir/);
    expect(enviados.map((e) => e.body)).toEqual([`${IDENTIFICACAO} Qual o nome da empresa onde você trabalhava?`]);
    expect(await forceHuman()).toBe(false);
    expect(await passagens()).toHaveLength(0);
  });
});
