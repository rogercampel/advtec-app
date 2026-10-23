import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as Queue from "@/lib/agent-engine/queue/queue";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";

import { FRASE_DE_IDENTIFICACAO } from "@/lib/oab/gate-das-travas";
import { modeloJaRespondeuAoContato } from "@/lib/oab/primeira-resposta";

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
 * Regras da revisão de 23/10/2026 que este arquivo cobre contra o banco:
 *   - o 1º veto `trava_oab` do turno ENSINA (nada sai, sem passagem) e o 2º entrega ao advogado;
 *   - o texto barrado nunca sai, e o briefing diz o que de fato saiu no turno;
 *   - o template de disclosure ("não garantimos resultado") não é julgado como texto do modelo;
 *   - bolhas: a deferência pode estar noutra mensagem do mesmo turno;
 *   - a identificação é retentável e, depois de 2 recusas, injetada pelo sistema;
 *   - "primeira resposta" é a do MODELO (template/aviso/fluxo não contam) — a consulta
 *     `modeloJaRespondeuAoContato` contra o schema real, e o aviso que é o 1º envio abre com a
 *     identificação.
 *
 * MUTAÇÕES: este arquivo NÃO foi executado por quem o escreveu (Docker fora): a CI o roda. A
 * cobertura por mutação das mesmas regras está em `tests/unit/gate-das-travas-oab.test.ts` (gate
 * e fiação do turno), feita em 23/10/2026. Quem refizer contra o banco: apagar o contador do
 * 1º veto no `inbound-turn`, trocar a consulta de `primeira-resposta.ts` por `countPriorAcceptedSends`,
 * tirar `semOTemplate` do gate, tirar `deferiuNoTurno`, tirar `trava_da_oab` do CHECK do baseline —
 * cada uma deve deixar um caso daqui vermelho.
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

/** Publica o template de disclosure da organização (o `disclosureGate` o injeta na 1ª mensagem). */
async function configuraDisclosure(body: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    "insert into disclosure_template_versions (organization_id, body) values ($1,$2) returning id",
    [ORG, body],
  );
  await pool.query(
    `insert into disclosure_template_pointers (organization_id, version_id) values ($1,$2)
     on conflict (organization_id) do update set version_id = excluded.version_id`,
    [ORG, rows[0]!.id],
  );
}

/**
 * Semeia UM envio já ACEITO no ledger, como o motor o deixaria: um job, a mensagem gravada
 * (`messages.id` = `send_ledger.id`) e a linha do ledger. `tipo` é o `messages.type`.
 */
