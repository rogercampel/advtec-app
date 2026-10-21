import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Espelho do DataJud — o banco recusa a mistura entre escritórios.
 *
 * ═══ POR QUE ESTE TESTE EXISTE, E POR QUE CONTRA POSTGRES ═══
 *
 * O ticket 0007.E1 tinha 18 testes verdes e nenhum tocava banco. Um revisor sem
 * contexto apontou o defeito que nenhum deles podia pegar: a chave estrangeira
 * de `datajud_processos.recorte_id` apontava só para `datajud_recortes(id)`,
 * sem par com `organization_id`.
 *
 * Consequência: nada impedia gravar o processo de um recorte do escritório A
 * sob o `organization_id` do escritório B. A policy de SELECT filtra por
 * `organization_id` e entregaria essas linhas ao inquilino errado. Num produto
 * jurídico isso é quebra de sigilo, não bug de listagem.
 *
 * Nenhum teste de unidade acha isso, porque o fake é um `Map` — e `Map.set()`
 * não tem chave estrangeira. Quem recusa é o Postgres, então é contra o
 * Postgres que se prova.
 *
 * Roda no container efêmero do `scripts/test-db.sh`, com `baseline.sql` já
 * aplicado:  TEST_DB_PORT=64329 pnpm test:db
 *
 * MUTAÇÃO (19/08/2026), feita e conferida: trocando a FK composta pela simples
 * (`references datajud_recortes(id)`) no apêndice do baseline, ficam VERMELHOS
 * "gravar processo do recorte de A sob a organização de B é RECUSADO" e
 * "nenhuma linha do escritório B existe apontando para o recorte de A" — 2 de
 * 12. Ou seja: sem a FK composta o insert PASSA, e o vazamento é real, não
 * hipótese.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER não definido — rode via `pnpm test:db` (scripts/test-db.sh)");
}
const containerName: string = container;

function sql(script: string, banco = "postgres"): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", banco, "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

/** Roda esperando FALHA. Devolve a mensagem do Postgres; joga se tiver dado certo. */
function sqlDeveFalhar(script: string): string {
  try {
    execFileSync(
      "docker",
      ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
      { input: script, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (e) {
    const err = e as { stderr?: Buffer | string };
    return String(err.stderr ?? "");
  }
  throw new Error("o comando DEVERIA ter falhado, e passou");
}

const ORG_A = "aaaaaaaa-0000-4000-8000-00000000dc01";
const ORG_B = "bbbbbbbb-0000-4000-8000-00000000dc02";
const REC_A = "aaaaaaaa-3333-4000-8000-00000000dc01";

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_A}', 'datajud-inv-a', 'DataJud Invariant A', 'DJ A'),
             ('${ORG_B}', 'datajud-inv-b', 'DataJud Invariant B', 'DJ B')
      on conflict (id) do nothing;

    insert into public.datajud_recortes (id, organization_id, rotulo, tribunal, consulta)
      values ('${REC_A}', '${ORG_A}', 'trabalhista', 'tjsp', '{"size":500}'::jsonb)
      on conflict (id) do nothing;
  `);
});

describe("o recorte de um escritório não recebe processo de outro", () => {
  it("gravar processo do recorte de A sob a organização de B é RECUSADO pelo banco", () => {
    const erro = sqlDeveFalhar(`
      insert into public.datajud_processos (organization_id, recorte_id, datajud_id, tribunal)
      values ('${ORG_B}', '${REC_A}', 'vazamento-1', 'tjsp');
    `);
    // A FK composta é quem recusa. Antes do conserto este insert PASSAVA, e a
    // linha aparecia para o escritório B.
    expect(erro).toMatch(/datajud_processo_recorte_fk|foreign key|chave estrangeira/i);
  });

  it("com a organização certa, o mesmo insert passa — a trava não bloqueia o uso normal", () => {
    sql(`
      insert into public.datajud_processos (organization_id, recorte_id, datajud_id, tribunal)
      values ('${ORG_A}', '${REC_A}', 'legitimo-1', 'tjsp')
      on conflict do nothing;
    `);
    const n = sql(`
      select count(*) from public.datajud_processos
      where organization_id = '${ORG_A}' and datajud_id = 'legitimo-1';
    `);
    expect(Number(n)).toBe(1);
  });

  it("nenhuma linha do escritório B existe apontando para o recorte de A", () => {
    const n = sql(`
      select count(*) from public.datajud_processos
      where recorte_id = '${REC_A}' and organization_id <> '${ORG_A}';
    `);
    expect(Number(n)).toBe(0);
  });
});

/**
 * `revoke insert, update, delete` NÃO cobre TRUNCATE, e TRUNCATE ignora RLS por
 * definição. Sem revogá-lo, um usuário logado apaga o espelho inteiro de todos
 * os escritórios de uma vez.
 */
describe("a escrita saiu inteira da mesa do usuário logado", () => {
  it.each([
    ["insert", "datajud_processos"],
    ["update", "datajud_processos"],
    ["delete", "datajud_processos"],
    ["truncate", "datajud_processos"],
    ["truncate", "datajud_recortes"],
  ])("%s em %s não é concedido a authenticated nem anon", (priv, tabela) => {
    const n = sql(`
      select count(*) from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = '${tabela}'
        and grantee in ('authenticated', 'anon')
        and lower(privilege_type) = '${priv}';
    `);
    expect(Number(n)).toBe(0);
  });

  it("mas o SELECT continua concedido — senão o produto não lê o próprio espelho", () => {
    const n = sql(`
      select count(*) from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'datajud_processos'
        and grantee = 'authenticated' and lower(privilege_type) = 'select';
    `);
    expect(Number(n)).toBe(1);
  });
});

/**
 * A data crua ao lado da interpretada. O formato do CNJ (`YYYYMMDDHHMMSS`) não
 * declara fuso, e a suposição de UTC não foi confirmada. Se estiver errada, são
 * 3 horas em toda data — e esta coluna é o que permite corrigir com um `update`
 * em vez de recoletar a base inteira.
 */
describe("o espelho guarda o que permite corrigir sem recoletar", () => {
  it.each(["data_ajuizamento_bruto"])("datajud_processos tem a coluna %s", (col) => {
    const n = sql(`
      select count(*) from information_schema.columns
      where table_schema='public' and table_name='datajud_processos' and column_name='${col}';
    `);
    expect(Number(n)).toBe(1);
  });

  it.each(["ultimo_total", "ultima_coleta_truncada"])(
    "datajud_recortes tem a coluna %s — senão `vistos` mente sobre o tamanho",
    (col) => {
      const n = sql(`
        select count(*) from information_schema.columns
        where table_schema='public' and table_name='datajud_recortes' and column_name='${col}';
      `);
      expect(Number(n)).toBe(1);
    },
  );
});

// O superusuário semeia; as consultas abaixo exercitam o papel e o JWT da aplicação.
const USER_A = "aaaaaaaa-1111-4000-8000-00000000dc01";
const REC_B = "bbbbbbbb-3333-4000-8000-00000000dc02";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER_A}', 'datajud-rls-a@invariant.test');
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_A}', '${ORG_A}', 'admin', now());

    insert into public.datajud_recortes (id, organization_id, rotulo, tribunal, consulta)
      values ('${REC_B}', '${ORG_B}', 'rls-b', 'tjsp', '{}');
    insert into public.datajud_processos (organization_id, recorte_id, datajud_id, tribunal)
      values ('${ORG_A}', '${REC_A}', 'rls-a', 'tjsp'),
             ('${ORG_B}', '${REC_B}', 'rls-b', 'tjsp');

  `);
});

