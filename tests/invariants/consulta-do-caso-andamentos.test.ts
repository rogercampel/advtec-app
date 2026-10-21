/**
 * Spec 0010.E2 — a ferramenta de consulta do caso, num Postgres de verdade.
 *
 * Critério 2: a ferramenta de um contato nunca devolve publicação de caso de
 * outro contato, nem de outro escritório — com dois contatos e dois
 * `organization_id`. E o que ela devolve tem data e tipo de ato (insumo do
 * critério 3).
 *
 * MUTAÇÕES (20/10/2026): tirar `organization_id = $1` faz "mesmo número em
 * outro escritório" acusar; tirar `descartada_em is null` faz "descartada"
 * acusar; tirar o `limit` faz "no máximo N" acusar; trocar o `to_char` por
 * `data_disponibilizacao` faz "data em texto" acusar (o pg devolve `Date`).
 *
 * Roda em `pnpm test:db`.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { consultaDoCaso } from "@/lib/djen/consulta-do-caso";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});
afterAll(() => pool.end());

const NUM_MARIA = "0001234-56.2026.8.26.0100";
const NUM_JOAO = "0009999-00.2026.8.26.0100";
let djenId = 810000;

async function escritorio() {
  const org = randomUUID();
  const pipeline = randomUUID();
  const stage = randomUUID();
  await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'Esc','Esc')", [org]);
  await pool.query("insert into crm_pipelines(id,organization_id,name,slug) values($1::uuid,$2,'Casos',$1::text)", [pipeline, org]);
  await pool.query(
    "insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values($1,$2,$3,'Andamento','andamento',1)",
    [stage, org, pipeline],
  );
  return {
    org,
    contato: async () => {
      const id = randomUUID();
      await pool.query("insert into contacts(id,organization_id) values($1,$2)", [id, org]);
      return id;
    },
    caso: async (contactId: string, numero: string, extra: Record<string, unknown> = {}) => {
      await pool.query(
        "insert into crm_leads(organization_id,pipeline_id,stage_id,contact_id,title,custom_fields) values($1,$2,$3,$4,'Caso',$5)",
        [org, pipeline, stage, contactId, { numero_processo: numero, ...extra }],
      );
    },
    publica: async (numero: string, data: string, texto: string, descartada = false) => {
      djenId += 1;
      await pool.query(
        `insert into djen_publicacoes(organization_id,djen_id,numero_processo,data_disponibilizacao,texto,sigla_tribunal,
                                      descartada_em,descartada_motivo)
         values($1,$2,$3,$4,$5,'TJSP',$6,$7)`,
        [org, djenId, numero, data, texto, descartada ? new Date() : null, descartada ? "homônimo" : null],
      );
    },
  };
}

let A: Awaited<ReturnType<typeof escritorio>>;
let B: Awaited<ReturnType<typeof escritorio>>;
let maria = "";
let joao = "";
let semCaso = "";

beforeAll(async () => {
  A = await escritorio();
  B = await escritorio();
  maria = await A.contato();
  joao = await A.contato();
  semCaso = await A.contato();
  await A.caso(maria, NUM_MARIA);
  await A.caso(joao, NUM_JOAO);
  // Pontuação diferente da do caso: casa pelos dígitos.
  await A.publica("00012345620268260100", "2026-10-15", "DESPACHO. Intime-se a parte autora para réplica.");
  await A.publica(NUM_MARIA, "2026-10-01", "SENTENÇA. Julgo procedente o pedido.");
  await A.publica(NUM_MARIA, "2026-10-18", "Publicação de homônimo, descartada.", true);
  await A.publica(NUM_JOAO, "2026-10-19", "DECISÃO. Defiro a tutela.");
  // Mesmo número da Maria, em OUTRO escritório.
  await B.publica(NUM_MARIA, "2026-10-19", "DECISÃO de outro escritório.");
});

describe("consultaDoCaso", () => {
  it("devolve só as publicações dos casos da Maria, da mais nova para a mais antiga", async () => {
    const r = await consultaDoCaso(pool, { organizationId: A.org, contactId: maria });
    expect(r.casos).toHaveLength(1);
    expect(r.andamentos.map((a) => [a.data, a.tipoDeAto])).toEqual([
      ["2026-10-15", "despacho"],
      ["2026-10-01", "sentença"],
    ]);
  });

  it("critério 2: nem o caso do João, nem a publicação do mesmo número em outro escritório, nem a descartada", async () => {
    const r = await consultaDoCaso(pool, { organizationId: A.org, contactId: maria });
    const textos = JSON.stringify(r.andamentos);
    expect(textos).not.toMatch(/tutela|outro escritório|homônimo/);
  });

  it("o João vê só o dele", async () => {
    const r = await consultaDoCaso(pool, { organizationId: A.org, contactId: joao });
    expect(r.andamentos.map((a) => a.tipoDeAto)).toEqual(["decisão"]);
  });

  it("contato de A consultado como se fosse de B não devolve nada", async () => {
    const r = await consultaDoCaso(pool, { organizationId: B.org, contactId: maria });
    expect(r).toEqual({ casos: [], andamentos: [], sigiloso: false });
  });

  it("critério 1: contato sem caso não recebe publicação nenhuma", async () => {
    expect(await consultaDoCaso(pool, { organizationId: A.org, contactId: semCaso })).toEqual({ casos: [], andamentos: [], sigiloso: false });
  });

  it("todo andamento tem data em texto e trecho do tipo de ato", async () => {
    const r = await consultaDoCaso(pool, { organizationId: A.org, contactId: maria });
    for (const a of r.andamentos) {
      expect(a.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.trecho).toBeTruthy();
      expect(a.siglaTribunal).toBe("TJSP");
    }
  });

  it("no máximo N publicações", async () => {
    const r = await consultaDoCaso(pool, { organizationId: A.org, contactId: maria }, 1);
    expect(r.andamentos.map((a) => a.data)).toEqual(["2026-10-15"]);
  });
});

/**
 * Spec 0010.E4 — critério 5: caso em segredo de justiça nunca é descrito pelo
 * WhatsApp. A consulta fecha inteira (`sigiloso: true`, nenhum andamento).
 *
 * MUTAÇÕES (20/10/2026): tirar o `casos.some(c => c.sigiloso)` faz "caso
 * marcado" acusar; tirar o `textoFalaDeSigilo` faz "publicação que fala em
 * segredo" acusar.
 */
