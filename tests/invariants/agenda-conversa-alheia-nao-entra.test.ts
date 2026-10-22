import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { marcarAgendamentoHandler } from "@/app/api/v1/agenda/agendamentos/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";

import { pgComoSupabase } from "../pg-como-supabase";

/**
 * A CONVERSA DO COMPROMISSO É DA MESMA ORGANIZAÇÃO E DO MESMO CONTATO.
 *
 * `conversation_id` é input externo do POST de agendamento. O banco já recusa a
 * conversa errada no INSERT (`fn_appointment_stamp`, migration 0224 →
 * `appointment_conversation_scope`), e vale até com service role: trigger não
 * pula RLS, roda sempre. O primeiro bloco prende isso.
 *
 * O que faltava era o HANDLER: ele repassava o id cru e deixava o trigger
 * estourar, e a recusa saía como 500 `internal_error`. O segundo bloco cobra a
 * mesma resposta que o `contact_id` alheio já recebe — 404 `not_found`, antes
 * de qualquer outra checagem — no molde de
 * `agenda-mcp-nao-alcanca-contato-alheio.test.ts`.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const pool = new pg.Pool({
  host: "127.0.0.1",
  port: Number(process.env.TEST_DB_PORT ?? 54329),
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
const db = pgComoSupabase(pool);

const ORG_A = "c0a7e5a0-0000-4000-8000-00000000000a";
const ORG_B = "c0a7e5a0-0000-4000-8000-00000000000b";
const DONO_A = "c0a7e5a0-1111-4000-8000-00000000000a";
const QUARTA = "2026-09-02T13:00:00.000Z";

let tipoDeA = "";
let contatoA1 = "";
let conversaDeA1 = ""; // controle: org A, contato A1
let conversaDeA2 = ""; // mesma org, OUTRO contato
let conversaDeB = ""; // outra org
let conversaDeBComContatoDeA = ""; // outra org, mesmo contato

const ctxDoAgenteDeA = (): HandlerCtx => ({
  organization_id: ORG_A,
  actor: { type: "ai_agent", id: "run-de-a", role: "agent" },
  requestId: "req-agenda-conversa-alheia",
});

async function contatoComConversa(org: string, nome: string, sessao: string) {
  const c = await pool.query<{ id: string }>(
    `insert into contacts (organization_id, name) values ($1, $2) returning id`,
    [org, nome],
  );
  const v = await pool.query<{ id: string }>(
    `insert into conversations (organization_id, contact_id, channel_session_id, status)
     values ($1, $2, $3, 'open') returning id`,
    [org, c.rows[0]!.id, sessao],
  );
  return { contato: c.rows[0]!.id, conversa: v.rows[0]!.id };
}

/** INSERT direto, como o service role faria; desfeito sempre. */
async function insereDireto(conversa: string): Promise<string | null> {
  const cli = await pool.connect();
  try {
    await cli.query("begin");
    await cli.query(
      `insert into calendar_appointments
         (organization_id, event_type_id, title, starts_at, ends_at, time_zone, status,
          owner_user_id, contact_id, conversation_id)
       values ($1, $2, 'x', $3, $3::timestamptz + interval '30 minutes',
               'America/Sao_Paulo', 'confirmed', $4, $5, $6)`,
      [ORG_A, tipoDeA, QUARTA, DONO_A, contatoA1, conversa],
    );
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    await cli.query("rollback");
    cli.release();
  }
}

async function erroDoHandler(conversa: string) {
  return (await marcarAgendamentoHandler(db, ctxDoAgenteDeA(), {
    event_type_id: tipoDeA,
    starts_at: QUARTA,
    contact_id: contatoA1,
    conversation_id: conversa,
  }).then(
    () => null,
    (e: unknown) => e,
  )) as { code?: string } | null;
}

beforeAll(async () => {
  for (const [id, slug] of [
    [ORG_A, "agenda-conv-a"],
    [ORG_B, "agenda-conv-b"],
  ] as const) {
    await pool.query(
      `insert into organizations (id, slug, legal_name, display_name)
       values ($1, $2, 'Conv LTDA', 'Conv') on conflict (id) do nothing`,
      [id, slug],
    );
    await pool.query(
      `insert into channel_sessions (organization_id, waha_session_name, webhook_secret_encrypted)
       values ($1, $2, '\\x00'::bytea)`,
      [id, slug],
    );
  }
  const sessao = async (org: string) =>
    (await pool.query<{ id: string }>(`select id from channel_sessions where organization_id = $1`, [org]))
      .rows[0]!.id;

  await pool.query(`insert into auth.users (id, email) values ($1, 'dono-conv@invariant.test')`, [DONO_A]);
  await pool.query(
    `insert into user_organizations (user_id, organization_id, role) values ($1, $2, 'admin')`,
    [DONO_A, ORG_A],
  );
  tipoDeA = (
    await pool.query<{ id: string }>(
      `insert into calendar_event_types
         (organization_id, slug, name, duration_minutes, default_owner_user_id, is_active)
       values ($1, 'conv-consulta', 'Consulta Conv', 30, $2, true) returning id`,
      [ORG_A, DONO_A],
    )
  ).rows[0]!.id;

  const a1 = await contatoComConversa(ORG_A, "Cliente A1", await sessao(ORG_A));
  const a2 = await contatoComConversa(ORG_A, "Cliente A2", await sessao(ORG_A));
  const b = await contatoComConversa(ORG_B, "Cliente B", await sessao(ORG_B));
  contatoA1 = a1.contato;
  conversaDeA1 = a1.conversa;
  conversaDeA2 = a2.conversa;
  conversaDeB = b.conversa;
  // Não há FK composta entre conversa e contato: a org B pode ter uma conversa
  // apontando para o contato de A. É o único caso em que o filtro de org decide.
  conversaDeBComContatoDeA = (
    await pool.query<{ id: string }>(
      `insert into conversations (organization_id, contact_id, channel_session_id, status)
       values ($1, $2, $3, 'open') returning id`,
      [ORG_B, contatoA1, await sessao(ORG_B)],
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

describe("o banco recusa a conversa errada no INSERT, mesmo sem RLS", () => {
  it("CONTROLE: a conversa do próprio contato entra", async () => {
    expect(await insereDireto(conversaDeA1)).toBeNull();
  });

  it("conversa de outra organização: recusada", async () => {
    expect(await insereDireto(conversaDeB)).toMatch(/appointment_conversation_scope/);
  });

  it("conversa de outro contato da mesma organização: recusada", async () => {
    expect(await insereDireto(conversaDeA2)).toMatch(/appointment_conversation_scope/);
  });
});

describe("o handler recusa antes, com 404, e não com 500", () => {
  it("CONTROLE: a conversa do próprio contato passa pela verificação", async () => {
    // Falha adiante (o adaptador não faz o embed da checagem de horário); o que
    // não pode é a conversa certa ser dada como inexistente.
    expect((await erroDoHandler(conversaDeA1))?.code).not.toBe("not_found");
  });

  it("conversa de outra organização: `not_found`", async () => {
    expect((await erroDoHandler(conversaDeB))?.code).toBe("not_found");
  });

  it("conversa de outro contato da mesma organização: `not_found`", async () => {
    expect((await erroDoHandler(conversaDeA2))?.code).toBe("not_found");
  });

  it("conversa de outra organização com o MESMO contato: `not_found`", async () => {
    expect((await erroDoHandler(conversaDeBComContatoDeA))?.code).toBe("not_found");
  });
});