function countAsA(tabela: string, org: string, banco = "postgres"): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${USER_A}"}', false);
    select count(*) from public.${tabela} where organization_id = '${org}';
  `, banco);
  const last = out.split("\n").at(-1);
  if (last === undefined || !/^\d+$/.test(last)) throw new Error(`contagem inválida: ${out}`);
  return Number(last);
}

function provaLeitura(tabela: string, banco = "postgres") {
  expect(countAsA(tabela, ORG_A, banco), `${tabela}: usuário A lê suas linhas`).toBeGreaterThan(0);
  expect(countAsA(tabela, ORG_B, banco), `${tabela}: usuário A lê linhas de B`).toBe(0);
}

describe("RLS com papel authenticated e JWT exclusivo de A", () => {

  describe("datajud_recortes", () => {
    it("A lê suas próprias linhas", () => {
      expect(countAsA("datajud_recortes", ORG_A)).toBeGreaterThan(0);
    });
    it("A não lê linhas de B, com controle positivo", () => {
      expect(Number(sql(`select count(*) from public.datajud_recortes where organization_id='${ORG_B}';`))).toBeGreaterThan(0);
      provaLeitura("datajud_recortes");
    });
    it("A não insere sob a organização B", () => {
      const insert = `insert into public.datajud_recortes (organization_id, rotulo, tribunal, consulta) values ('${ORG_B}', 'rls-insert-b', 'tjsp', '{}');`;
      // A mesma entrada é válida como postgres: FK/NOT NULL não podem simular RLS.
      sql(`begin; ${insert} rollback;`);
      const erro = sqlDeveFalhar(`
        begin;
        set local role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${USER_A}"}', true);
        ${insert}
        rollback;
      `);
      expect(erro).toMatch(/row-level security|permission denied/i);
    });
    it("anon não lê nada", () => {
      const erro = sqlDeveFalhar("set role anon; select count(*) from public.datajud_recortes;");
      expect(erro).toMatch(/permission denied/i);
    });
  });

  describe("datajud_processos", () => {
    it("A lê suas próprias linhas", () => {
      expect(countAsA("datajud_processos", ORG_A)).toBeGreaterThan(0);
    });
    it("A não lê linhas de B, com controle positivo", () => {
      expect(Number(sql(`select count(*) from public.datajud_processos where organization_id='${ORG_B}';`))).toBeGreaterThan(0);
      provaLeitura("datajud_processos");
    });
    it("A não insere sob a organização B", () => {
      const insert = `insert into public.datajud_processos (organization_id, recorte_id, datajud_id, tribunal) values ('${ORG_B}', '${REC_B}', 'rls-insert-b', 'tjsp');`;
      // A mesma entrada é válida como postgres: FK/NOT NULL não podem simular RLS.
      sql(`begin; ${insert} rollback;`);
      const erro = sqlDeveFalhar(`
        begin;
        set local role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${USER_A}"}', true);
        ${insert}
        rollback;
      `);
      expect(erro).toMatch(/row-level security|permission denied/i);
    });
    it("anon não lê nada", () => {
      const erro = sqlDeveFalhar("set role anon; select count(*) from public.datajud_processos;");
      expect(erro).toMatch(/permission denied/i);
    });
  });
});
