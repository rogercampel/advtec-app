/**
 * Spec 0010.E3 — a ferramenta `consultar_andamento` do agente, num Postgres real.
 *
 * A pergunta vem do banco (última mensagem RECEBIDA desta conversa, deste
 * contato), nunca do modelo:
 *   - critério 6: sem mensagem do cliente na conversa, nada sai;
 *   - critério 4: pergunta de mérito vai para humano, com publicação disponível;
 *   - mensagem enviada (outbound) e mensagem de outra conversa não contam.
 *
 * MUTAÇÕES (20/10/2026): tirar `m.direction = 'inbound'` faz "a resposta do
 * escritório não conta como pergunta" acusar; tirar `c.contact_id = $3` faz
 * "conversa de outro contato" acusar.
 *
 * Roda em `pnpm test:db`.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { executaConsultarAndamento, ultimaPerguntaDoCliente } from "@/lib/djen/ferramenta-do-agente";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});
afterAll(() => pool.end());

const NUM = "0001234-56.2026.8.26.0100";
const org = randomUUID();
const sessao = randomUUID();
const maria = randomUUID();
const joao = randomUUID();
const conversaMaria = randomUUID();
const conversaJoao = randomUUID();
const CONTINUACAO = { primeiraResposta: false };

async function mensagem(conversa: string, contato: string, direcao: "inbound" | "outbound", corpo: string, segundos: number) {
  await pool.query(
    `insert into messages(organization_id,conversation_id,channel_session_id,contact_id,type,direction,body,created_at)
     values($1,$2,$3,$4,'text',$5,$6, now() - make_interval(secs => $7))`,
    [org, conversa, sessao, contato, direcao, corpo, segundos],
  );
}

beforeAll(async () => {
  const pipeline = randomUUID();
  const stage = randomUUID();
  await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'Esc','Esc')", [org]);
  await pool.query("insert into crm_pipelines(id,organization_id,name,slug) values($1::uuid,$2,'Casos',$1::text)", [pipeline, org]);
  await pool.query(
    "insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values($1,$2,$3,'Andamento','andamento',1)",
    [stage, org, pipeline],
  );
  for (const c of [maria, joao]) await pool.query("insert into contacts(id,organization_id) values($1,$2)", [c, org]);
  await pool.query(
    "insert into crm_leads(organization_id,pipeline_id,stage_id,contact_id,title,custom_fields) values($1,$2,$3,$4,'Caso',$5)",
    [org, pipeline, stage, maria, { numero_processo: NUM }],
  );
  await pool.query(
    `insert into djen_publicacoes(organization_id,djen_id,numero_processo,data_disponibilizacao,texto,sigla_tribunal)
     values($1,820001,$2,'2026-10-15','DESPACHO. Intime-se a parte autora para réplica.','TJSP')`,
    [org, NUM],
  );
  await pool.query(
    `insert into channel_sessions(id,organization_id,provider,waha_session_name,status,webhook_secret_encrypted)
     values($1,$2,'waha',$3,'WORKING','\\x00'::bytea)`,
    [sessao, org, `consulta-${sessao}`],
  );
  await pool.query(
    "insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,'open'),($5,$2,$6,$4,'open')",
    [conversaMaria, org, maria, sessao, conversaJoao, joao],
  );
});

const quemMaria = () => ({ organizationId: org, contactId: maria, conversationId: conversaMaria });

describe("a pergunta vem do banco", () => {
  it("critério 6: sem mensagem do cliente na conversa, passa para humano sem consultar", async () => {
    expect(await executaConsultarAndamento(pool, quemMaria(), CONTINUACAO)).toEqual({
      acao: "passar_para_humano",
      motivo: "sem_mensagem",
    });
  });

  it("a resposta do escritório (outbound) não conta como pergunta", async () => {
    await mensagem(conversaMaria, maria, "outbound", "Olá! Em que posso ajudar?", 300);
    expect(await ultimaPerguntaDoCliente(pool, quemMaria())).toBe("");
  });

  it("conversa de outro contato não vale para a Maria", async () => {
    await mensagem(conversaJoao, joao, "inbound", "Como está meu processo?", 200);
    expect(await ultimaPerguntaDoCliente(pool, { ...quemMaria(), conversationId: conversaJoao })).toBe("");
  });

  it("com a pergunta da Maria, a sugestão cita data e ato", async () => {
    await mensagem(conversaMaria, maria, "inbound", "Bom dia, como está meu processo?", 100);
    const d = await executaConsultarAndamento(pool, quemMaria(), CONTINUACAO);
    expect(d.acao).toBe("sugerir");
    if (d.acao === "sugerir") expect(d.texto).toContain("15/10/2026: saiu um despacho no TJSP");
  });

  it("critério 4: a última pergunta é de mérito — humano, mesmo com publicação", async () => {
    await mensagem(conversaMaria, maria, "inbound", "Eu ganho essa causa?", 10);
    expect(await executaConsultarAndamento(pool, quemMaria(), CONTINUACAO)).toEqual({
      acao: "passar_para_humano",
      motivo: "pergunta_de_merito",
    });
  });
});
