/**
 * Spec 0002.E5 — prova de isolamento do acervo ENTRE ESCRITÓRIOS.
 *
 * Critério 5: "Escritório A busca por termo que só existe em documento do
 * escritório B → zero resultado. Teste, com dois organization_id reais."
 *
 * `rag-acervo-da-organizacao.test.ts` (do original) prova o recorte DENTRO de
 * uma organização (agente × fonte). Este prova o recorte ENTRE organizações, com
 * tentativa explícita de vazamento por cada porta da busca:
 *   1. A pede a busca passando o id da FONTE de B;
 *   2. o usuário de A pede a busca dizendo ser a organização B;
 *   3. o usuário de A lê `ai_chunks` direto (RLS), procurando o termo de B;
 *   4. a busca LEGADA (`retrieve_top_k_chunks`) com a VERSÃO de B;
 *   5. o caminho da aplicação: `searchKnowledge` + `comOrigem` (0002.E4).
 * Cada um com o PAR positivo: o que é de A, A encontra — senão o zero não prova
 * nada (a fixture podia não existir).
 *
 * MUTAÇÃO (20/10/2026), em cópia descartável do banco: sem o filtro
 * `c.organization_id = p_organization_id` em `fn_buscar_trechos_das_fontes`, o
 * caso 1 acusa o trecho de B. Ver o último teste.
 *
 * Roda em `pnpm test:db`.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comOrigem } from "@/lib/acervo/origem";
import { searchKnowledge } from "@/lib/agent-engine/agent/search-knowledge";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});
afterAll(() => pool.end());

const VETOR = `(select array_fill(0.1::real, array[1536])::vector)`;
const TERMO_DE_A = "contrato de locação comercial da Padaria Central";
const TERMO_DE_B = "acordo sigiloso da Construtora Horizonte";

type Escritorio = { org: string; user: string; fonte: string; versao: string };

async function escritorio(termo: string, documento: string): Promise<Escritorio> {
  const e = { org: randomUUID(), user: randomUUID(), fonte: randomUUID(), versao: randomUUID() };
  await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'Esc','Esc')", [e.org]);
  await pool.query("insert into auth.users(id,email) values($1,$2)", [e.user, `${e.user}@acervo.test`]);
  await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'admin',now())", [e.user, e.org]);
  await pool.query(
    `insert into ai_knowledge_sources(id,organization_id,agent_id,source_type,name,status,is_active)
     values($1,$2,null,'documento','Acervo do escritório','ready',true)`,
    [e.fonte, e.org],
  );
  await pool.query(
    `insert into ai_knowledge_versions(id,organization_id,knowledge_source_id,version_number,status,is_active)
     values($1,$2,$3,1,'ready',true)`,
    [e.versao, e.org, e.fonte],
  );
  await pool.query("update ai_knowledge_sources set active_kb_version_id=$1 where id=$2", [e.versao, e.fonte]);
  await pool.query(
    `insert into ai_chunks(organization_id,knowledge_source_id,kb_version_id,position,content,content_hash,token_count,embedding,metadata)
     values($1,$2,$3,0,$4,$5,10,${VETOR},$6)`,
    [e.org, e.fonte, e.versao, termo, `h-${e.org}`, { documento: documento, nome: `${documento}.pdf`, pagina_inicial: 1, pagina_final: 1 }],
  );
  return e;
}

let A: Escritorio;
let B: Escritorio;

beforeAll(async () => {
  A = await escritorio(TERMO_DE_A, "doc-a");
  B = await escritorio(TERMO_DE_B, "doc-b");
});

const busca = async (org: string, fontes: string[]) =>
  (
    await pool.query<{ content: string }>(
      `select content from fn_buscar_trechos_das_fontes($1, $2::uuid[], ${VETOR}, 10, -1)`,
      [org, fontes],
    )
  ).rows.map((r) => r.content);

async function comoUsuario<T>(user: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user })]);
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
}

describe("critério 5: o acervo de B não aparece para A", () => {
  it("1. A pedindo a FONTE de B: zero — e A acha a própria (par positivo)", async () => {
    expect(await busca(A.org, [B.fonte])).toEqual([]);
    expect(await busca(A.org, [A.fonte, B.fonte])).toEqual([TERMO_DE_A]);
  });

  it("2. o usuário de A dizendo ser B: a função recusa", async () => {
    await expect(
      comoUsuario(A.user, (c) =>
        c.query(`select * from fn_buscar_trechos_das_fontes($1, $2::uuid[], ${VETOR}, 10, -1)`, [B.org, [B.fonte]]),
      ),
    ).rejects.toThrow(/caller_not_authorized_for_org/);
    // Par positivo: como A, pela própria organização, a busca responde.
    const proprios = await comoUsuario(A.user, async (c) =>
      (await c.query(`select content from fn_buscar_trechos_das_fontes($1, $2::uuid[], ${VETOR}, 10, -1)`, [A.org, [A.fonte]])).rows,
    );
    expect(proprios.map((r) => r.content)).toEqual([TERMO_DE_A]);
  });

  it("3. o usuário de A lendo ai_chunks direto: a RLS não mostra o termo de B", async () => {
    const vistos = await comoUsuario(A.user, async (c) =>
      (await c.query<{ content: string }>("select content from ai_chunks where content in ($1, $2)", [TERMO_DE_A, TERMO_DE_B])).rows,
    );
    expect(vistos.map((r) => r.content)).toEqual([TERMO_DE_A]);
  });

  it("4. a busca legada com a VERSÃO de B, pela organização A: zero", async () => {
    const { rows } = await pool.query(
      `select content from retrieve_top_k_chunks($1, $2, ${VETOR}, 10, -1)`,
      [A.org, B.versao],
    );
    expect(rows).toEqual([]);
  });

  it("5. o caminho da aplicação (searchKnowledge + comOrigem): só o documento de A, com origem", async () => {
    const r = await searchKnowledge(
      pool,
      { organizationId: A.org, knowledgeSourceIds: [A.fonte, B.fonte], query: "Construtora Horizonte", topK: 10, threshold: -1 },
      { embed: async () => ({ embedding: Array(1536).fill(0.1), model: "text-embedding-3-small" }) as never },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { trechos, semOrigem } = comOrigem(r.results);
    expect(semOrigem).toBe(0);
    expect(trechos.map((t) => [t.texto, t.citacao])).toEqual([[TERMO_DE_A, "doc-a.pdf, p. 1"]]);
  });

  it("mutação: sem o filtro de organização na função, o caso 1 acusa B", async () => {
    // Banco descartável: a função é trocada dentro de uma transação que volta.
    const c = await pool.connect();
    try {
      await c.query("begin");
      const def = (await c.query<{ d: string }>(
        "select pg_get_functiondef('public.fn_buscar_trechos_das_fontes(uuid,uuid[],vector,integer,real,text)'::regprocedure) as d",
      )).rows[0]!.d;
      const sem = def.replace("where c.organization_id = p_organization_id", "where true");
      expect(sem).not.toBe(def);
      await c.query(sem);
      const { rows } = await c.query<{ content: string }>(
        `select content from fn_buscar_trechos_das_fontes($1, $2::uuid[], ${VETOR}, 10, -1)`,
        [A.org, [B.fonte]],
      );
      expect(rows.map((r) => r.content)).toEqual([TERMO_DE_B]);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});
