import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Coleta do DJEN — isolamento entre escritórios e escrita fora da mesa.
 *
 * A spec 0006, critério 8, exige que a publicação de um escritório não apareça
 * para outro. O ticket 0006.E1 tinha 12 testes de unidade e **nenhum tocava
 * banco** — e RLS, `unique` e `grant` não existem em `Map`.
 *
 * A tabela guarda a prova do prazo. Se ela vazar, vaza intimação de cliente
 * alheio; se ela for apagada, o escritório perde a única evidência de que a
 * publicação chegou.
 *
 * Roda no container efêmero do `scripts/test-db.sh`, com `baseline.sql` já
 * aplicado:  TEST_DB_PORT=64329 pnpm test:db
 *
 * MUTAÇÃO RLS (13/10/2026): em cópia descartável do banco, DISABLE ROW LEVEL
 * SECURITY em djen_publicacoes fez provaLeitura acusar linhas de B para A;
 * o teste "mutação: desligar RLS em cópia descartável acusa leitura de B"
 * confirmou a falha e descartou a cópia. As cinco tabelas passaram como
 * authenticated + JWT exclusivo de A (45 testes nos dois arquivos).
 *
 * MUTAÇÃO (19/08/2026): removendo `truncate` do `revoke` da migration 9001,
 * fica vermelho "truncate em djen_publicacoes não é concedido". Sem ela, um
 * usuário logado apaga a prova de prazo de TODOS os escritórios — `TRUNCATE`
 * ignora RLS por definição.
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