async function semeiaEnvio(o: {
  kind: "inbound_turn" | "case_reply_turn" | "followup_turn";
  seq: number;
  tipo: "text" | "template";
  status?: "accepted" | "requested" | "failed";
  payload?: Record<string, unknown>;
}): Promise<void> {
  const { job } = await m.queue.enqueueJob(pool, ORG, {
    kind: o.kind,
    leadId: CONTACT,
    payload: { conversation_id: CONV, contact_id: CONTACT, channel_session_id: SESSION, ...(o.payload ?? {}) },
    maxAttempts: 1,
  });
  await pool.query("update job_queue set status = 'done' where id = $1", [job.id]);
  const id = crypto.randomUUID();
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via)
     values ($1,$2,$3,$4,$5,$6,'outbound','sent','envio semeado','ai')`,
    [id, ORG, CONV, SESSION, CONTACT, o.tipo],
  );
  await pool.query(
    `insert into send_ledger (id, organization_id, contact_id, job_id, seq, body_hash, status, crm_message_id)
     values ($1,$2,$3,$4,$5,'hash',$6,$1)`,
    [id, ORG, CONTACT, job.id, o.seq, o.status ?? "accepted"],
  );
}

async function limpaEnvios(): Promise<void> {
  await pool.query("delete from send_ledger where organization_id = $1", [ORG]);
  await pool.query("delete from messages where organization_id = $1 and direction = 'outbound'", [ORG]);
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
  await pool.query("delete from job_queue where organization_id = $1", [ORG]);
  await pool.query("delete from disclosure_template_pointers where organization_id = $1", [ORG]);
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
const PROMESSA_DE_NOVO = "Sou o assistente virtual do escritório. Garanto que você vai ganhar o processo.";
const LIMPA =
  "Sou o assistente virtual do escritório, um atendimento automatizado. Pode me contar o que aconteceu?";
const DEFERE =
  "Sou o assistente virtual do escritório, um atendimento automatizado. Essa análise é do advogado; vou passar o seu caso hoje.";
const CLIENTE_DEMITIDO = "Bom dia, fui demitido sem justa causa";

/** Dois vetos seguidos de conteúdo: o 1º ensina, o 2º entrega ao advogado. */
const DUAS_PROMESSAS = [PROMESSA, PROMESSA_DE_NOVO];

async function passagens() {
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
  return rows;
}

describe("o 1º veto da trava ENSINA — o texto barrado nunca sai, e a conversa NÃO vai ao advogado", () => {
  it("promessa e depois resposta limpa: só a limpa sai, o modelo leu 'NÃO foi enviado', sem passagem", async () => {
    await rodaTurno(CLIENTE_DEMITIDO, [PROMESSA, LIMPA]);

    expect(enviados.map((e) => e.body)).toEqual([LIMPA]);
    expect(resultadosVistos.join("\n")).toMatch(/NÃO foi enviado/);
    expect(resultadosVistos.join("\n")).toMatch(/cabe ao advogado/);
    expect(await forceHuman(), "o 1º veto já entregou ao advogado: deveria só ensinar").toBe(false);
    expect(await passagens()).toHaveLength(0);
  });

  it("promessa e o turno acaba: NADA sai e ninguém é avisado (o modelo é quem decide reformular)", async () => {
    await rodaTurno(CLIENTE_DEMITIDO, [PROMESSA]);

    expect(enviados.map((e) => e.body).filter((b) => /certeza|ganhar/i.test(b))).toEqual([]);
    expect(await forceHuman()).toBe(false);
  });
});

describe("o 2º veto da trava no mesmo turno -> a conversa vai ao advogado", () => {
  it("nada sai ao cliente além do aviso, e nenhuma das duas promessas chega ao canal", async () => {
    await rodaTurno(CLIENTE_DEMITIDO, DUAS_PROMESSAS);

    expect(
      enviados.map((e) => e.body).filter((b) => /ganhar|certeza|Garanto/i.test(b)),
      "uma promessa de resultado SAIU ao cliente",
    ).toEqual([]);
    expect(enviados, "o cliente recebe UM aviso, e só").toHaveLength(1);
    expect(enviados[0]!.body).toMatch(/advogado/i);
    // A ordem do molde: avisa e só então arma a trava.
    expect(enviados[0]!.forceHumanNoEnvio, "avisou depois de armar a trava que veta o aviso").toBe(false);
  });

  it("o aviso, sendo o 1º envio e sem template de disclosure, abre com a identificação (regra 8)", async () => {
    await rodaTurno(CLIENTE_DEMITIDO, DUAS_PROMESSAS);

    expect(enviados[0]!.body.startsWith(FRASE_DE_IDENTIFICACAO)).toBe(true);
    expect(enviados[0]!.body).toMatch(/advogado/i);
  });

  it("com template de disclosure, quem abre o aviso é o template — a frase padrão não se repete", async () => {
    await configuraDisclosure("Sou o assistente virtual do escritório. Este é um atendimento automatizado.");
    await rodaTurno(CLIENTE_DEMITIDO, DUAS_PROMESSAS);

    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.body.startsWith("Sou o assistente virtual do escritório.")).toBe(true);
    expect(enviados[0]!.body).not.toContain(FRASE_DE_IDENTIFICACAO);
  });

  it("contacts.force_human fica true e a conversa volta à fila humana", async () => {
    await rodaTurno(CLIENTE_DEMITIDO, DUAS_PROMESSAS);

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

  it("a passagem é registrada com o motivo e a origem novos, sem o texto barrado, dizendo que nada saiu", async () => {
    await rodaTurno(CLIENTE_DEMITIDO, DUAS_PROMESSAS);

    const rows = await passagens();
    expect(rows, "a passagem não foi registrada (CHECK do banco sem o valor novo?)").toHaveLength(1);
    expect(rows[0]!.motivo_codigo).toBe("trava_da_oab");
    expect(rows[0]!.origem).toBe("trava_de_saida");
    expect(rows[0]!.cliente_avisado).toBe(true);
    // Quem assume lê POR QUE: o rótulo da trava, não o rascunho nem um código cru.
    expect(rows[0]!.body).toMatch(/promessa de resultado/);
    expect(rows[0]!.body).not.toMatch(/com certeza|Garanto/);
    // E o que de fato saiu (regra 6): nada.
    expect(rows[0]!.body).toMatch(/nenhuma mensagem do assistente saiu ao cliente neste turno/);
  });

  it("se uma bolha já tinha saído no turno, o briefing diz que saiu — não 'nada foi enviado'", async () => {
    await rodaTurno("Eu ganho essa causa?", [DEFERE, PROMESSA, PROMESSA_DE_NOVO]);

    // A deferência saiu; as duas promessas foram barradas (a deferência anterior não dá licença para prometer).
    expect(enviados.map((e) => e.body).filter((b) => /certeza|Garanto/i.test(b))).toEqual([]);
    const rows = await passagens();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toMatch(/1 mensagem do assistente já tinha saído ao cliente neste turno/);
    expect(rows[0]!.body).not.toMatch(/nenhuma mensagem do assistente saiu/);
  });

  it("o modelo recebe a ordem de parar, e uma 3ª tentativa não sai", async () => {
    await rodaTurno(CLIENTE_DEMITIDO, [...DUAS_PROMESSAS, PROMESSA + " Pode confiar."]);

    const vistos = resultadosVistos.join("\n");
    expect(vistos).toMatch(/entregue ao advogado/);
    expect(vistos).toMatch(/encerre o turno/);
    expect(enviados.filter((e) => /certeza|Garanto|confiar/i.test(e.body))).toEqual([]);
  });
});

describe("o desfecho legítimo continua saindo", () => {
  it("controle: resposta limpa, que se identifica, sai e não passa a conversa", async () => {
    await rodaTurno(CLIENTE_DEMITIDO, [LIMPA]);

    expect(enviados.map((e) => e.body)).toEqual([LIMPA]);
    expect(await forceHuman(), "resposta legítima virou passagem — o teste mediu outra coisa").toBe(false);
  });

  it("pergunta de mérito respondida deferindo ao advogado sai (e não vira passagem)", async () => {
    await rodaTurno("Eu ganho essa causa?", [DEFERE]);

    expect(enviados.map((e) => e.body)).toEqual([DEFERE]);
    expect(await forceHuman()).toBe(false);
  });

  it("pergunta de mérito respondida com opinião, duas vezes, vai ao advogado", async () => {
    const opina = (x: string) => `Sou o assistente virtual do escritório, um atendimento automatizado. ${x}`;
    await rodaTurno("Eu ganho essa causa?", [opina("Pelo que você contou, a chance é boa."), opina("Eu acho que sim.")]);

    expect(enviados, "só o aviso").toHaveLength(1);
    expect(enviados[0]!.body).toMatch(/advogado/i);
    expect(await forceHuman()).toBe(true);
  });
});

describe("bolhas: a deferência pode estar noutra mensagem do mesmo turno (regra 3)", () => {
  it("deferência primeiro e 'Entendi a sua dúvida.' depois: as duas saem", async () => {
    await rodaTurno("Eu ganho essa causa?", [DEFERE, "Entendi a sua dúvida."]);

    expect(enviados.map((e) => e.body)).toEqual([DEFERE, "Entendi a sua dúvida."]);
    expect(await forceHuman()).toBe(false);
  });

  it("contraste: 'Entendi a sua dúvida.' sozinha (sem deferência antes) é barrada e o modelo reformula", async () => {
    await rodaTurno("Eu ganho essa causa?", ["Entendi a sua dúvida.", DEFERE]);

    expect(enviados.map((e) => e.body)).toEqual([DEFERE]);
    expect(resultadosVistos.join("\n")).toMatch(/NÃO foi enviado/);
    expect(await forceHuman()).toBe(false);
  });
});

describe("o template de disclosure não é julgado como texto do modelo (regra 1)", () => {
  it("template 'não garantimos resultado em nenhum caso' + 1ª resposta normal: sai com o template, sem passagem", async () => {
    const template = "Sou o assistente virtual do escritório. Não garantimos resultado em nenhum caso.";
    await configuraDisclosure(template);
    await rodaTurno("Bom dia, preciso de ajuda", ["Posso anotar o seu nome completo e o assunto?"]);

    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.body.startsWith(template)).toBe(true);
    expect(enviados[0]!.body).toContain("Posso anotar o seu nome completo e o assunto?");
    expect(await forceHuman(), "o template honesto virou promessa e entregou a conversa").toBe(false);
  });
});

describe("resposta a mensagem sem texto (mídia)", () => {
  it("houve entrada do cliente: a resposta limpa sai, e a promessa (duas vezes) é barrada e entrega", async () => {
    await rodaTurno("", [LIMPA]);
    expect(enviados.map((e) => e.body)).toEqual([LIMPA]);
    expect(await forceHuman(), "mídia sem texto virou 'sem mensagem' e foi ao advogado").toBe(false);

    await pool.query("delete from send_ledger where organization_id = $1", [ORG]);
    await rodaTurno("", DUAS_PROMESSAS);
    expect(enviados.map((e) => e.body).filter((b) => /certeza|Garanto/.test(b))).toEqual([]);
    expect(await forceHuman()).toBe(true);
  });
});

describe("a identificação da 1ª resposta é retentável — e, por fim, injetada (regra 9)", () => {
  it("sem se identificar: o modelo é ensinado a reescrever, reescreve, e a conversa NÃO vai ao advogado", async () => {
    await rodaTurno("Bom dia, preciso de ajuda", ["Olá! Como posso ajudar?", LIMPA]);

    expect(resultadosVistos.join("\n")).toMatch(/trava_oab_identificacao/);
    expect(enviados.map((e) => e.body)).toEqual([LIMPA]);
    expect(await forceHuman(), "falta de identificação virou passagem: deveria ser retentável").toBe(false);
  });

  it("depois de 2 recusas o sistema emenda a frase padrão — o turno não fica mudo", async () => {
    const corpo = "Olá! Como posso ajudar?";
    await rodaTurno("Bom dia, preciso de ajuda", [corpo, corpo, corpo]);

    // O modelo foi recusado (a 3ª tentativa é a que recebe a emenda do sistema).
    expect(resultadosVistos.join("\n")).toMatch(/trava_oab_identificacao/);
    expect(enviados.map((e) => e.body)).toEqual([`${FRASE_DE_IDENTIFICACAO}\n\n${corpo}`]);
    expect(await forceHuman()).toBe(false);
  });
});

describe("'primeira resposta' é a do MODELO, não o primeiro envio de qualquer origem (regra 5)", () => {
  it("o cliente que só recebeu um TEMPLATE ainda precisa ouvir o modelo se declarar máquina", async () => {
    await semeiaEnvio({ kind: "inbound_turn", seq: 1, tipo: "template" });
    await rodaTurno("Bom dia, preciso de ajuda", ["Olá! Como posso ajudar?", LIMPA]);

    // Mesmo com um envio aceito antes (o ledger diz "não é o primeiro"), a identificação é cobrada.
    expect(resultadosVistos.join("\n")).toMatch(/trava_oab_identificacao/);
    expect(enviados.map((e) => e.body)).toEqual([LIMPA]);
  });

  it("depois de uma resposta LIVRE do modelo a identificação não é cobrada de novo", async () => {
    await semeiaEnvio({ kind: "inbound_turn", seq: 1, tipo: "text" });
    await rodaTurno("Bom dia, preciso de ajuda", ["Posso anotar o seu nome completo?"]);

    expect(enviados.map((e) => e.body)).toEqual(["Posso anotar o seu nome completo?"]);
  });
});

describe("modeloJaRespondeuAoContato — a consulta contra o schema real", () => {
  const ja = () => modeloJaRespondeuAoContato(pool, ORG, CONTACT);

  it("contato sem envio nenhum: não", async () => {
    expect(await ja()).toBe(false);
  });

  it("template aceito: não (a mensagem é do tipo 'template')", async () => {
    await semeiaEnvio({ kind: "inbound_turn", seq: 1, tipo: "template" });
    expect(await ja()).toBe(false);
  });

  it("aviso de escalação (seq 0), mesmo texto livre e aceito: não", async () => {
    await semeiaEnvio({ kind: "inbound_turn", seq: 0, tipo: "text" });
    expect(await ja()).toBe(false);
  });

  it("follow-up dirigido por fluxo (payload.purpose = send_message): não", async () => {
    await semeiaEnvio({ kind: "followup_turn", seq: 1, tipo: "text", payload: { purpose: "send_message" } });
    expect(await ja()).toBe(false);
  });

  it("envio que não foi aceito (requested/failed): não", async () => {
    await semeiaEnvio({ kind: "inbound_turn", seq: 1, tipo: "text", status: "requested" });
    await semeiaEnvio({ kind: "inbound_turn", seq: 1, tipo: "text", status: "failed" });
    expect(await ja()).toBe(false);
  });

  it("resposta livre aceita num turno do agente: sim — inbound_turn, case_reply_turn e follow-up SEM purpose", async () => {
    await semeiaEnvio({ kind: "inbound_turn", seq: 1, tipo: "text" });
    expect(await ja()).toBe(true);
    await limpaEnvios();
    await semeiaEnvio({ kind: "case_reply_turn", seq: 1, tipo: "text" });
    expect(await ja()).toBe(true);
    await limpaEnvios();
    await semeiaEnvio({ kind: "followup_turn", seq: 1, tipo: "text" });
    expect(await ja()).toBe(true);
  });

  it("não vaza entre organizações: envio de outro contato não conta", async () => {
    await semeiaEnvio({ kind: "inbound_turn", seq: 1, tipo: "text" });
    expect(await modeloJaRespondeuAoContato(pool, ORG, crypto.randomUUID())).toBe(false);
  });
});

describe("a camada é escolha da organização", () => {
  it("padrão (sem linha) é LIGADA — já coberto acima; com a linha desligada, o corpo sai", async () => {
    await pool.query(
      `insert into org_guardrail_layers (organization_id, layer, enabled) values ($1,'travas_oab',false)`,
      [ORG],
    );
    await rodaTurno(CLIENTE_DEMITIDO, [PROMESSA]);

    expect(enviados.map((e) => e.body)).toEqual([PROMESSA]);
    expect(await forceHuman()).toBe(false);
  });
});
