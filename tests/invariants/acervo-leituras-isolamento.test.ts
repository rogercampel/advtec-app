import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Leitura de processo guardada (migration 9007, spec 0003.E6) — isolamento entre
 * escritórios e escrita fora da mesa.
 *
 * Spec 0003, critério 8: documento de um escritório nunca aparece na leitura de
 * outro. O documento traz trecho de processo de cliente; se vazar, vaza o caso.
 * E a tela nunca mostra resultado parcial como final: o check de estado impede
 * "pronta" sem documento e documento numa leitura que falhou.
 *
 * Roda no container efêmero do `scripts/test-db.sh`, com `baseline.sql` já
 * aplicado:  TEST_DB_PORT=64329 pnpm test:db tests/invariants/acervo-leituras-isolamento.test.ts
 *
 * MUTAÇÃO (21/10/2026), no teste do fim: desligar a RLS numa cópia descartável
 * faz o usuário A ler a leitura de B.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER não definido — rode via `pnpm test:db` (scripts/test-db.sh)");
const containerName: string = container;

function sql(script: string, banco = "postgres"): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", banco, "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

function sqlDeveFalhar(script: string): string {
  try {
    execFileSync(
      "docker",
      ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
      { input: script, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (e) {
    return String((e as { stderr?: Buffer | string }).stderr ?? "");
  }
  throw new Error("o comando DEVERIA ter falhado, e passou");
}

const ORG_A = "aaaaaaaa-0000-4000-8000-00000000ac01";
const ORG_B = "bbbbbbbb-0000-4000-8000-00000000ac02";
const USER_A = "aaaaaaaa-1111-4000-8000-00000000ac01";
const DOC = `'{"aviso":"x","quemEQuem":[]}'::jsonb`;

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_A}', 'leitura-inv-a', 'Leitura Invariant A', 'Leitura A'),
             ('${ORG_B}', 'leitura-inv-b', 'Leitura Invariant B', 'Leitura B')
      on conflict (id) do nothing;
    insert into auth.users (id, email) values ('${USER_A}', 'leitura-rls-a@invariant.test') on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_A}', '${ORG_A}', 'admin', now()) on conflict do nothing;
    insert into public.acervo_leituras (organization_id, nome_do_arquivo, total_de_paginas, estado, documento)
      values ('${ORG_A}', 'processo-a.pdf', 34, 'pronta', ${DOC}),
             ('${ORG_B}', 'processo-b.pdf', 12, 'pronta', ${DOC});
  `);
});

function countAsA(org: string, banco = "postgres"): number {
  const out = sql(
    `
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${USER_A}"}', false);
    select count(*) from public.acervo_leituras where organization_id = '${org}';
  `,
    banco,
  );
  const last = out.split("\n").at(-1);
  if (last === undefined || !/^\d+$/.test(last)) throw new Error(`contagem inválida: ${out}`);
  return Number(last);
}

function provaLeitura(banco = "postgres") {
  expect(countAsA(ORG_A, banco), "usuário A lê suas leituras").toBeGreaterThan(0);
  expect(countAsA(ORG_B, banco), "usuário A lê leituras de B").toBe(0);
}

describe("critério 8: a leitura de um escritório nunca aparece para outro", () => {
  it("A lê a sua; não lê a de B, com controle positivo", () => {
    expect(Number(sql(`select count(*) from public.acervo_leituras where organization_id='${ORG_B}';`))).toBeGreaterThan(0);
    provaLeitura();
  });

  it.each([
    ["insert", `insert into public.acervo_leituras (organization_id, nome_do_arquivo, total_de_paginas) values ('${ORG_A}', 'x.pdf', 1);`],
    ["update", `update public.acervo_leituras set nome_do_arquivo = 'trocado.pdf' where organization_id = '${ORG_A}';`],
    ["delete", `delete from public.acervo_leituras where organization_id = '${ORG_A}';`],
    ["truncate", `truncate public.acervo_leituras;`],
  ])("A não faz %s nem na própria organização: a escrita é só do servidor", (_, comando) => {
    const erro = sqlDeveFalhar(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${USER_A}"}', true);
      ${comando}
      rollback;
    `);
    expect(erro).toMatch(/permission denied|row-level security/i);
  });

  it("anon não lê nada", () => {
    expect(sqlDeveFalhar("set role anon; select count(*) from public.acervo_leituras;")).toMatch(/permission denied/i);
  });

  it("anon não tem privilégio nenhum na tabela — a recusa acima não depende da função da policy", () => {
    expect(
      sql(`select string_agg(p, ',') from unnest(array['select','insert','update','delete','truncate','references','trigger']) p
           where has_table_privilege('anon', 'public.acervo_leituras', p);`),
    ).toBe("");
  });
});

describe("a tela nunca mostra resultado parcial como final", () => {
  it.each([
    ["pronta sem documento", `'pronta', null, null`],
    ["falhou com documento", `'falhou', ${DOC}, 'erro'`],
    ["falhou sem motivo", `'falhou', null, null`],
    ["lendo com documento", `'lendo', ${DOC}, null`],
    ["estado inventado", `'quase', null, null`],
  ])("%s é recusado", (_, valores) => {
    const erro = sqlDeveFalhar(`
      insert into public.acervo_leituras (organization_id, nome_do_arquivo, total_de_paginas, estado, documento, motivo_da_falha)
      values ('${ORG_A}', 'x.pdf', 1, ${valores});
    `);
    expect(erro).toMatch(/acervo_leitura_(pronta_tem_documento|estado_valido)/);
  });

  it("lendo → pronta com documento é aceito", () => {
    sql(`
      insert into public.acervo_leituras (organization_id, nome_do_arquivo, total_de_paginas) values ('${ORG_A}', 'andamento.pdf', 3);
      update public.acervo_leituras set estado = 'pronta', documento = ${DOC} where nome_do_arquivo = 'andamento.pdf';
    `);
    expect(Number(sql(`select count(*) from public.acervo_leituras where nome_do_arquivo = 'andamento.pdf' and estado = 'pronta';`))).toBe(1);
  });
});

it("mutação: desligar RLS em cópia descartável acusa leitura de B", () => {
  const banco = "advtec_mutacao_rls_leituras";
  sql(`drop database if exists ${banco};`);
  sql(`create database ${banco} template postgres;`);
  try {
    sql("alter table public.acervo_leituras disable row level security;", banco);
    expect(countAsA(ORG_B, banco)).toBeGreaterThan(0);
    expect(() => provaLeitura(banco)).toThrow(/usuário A lê leituras de B/);
  } finally {
    sql(`drop database ${banco};`);
  }
});