describe("sigilo", () => {
  const NUM_CARLA = "0005555-55.2026.8.26.0100";
  const NUM_PEDRO = "0006666-66.2026.8.26.0100";
  const NUM_ANA_ABERTO = "0008888-88.2026.8.26.0100";
  let carla = "";
  let pedro = "";
  let ana = "";

  beforeAll(async () => {
    carla = await A.contato();
    pedro = await A.contato();
    ana = await A.contato();
    await A.caso(carla, NUM_CARLA, { segredo_de_justica: true });
    await A.publica(NUM_CARLA, "2026-10-19", "DECISÃO. Guarda provisória deferida à genitora.");
    await A.caso(pedro, NUM_PEDRO);
    await A.publica(NUM_PEDRO, "2026-10-19", "DESPACHO. Processo que tramita em SEGREDO DE JUSTIÇA. Intimem-se.");
    await A.caso(ana, NUM_ANA_ABERTO);
    await A.caso(ana, "0004444-44.2026.8.26.0100", { segredo_de_justica: "sim" });
    await A.publica(NUM_ANA_ABERTO, "2026-10-19", "DESPACHO. Cite-se.");
  });

  it("caso marcado no negócio: nenhum andamento, e o sinal para passar a humano", async () => {
    const r = await consultaDoCaso(pool, { organizationId: A.org, contactId: carla });
    expect(r.sigiloso).toBe(true);
    expect(r.andamentos).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/guarda|genitora/i);
  });

  it("publicação que fala em segredo de justiça fecha a consulta, mesmo sem marca no negócio", async () => {
    const r = await consultaDoCaso(pool, { organizationId: A.org, contactId: pedro });
    expect(r).toMatchObject({ sigiloso: true, andamentos: [] });
  });

  it("um caso sigiloso fecha a consulta inteira do contato, inclusive o caso aberto", async () => {
    const r = await consultaDoCaso(pool, { organizationId: A.org, contactId: ana });
    expect(r).toMatchObject({ sigiloso: true, andamentos: [] });
  });

  it("controle: caso sem marca e sem menção a sigilo continua consultável", async () => {
    const r = await consultaDoCaso(pool, { organizationId: A.org, contactId: maria });
    expect(r.sigiloso).toBe(false);
    expect(r.andamentos.length).toBeGreaterThan(0);
  });
});
