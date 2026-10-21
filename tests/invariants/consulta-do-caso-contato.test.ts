/**
 * Spec 0010.E1 — contato ↔ caso, num Postgres de verdade.
 *
 * Critério 1: contato sem caso ligado nunca recebe informação de processo.
 * Critério 2 (lado do vínculo): os casos de um contato nunca incluem caso de
 * outro contato, nem de outro escritório.
 *
 * Duas portas, provadas separadamente:
 *   - `casosDoContato` com o pool do worker (postgres, sem RLS): o isolamento é
 *     o `where` da consulta;
 *   - a tela, como `authenticated` com o JWT do usuário do escritório A: o
 *     isolamento é a RLS de `crm_leads`.
 *
 * MUTAÇÕES (20/10/2026, as três derrubaram): tirar `organization_id = $1` faz
 * "outro escritório" acusar; tirar `contact_id = $2` faz "outro
 * contato" acusar; tirar o filtro do número faz "negócio sem número" acusar.
 *
 * Roda em `pnpm test:db` (precisa de Postgres).
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { casosDoContato } from "@/lib/djen/consulta-do-caso";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});
afterAll(() => pool.end());

const NUM_A = "0001234-56.2026.8.26.0100";
const NUM_A2 = "0007777-11.2025.8.26.0001";
const NUM_B = "0009999-00.2026.8.26.0100";

async function escritorio() {
  const org = randomUUID();
  const pipeline = randomUUID();
  const stage = randomUUID();
  await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'Esc','Esc')", [org]);
  await pool.query("insert into crm_pipelines(id,organization_id,name,slug) values($1::uuid,$2,'Casos',$1::text)", [pipeline, org]);
  await pool.query(
    "insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values($1,$2,$3,'Em andamento','andamento',1)",
    [stage, org, pipeline],
  );
  const contato = async () => {
    const id = randomUUID();
    await pool.query("insert into contacts(id,organization_id) values($1,$2)", [id, org]);
    return id;
  };
  const caso = async (contactId: string | null, campos: Record<string, unknown>, titulo = "Caso") => {
    const id = randomUUID();
    await pool.query(
      "insert into crm_leads(id,organization_id,pipeline_id,stage_id,contact_id,title,custom_fields) values($1,$2,$3,$4,$5,$6,$7)",
      [id, org, pipeline, stage, contactId, titulo, campos],
    );
    return id;
  };
  return { org, contato, caso };
}

let A: Awaited<ReturnType<typeof escritorio>>;
let B: Awaited<ReturnType<typeof escritorio>>;
type Chave = "maria" | "joao" | "semCaso" | "mariaCaso1" | "mariaCaso2" | "mariaSemNumero" | "joaoCaso" | "contatoDeB" | "casoDeB";
const ids = {} as Record<Chave, string>;

beforeAll(async () => {
  A = await escritorio();
  B = await escritorio();
  ids.maria = await A.contato();
  ids.joao = await A.contato();
  ids.semCaso = await A.contato();
  ids.mariaCaso1 = await A.caso(ids.maria, { numero_processo: NUM_A }, "Maria x Banco");
  ids.mariaCaso2 = await A.caso(ids.maria, { numero_processo: ` ${NUM_A2} ` }, "Maria x INSS");
  ids.mariaSemNumero = await A.caso(ids.maria, { numero_processo: "  " }, "Maria, consulta");
  ids.joaoCaso = await A.caso(ids.joao, { numero_processo: NUM_B }, "João x Loja");
  await A.caso(ids.semCaso, {}, "Negócio sem número");
  ids.contatoDeB = await B.contato();
  ids.casoDeB = await B.caso(ids.contatoDeB, { numero_processo: NUM_A }, "Mesmo número, outro escritório");
});

describe("casosDoContato — o pool do worker", () => {
  it("devolve os casos com número do contato, e só eles", async () => {
    const casos = await casosDoContato(pool, { organizationId: A.org, contactId: ids.maria });
    expect(casos.map((c) => c.id).sort()).toEqual([ids.mariaCaso1, ids.mariaCaso2].sort());
    expect(casos.find((c) => c.id === ids.mariaCaso2)?.numeroProcesso).toBe(NUM_A2);
  });

  it("critério 1: contato sem caso com número recebe lista vazia", async () => {
    expect(await casosDoContato(pool, { organizationId: A.org, contactId: ids.semCaso })).toEqual([]);
  });

  it("outro contato do mesmo escritório não enxerga o caso do João", async () => {
    const casos = await casosDoContato(pool, { organizationId: A.org, contactId: ids.maria });
    expect(casos.map((c) => c.id)).not.toContain(ids.joaoCaso);
  });

  it("outro escritório: contato de B consultado por A não devolve nada, e B não lê os de A", async () => {
    expect(await casosDoContato(pool, { organizationId: A.org, contactId: ids.contatoDeB })).toEqual([]);
    expect(await casosDoContato(pool, { organizationId: B.org, contactId: ids.maria })).toEqual([]);
    const deB = await casosDoContato(pool, { organizationId: B.org, contactId: ids.contatoDeB });
    expect(deB.map((c) => c.id)).toEqual([ids.casoDeB]);
  });

  it("o banco recusa negócio de um escritório ligado a contato de outro", async () => {
    await expect(B.caso(ids.maria, { numero_processo: NUM_B })).rejects.toThrow(/Contato não encontrado/);
  });
});

describe("a tela — authenticated com o JWT do usuário de A", () => {
  it("a RLS de crm_leads não deixa o usuário de A ver o caso de B, nem pedindo pelo contato", async () => {
    const user = randomUUID();
    await pool.query("insert into auth.users(id,email) values($1,$2)", [user, `${user}@consulta.test`]);
    await pool.query(
      "insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'admin',now())",
      [user, A.org],
    );
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user })]);
      const { rows } = await c.query<{ id: string }>("select id from crm_leads where contact_id = any($1)", [
        [ids.maria, ids.contatoDeB],
      ]);
      const vistos = rows.map((r) => r.id);
      expect(vistos).toContain(ids.mariaCaso1); // controle: A lê os seus
      expect(vistos).not.toContain(ids.casoDeB);
    } finally {
      await c.query("rollback").catch(() => undefined);
      c.release();
    }
  });
});