const ORG_A = "aaaaaaaa-0000-4000-8000-00000000de01";
const ORG_B = "bbbbbbbb-0000-4000-8000-00000000de02";

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_A}', 'djen-inv-a', 'DJEN Invariant A', 'DJEN A'),
             ('${ORG_B}', 'djen-inv-b', 'DJEN Invariant B', 'DJEN B')
      on conflict (id) do nothing;

    insert into public.djen_publicacoes
      (organization_id, djen_id, texto, data_disponibilizacao, oabs)
      values
      ('${ORG_A}', 700001, 'Intimação do escritório A', '2026-08-19',
       '[{"numero":"1111","uf":"CE"}]'::jsonb),
      ('${ORG_B}', 700002, 'Intimação do escritório B', '2026-08-19',
       '[{"numero":"2222","uf":"SP"}]'::jsonb)
      on conflict do nothing;
  `);
});

describe("a publicação de um escritório não é do outro", () => {
  it("cada escritório tem exatamente a sua", () => {
    const a = sql(`select count(*) from public.djen_publicacoes where organization_id='${ORG_A}' and djen_id=700001;`);
    const b = sql(`select count(*) from public.djen_publicacoes where organization_id='${ORG_A}' and djen_id=700002;`);
    expect(Number(a)).toBe(1);
    expect(Number(b)).toBe(0);
  });

  it("o mesmo djen_id em DOIS escritórios é permitido — a unicidade é por escritório", () => {
    // A mesma publicação do DJEN pode intimar advogados de escritórios
    // diferentes. Unicidade global recusaria a segunda e o escritório B
    // perderia o prazo sem erro nenhum.
    sql(`
      insert into public.djen_publicacoes (organization_id, djen_id, texto, data_disponibilizacao)
      values ('${ORG_B}', 700001, 'a mesma publicação, outro escritório', '2026-08-19')
      on conflict do nothing;
    `);
    const n = sql(`select count(*) from public.djen_publicacoes where djen_id=700001;`);
    expect(Number(n)).toBe(2);
  });

  it("a mesma publicação DUAS vezes no mesmo escritório é recusada", () => {
    const erro = sqlDeveFalhar(`
      insert into public.djen_publicacoes (organization_id, djen_id, texto, data_disponibilizacao)
      values ('${ORG_A}', 700001, 'duplicata', '2026-08-19');
    `);
    expect(erro).toMatch(/djen_publicacao_unica|duplicate key|duplicada/i);
  });
});

/**
 * O texto é a prova. `not null` existe para a publicação continuar legível com
 * a API do CNJ fora do ar — que é o dia em que ela mais importa.
 */
describe("a publicação não entra sem o teor", () => {
  it("sem texto, o banco recusa", () => {
    const erro = sqlDeveFalhar(`
      insert into public.djen_publicacoes (organization_id, djen_id, data_disponibilizacao)
      values ('${ORG_A}', 700099, '2026-08-19');
    `);
    expect(erro).toMatch(/texto|not-null|null value/i);
  });
});

describe("a escrita saiu inteira da mesa do usuário logado", () => {
  it.each([
    ["insert", "djen_publicacoes"],
    ["update", "djen_publicacoes"],
    ["delete", "djen_publicacoes"],
    ["truncate", "djen_publicacoes"],
    ["truncate", "djen_oabs_monitoradas"],
  ])("%s em %s não é concedido a authenticated nem anon", (priv, tabela) => {
    const n = sql(`
      select count(*) from information_schema.role_table_grants
      where table_schema='public' and table_name='${tabela}'
        and grantee in ('authenticated','anon') and lower(privilege_type)='${priv}';
    `);
    expect(Number(n)).toBe(0);
  });

  it("mas o SELECT continua — senão o escritório não lê o próprio prazo", () => {
    const n = sql(`
      select count(*) from information_schema.role_table_grants
      where table_schema='public' and table_name='djen_publicacoes'
        and grantee='authenticated' and lower(privilege_type)='select';
    `);
    expect(Number(n)).toBe(1);
  });
});

/** Uma publicação, N advogados — e a busca por advogado tem de ser indexada. */
describe("as OABs intimadas cabem todas na mesma linha", () => {
  it("a coluna é jsonb e aceita duas OABs", () => {
    sql(`
      insert into public.djen_publicacoes (organization_id, djen_id, texto, data_disponibilizacao, oabs)
      values ('${ORG_A}', 700003, 'dois advogados intimados', '2026-08-19',
              '[{"numero":"1111","uf":"CE"},{"numero":"3333","uf":"CE"}]'::jsonb)
      on conflict do nothing;
    `);
    const n = sql(`select jsonb_array_length(oabs) from public.djen_publicacoes
                   where organization_id='${ORG_A}' and djen_id=700003;`);
    expect(Number(n)).toBe(2);
  });

  it("existe índice GIN — a tela pergunta 'quais são do advogado X'", () => {
    const n = sql(`
      select count(*) from pg_indexes
      where schemaname='public' and tablename='djen_publicacoes' and indexdef ilike '%gin%oabs%';
    `);
    expect(Number(n)).toBe(1);
  });
});

// O superusuário semeia; as consultas abaixo exercitam o papel e o JWT da aplicação.
const USER_A = "aaaaaaaa-1111-4000-8000-00000000de01";


beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER_A}', 'djen-rls-a@invariant.test');
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_A}', '${ORG_A}', 'admin', now());

    insert into public.djen_oabs_monitoradas (organization_id, numero, uf)
      values ('${ORG_A}', 'rls-a', 'CE'), ('${ORG_B}', 'rls-b', 'SP');
    insert into public.djen_coletas (organization_id) values ('${ORG_A}'), ('${ORG_B}');

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

  describe("djen_oabs_monitoradas", () => {
    it("A lê suas próprias linhas", () => {
      expect(countAsA("djen_oabs_monitoradas", ORG_A)).toBeGreaterThan(0);
    });
    it("A não lê linhas de B, com controle positivo", () => {
      expect(Number(sql(`select count(*) from public.djen_oabs_monitoradas where organization_id='${ORG_B}';`))).toBeGreaterThan(0);
      provaLeitura("djen_oabs_monitoradas");
    });
    it("A não insere sob a organização B", () => {
      const insert = `insert into public.djen_oabs_monitoradas (organization_id, numero, uf) values ('${ORG_B}', 'rls-insert-b', 'CE');`;
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
      const erro = sqlDeveFalhar("set role anon; select count(*) from public.djen_oabs_monitoradas;");
      expect(erro).toMatch(/permission denied/i);
    });
  });

  describe("djen_publicacoes", () => {
    it("A lê suas próprias linhas", () => {
      expect(countAsA("djen_publicacoes", ORG_A)).toBeGreaterThan(0);
    });
    it("A não lê linhas de B, com controle positivo", () => {
      expect(Number(sql(`select count(*) from public.djen_publicacoes where organization_id='${ORG_B}';`))).toBeGreaterThan(0);
      provaLeitura("djen_publicacoes");
    });
    it("A não insere sob a organização B", () => {
      const insert = `insert into public.djen_publicacoes (organization_id, djen_id, texto, data_disponibilizacao) values ('${ORG_B}', 799999, 'controle de insert', '2026-10-13');`;
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
      const erro = sqlDeveFalhar("set role anon; select count(*) from public.djen_publicacoes;");
      expect(erro).toMatch(/permission denied/i);
    });
  });

  describe("djen_coletas", () => {
    it("A lê suas próprias linhas", () => {
      expect(countAsA("djen_coletas", ORG_A)).toBeGreaterThan(0);
    });
    it("A não lê linhas de B, com controle positivo", () => {
      expect(Number(sql(`select count(*) from public.djen_coletas where organization_id='${ORG_B}';`))).toBeGreaterThan(0);
      provaLeitura("djen_coletas");
    });
    it("A não insere sob a organização B", () => {
      const insert = `insert into public.djen_coletas (organization_id) values ('${ORG_B}');`;
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
      const erro = sqlDeveFalhar("set role anon; select count(*) from public.djen_coletas;");
      expect(erro).toMatch(/permission denied/i);
    });
  });
});

it("mutação: desligar RLS em cópia descartável acusa leitura de B", () => {
  const banco = "advtec_mutacao_rls";
  sql(`create database ${banco} template postgres;`);
  try {
    sql("alter table public.djen_publicacoes disable row level security;", banco);
    expect(countAsA("djen_publicacoes", ORG_B, banco)).toBeGreaterThan(0);
    expect(() => provaLeitura("djen_publicacoes", banco)).toThrow(/usuário A lê linhas de B/);
  } finally {
    sql(`drop database ${banco};`);
  }
});

/**
 * 0006.E5 — prazo confirmado (migration 9006). A confirmação é tudo ou nada: a
 * data final e o momento da confirmação andam juntos. Sem isso, uma linha com
 * data e sem confirmação apareceria como "vence em" sem ninguém ter conferido —
 * exatamente o que a spec 0006, critério 5, proíbe.
 *
 * MUTAÇÃO (21/10/2026): tirar a primeira metade do check da 9006 numa cópia
 * descartável deixa passar data sem confirmação — ver o teste abaixo.
 */
describe("prazo confirmado: data e confirmação andam juntas", () => {
  it("data final sem o momento da confirmação é recusada", () => {
    const erro = sqlDeveFalhar(`
      update public.djen_publicacoes set prazo_vence_em = '2026-11-05'
       where organization_id='${ORG_A}' and djen_id=700001;
    `);
    expect(erro).toMatch(/djen_publicacao_prazo_confirmado_completo/);
  });

  it("confirmação sem data final é recusada", () => {
    const erro = sqlDeveFalhar(`
      update public.djen_publicacoes set prazo_confirmado_em = now()
       where organization_id='${ORG_A}' and djen_id=700001;
    `);
    expect(erro).toMatch(/djen_publicacao_prazo_confirmado_completo/);
  });

  it("observação acima de 300 caracteres é recusada", () => {
    const erro = sqlDeveFalhar(`
      update public.djen_publicacoes
         set prazo_vence_em = '2026-11-05', prazo_confirmado_em = now(), prazo_observacao = repeat('x', 301)
       where organization_id='${ORG_A}' and djen_id=700001;
    `);
    expect(erro).toMatch(/djen_publicacao_prazo_confirmado_completo/);
  });

  it("data e confirmação juntas entram; limpar as duas juntas também é aceito", () => {
    sql(`
      update public.djen_publicacoes
         set prazo_vence_em = '2026-11-05', prazo_confirmado_em = now(), prazo_observacao = 'conferido'
       where organization_id='${ORG_A}' and djen_id=700001;
    `);
    expect(sql(`select prazo_vence_em from public.djen_publicacoes where organization_id='${ORG_A}' and djen_id=700001;`)).toBe("2026-11-05");
    sql(`
      update public.djen_publicacoes set prazo_vence_em = null, prazo_confirmado_em = null, prazo_observacao = null
       where organization_id='${ORG_A}' and djen_id=700001;
    `);
  });

  it("o usuário logado não grava a confirmação direto: a escrita é da rota, com service role", () => {
    const pode = sql(
      `select has_column_privilege('authenticated', 'public.djen_publicacoes', 'prazo_vence_em', 'UPDATE');`,
    );
    expect(pode).toBe("f");
  });

  it("mutação: sem a primeira metade do check, data sem confirmação passaria", () => {
    const banco = "djen_mut_9006";
    sql(`drop database if exists ${banco};`);
    sql(`create database ${banco} template postgres;`);
    try {
      sql(
        `alter table public.djen_publicacoes drop constraint djen_publicacao_prazo_confirmado_completo;
         alter table public.djen_publicacoes add constraint djen_publicacao_prazo_confirmado_completo
           check (prazo_observacao is null or length(prazo_observacao) <= 300);
         update public.djen_publicacoes set prazo_vence_em = '2026-11-05'
          where organization_id='${ORG_A}' and djen_id=700001;`,
        banco,
      );
      const n = sql(`select count(*) from public.djen_publicacoes where prazo_vence_em is not null and prazo_confirmado_em is null;`, banco);
      expect(Number(n)).toBe(1);
    } finally {
      sql(`drop database ${banco};`);
    }
  });
});
