import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_SESSION, GOV_VIEWER, seedGov, sql } from "./gov-helpers";

/**
 * AdvTec, migration 9009: A MARCA DE HISTÓRICO IMPORTADO SÓ VALE QUANDO QUEM GRAVA É O SERVIDOR.
 *
 * A 9008 fez os gatilhos de `messages` ignorarem a linha com
 * `metadata.historico_importado = true` (o passado não dispara nada). Mas `messages`
 * tem `GRANT ALL` para `authenticated` e a policy de insert aceita qualquer membro
 * da organização — `viewer` inclusive.
 *
 * Medido na auditoria de 22/10/2026, em Postgres real: SEM a marca, o insert de uma
 * recebida por usuário logado é RECUSADO, porque `message.received` é evento
 * reservado ao servidor (`emit_event` levanta `reserved_message_received`). COM a
 * marca, o gatilho nem tenta emitir — e a "fala do cliente" falsa entrava, gravada,
 * em silêncio. A 9008 abriu esse caminho; não existia antes.
 *
 * A 9009 apaga a marca, ANTES do insert, quando o papel do token não é `service_role`:
 * a linha volta a passar pela trava do evento reservado, e o insert é recusado como
 * sempre foi. Conexão direta ao Postgres (sem token: backend com pool próprio,
 * migration, teste) continua valendo como servidor — só o PostgREST põe
 * `authenticated`/`anon` no token.
 *
 * O par: o `viewer` é recusado COM e SEM a marca (a trava antiga de volta), e o
 * servidor grava a marca e não dispara nada.
 *
 * MUTAÇÃO (22/10/2026): com o `baseline.sql` sem o bloco da 9009, o primeiro caso fica
 * vermelho (a fala falsa entra); os outros três seguem verdes. Caminho real conferido no
 * banco local: pelo cliente de serviço do Supabase (o do importador), a marca fica e a
 * linha não gera evento.
 */

beforeAll(() => seedGov());

/** Uma conversa nova da organização de governança, como o postgres. */
function conversa(): { contact: string; conversation: string } {
  const contact = randomUUID();
  const conversation = randomUUID();
  sql(`
    insert into contacts(id, organization_id, display_name) values ('${contact}', '${GOV_ORG}', 'Marca');
    insert into conversations(id, organization_id, contact_id, channel_session_id, status)
      values ('${conversation}', '${GOV_ORG}', '${contact}', '${GOV_SESSION}', 'open');
  `);
  return { contact, conversation };
}

/**
 * Insere uma recebida marcada como importada no papel pedido e devolve o que ficou:
 * a marca gravada e os eventos da linha.
 */
function insereMarcada(
  papel: "authenticated" | "service_role" | "sem_token",
  marcada = true,
): { marca: string; eventos: string; id: string } {
  const { contact, conversation } = conversa();
  const id = randomUUID();
  const metadata = marcada ? `'{"historico_importado": true}'::jsonb` : `'{}'::jsonb`;
  const comoQuem =
    papel === "authenticated"
      ? `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${GOV_VIEWER}","role":"authenticated"}', false);`
      : papel === "service_role"
        ? `set role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', false);`
        : `select set_config('request.jwt.claims', '', false);`;
  const out = sql(`
    ${comoQuem}
    insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id, external_id,
                          type, direction, status, sent_via, body, sent_at, metadata)
      values ('${id}', '${GOV_ORG}', '${conversation}', '${GOV_SESSION}', '${contact}', 'marca-${id}',
              'text', 'inbound', 'delivered', 'external_device', 'Mensagem falsa do cliente', clock_timestamp(),
              ${metadata});
    reset role;
    select set_config('request.jwt.claims', '', false);
    select coalesce(metadata->>'historico_importado', '(sem marca)') from messages where id = '${id}';
    select coalesce(string_agg(event_type, ',' order by event_type), '(nenhum)') from event_log
      where organization_id = '${GOV_ORG}' and entity_id = '${id}';
  `);
  const linhas = out.split("\n").filter((l) => l && !/^(SET|RESET|INSERT)/.test(l) && l !== "");
  return { marca: linhas.at(-2)!, eventos: linhas.at(-1)!, id };
}

/** O insert do papel pedido falhou? Devolve a mensagem do erro, ou `null` se gravou. */
function erroDoInsert(papel: "authenticated", marcada: boolean): string | null {
  try {
    insereMarcada(papel, marcada);
    return null;
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e);
  }
}

const gravadas = () =>
  Number(sql(`select count(*) from messages where organization_id = '${GOV_ORG}' and body = 'Mensagem falsa do cliente' and sent_via = 'external_device' and metadata ? 'historico_importado' and direction = 'inbound' and created_at > now() - interval '1 hour' and conversation_id in (select id from conversations where organization_id = '${GOV_ORG}')`).split("\n").at(-1));

describe("a marca de importado só vale quando quem grava é o servidor", () => {
  it("membro logado (viewer) NÃO insere fala de cliente pela API, nem com a marca: a trava do evento reservado volta a valer", () => {
    const antes = gravadas();
    const comMarca = erroDoInsert("authenticated", true);
    expect(comMarca, "a fala falsa do cliente entrou, em silêncio, pela marca de importado").toMatch(/reserved_message_received/);
    expect(gravadas(), "a linha ficou gravada mesmo com o erro").toBe(antes);
  });

  it("o par: sem a marca, o mesmo insert sempre foi recusado (a trava antiga)", () => {
    expect(erroDoInsert("authenticated", false)).toMatch(/reserved_message_received/);
  });

  it("o servidor (service_role) grava a marca e a mensagem importada não dispara nada", () => {
    const r = insereMarcada("service_role");
    expect(r.marca).toBe("true");
    expect(r.eventos).toBe("(nenhum)");
  });

  it("conexão direta, sem token (backend com pool próprio, migration): vale como servidor", () => {
    const r = insereMarcada("sem_token");
    expect(r.marca).toBe("true");
    expect(r.eventos).toBe("(nenhum)");
  });
});
