import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_SESSION, seedGov } from "./gov-helpers";

/**
 * AdvTec, migration 9008: MENSAGEM DE HISTÓRICO IMPORTADO NÃO DISPARA NADA.
 *
 * O importador sob demanda (`lib/waha/historico.ts`) grava mensagens de meses
 * atrás com `metadata.historico_importado = true`. Medido em 22/10/2026 antes da
 * 9008, numa transação desfeita no banco local: a recebida importada emitia
 * `message.received` e somava +1 na revisão de contexto. O evento é o que push,
 * webhook de saída, campanha, follow-up e o agente escutam: eles agiriam AGORA
 * sobre o passado.
 *
 * Mesma bancada de `reacao-nao-passa-pelos-gatilhos.test.ts`: a conversa começa
 * ENCERRADA, porque é ali que `fn_service_inbound` mostra o efeito (reabre). E
 * cada caso tem o PAR sem a marca, que precisa disparar tudo: sem ele, uma
 * bancada que nunca dispara nada passaria verde.
 */

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});

beforeAll(() => seedGov());
afterAll(async () => pool.end());

async function conversaEncerrada() {
  const contact = randomUUID();
  const conversation = randomUUID();
  await pool.query("insert into contacts(id,organization_id,display_name) values($1,$2,'Histórico')", [contact, GOV_ORG]);
  await pool.query(
    "insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,'open')",
    [conversation, GOV_ORG, contact, GOV_SESSION],
  );
  await pool.query(
    `insert into messages (organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,sent_via,body,sent_at)
     values($1,$2,$3,$4,'text','inbound','received','ai','Fechado, obrigado!',clock_timestamp())`,
    [GOV_ORG, conversation, GOV_SESSION, contact],
  );
  await pool.query("select * from fn_service_status($1,$2,'closed',null)", [GOV_ORG, conversation]);
  return { contact, conversation };
}

/**
 * A data é a MESMA nos dois lados do par (`clock_timestamp()`, como a bancada da
 * reação): medido em 22/10/2026, a mensagem SEM a marca e datada de 90 dias atrás
 * já não reabria a conversa, então com data antiga o par não isolava a marca. Só
 * o último caso usa data antiga, para conferir o que fica gravado.
 */
async function mensagem(args: { conversation: string; contact: string; importada: boolean; direction?: "inbound" | "outbound"; antiga?: boolean }) {
  const id = randomUUID();
  await pool.query(
    `insert into messages
       (id,organization_id,conversation_id,channel_session_id,contact_id,external_id,type,direction,status,sent_via,body,sent_at,metadata)
     values($1,$2,$3,$4,$5,$6,'text',$7,'delivered','external_device','Mensagem de julho',
            ${args.antiga ? "now() - interval '90 days'" : "clock_timestamp()"},$8::jsonb)`,
    [
      id,
      GOV_ORG,
      args.conversation,
      GOV_SESSION,
      args.contact,
      `hist-${id}`,
      args.direction ?? "inbound",
      JSON.stringify(args.importada ? { historico_importado: true } : {}),
    ],
  );
  return id;
}

async function estado(conversation: string) {
  const { rows } = await pool.query(
    "select status, reply_context_revision from conversations where id=$1 and organization_id=$2",
    [conversation, GOV_ORG],
  );
  // `reply_context_revision` é bigint, e o `pg` o devolve como texto.
  const r = rows[0] as { status: string; reply_context_revision: string };
  return { status: r.status, reply_context_revision: Number(r.reply_context_revision) };
}

async function eventosDa(messageId: string): Promise<string[]> {
  const { rows } = await pool.query(
    "select event_type from event_log where organization_id=$1 and entity_id=$2 order by event_type",
    [GOV_ORG, messageId],
  );
  return rows.map((r) => r.event_type as string);
}

describe("histórico importado não é mensagem que acabou de chegar", () => {
  it("recebida importada não emite evento; a mesma sem a marca emite `message.received`", async () => {
    const a = await conversaEncerrada();
    expect(await eventosDa(await mensagem({ ...a, importada: true })), "o passado acordou push, webhook, campanha e agente").toEqual([]);
    const b = await conversaEncerrada();
    expect(await eventosDa(await mensagem({ ...b, importada: false })), "o par sem a marca precisa disparar").toContain("message.received");
  });

  it("enviada importada também não emite evento", async () => {
    const a = await conversaEncerrada();
    expect(await eventosDa(await mensagem({ ...a, importada: true, direction: "outbound" }))).toEqual([]);
  });

  it("não reabre a conversa encerrada; a mesma sem a marca reabre", async () => {
    const a = await conversaEncerrada();
    await mensagem({ ...a, importada: true });
    expect((await estado(a.conversation)).status, "o histórico reabriu a conversa e abriu demanda").toBe("closed");
    const b = await conversaEncerrada();
    await mensagem({ ...b, importada: false });
    expect((await estado(b.conversation)).status, "o par sem a marca precisa reabrir").not.toBe("closed");
  });

  it("não mexe na revisão de contexto; a mesma sem a marca soma", async () => {
    const a = await conversaEncerrada();
    const antesA = (await estado(a.conversation)).reply_context_revision;
    await mensagem({ ...a, importada: true });
    expect((await estado(a.conversation)).reply_context_revision).toBe(antesA);
    const b = await conversaEncerrada();
    const antesB = (await estado(b.conversation)).reply_context_revision;
    await mensagem({ ...b, importada: false });
    expect((await estado(b.conversation)).reply_context_revision).toBeGreaterThan(antesB);
  });

  it("a linha importada continua gravada, com a data de quando foi enviada", async () => {
    const a = await conversaEncerrada();
    const id = await mensagem({ ...a, importada: true, antiga: true });
    const { rows } = await pool.query("select sent_at < now() - interval '80 days' as antiga from messages where id=$1", [id]);
    expect(rows[0]).toEqual({ antiga: true });
  });
});
