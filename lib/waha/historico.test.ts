import { describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

import {
  PAGINA_DO_CANAL,
  chatIdSemNonoDigito,
  chatIdsDoContato,
  importarHistoricoDaConversa,
  linhasNovas,
  type Destino,
} from "@/lib/waha/historico";

/**
 * AdvTec — importação sob demanda do histórico do WhatsApp.
 * Os payloads seguem a FORMA medida no WAHA local em 22/10/2026 (NOWEB:
 * `id` = `<fromMe>_<chat>_<id>`, `timestamp` em segundos, `_data.message`), com
 * dados sintéticos.
 */

const D: Destino = { organizationId: "org-a", conversationId: "conv-1", contactId: "ct-1", channelSessionId: "ses-1" };
const AGORA = "2026-10-22T15:00:00.000Z";
const CHAT = "558699990000@s.whatsapp.net";

const msg = (o: Record<string, unknown>) => ({
  id: `false_${CHAT}_AAA1`,
  timestamp: 1753366277, // 2025-07-24T14:11:17Z
  from: CHAT,
  fromMe: false,
  body: "Bom dia, doutor",
  hasMedia: false,
  ack: 2,
  _data: { message: { conversation: "Bom dia, doutor" } },
  ...o,
});

describe("o endereço do chat", () => {
  it("o cadastro decide: lid primeiro, depois o número como está gravado", () => {
    expect(chatIdsDoContato({ phone_number: "+558632210000", wa_lid: "1234567@lid" })).toEqual(["1234567@lid", "558632210000@c.us"]);
    expect(chatIdsDoContato({ phone_number: null, wa_lid: null })).toEqual([]);
  });
  it("celular BR com nono dígito tem a forma antiga, sem o 9 (medido: com o 9, 0 mensagens; sem, 27)", () => {
    expect(chatIdSemNonoDigito({ phone_number: "+5586999990000", wa_lid: null })).toBe("558699990000@c.us");
    expect(chatIdSemNonoDigito({ phone_number: "+558632210000", wa_lid: null })).toBeNull();
  });
});

describe("as linhas que entram", () => {
  it("recebida: id completo, direção, data de quando foi enviada (também em created_at) e a marca que cala os gatilhos", () => {
    const [l] = linhasNovas([msg({})], D, new Set(), AGORA);
    expect(l).toMatchObject({
      organization_id: "org-a",
      conversation_id: "conv-1",
      contact_id: "ct-1",
      channel_session_id: "ses-1",
      external_id: `false_${CHAT}_AAA1`,
      direction: "inbound",
      status: "delivered",
      body: "Bom dia, doutor",
      sent_at: "2025-07-24T14:11:17.000Z",
      created_at: "2025-07-24T14:11:17.000Z",
      delivered_at: "2025-07-24T14:11:17.000Z",
      metadata: { historico_importado: true },
    });
  });

  it("enviada pelo celular: a CAUDA do id, como o eco grava, e o status do ack", () => {
    const [l] = linhasNovas([msg({ id: `true_${CHAT}_BBB2`, fromMe: true, ack: 3 })], D, new Set(), AGORA);
    expect(l).toMatchObject({ external_id: "BBB2", direction: "outbound", status: "read", delivered_at: null });
  });

  it("o que já está gravado não entra de novo — comparado pela CAUDA", () => {
    const linhas = linhasNovas([msg({}), msg({ id: `true_${CHAT}_BBB2`, fromMe: true }), msg({ id: `false_${CHAT}_CCC3` })], D, new Set(["AAA1", "BBB2"]), AGORA);
    expect(linhas.map((l) => l.external_id)).toEqual([`false_${CHAT}_CCC3`]);
  });

  it("a mesma mensagem com o chat em OUTRA forma (@lid num dia, @c.us no outro) entra uma vez só", () => {
    const pelaLid = msg({ id: "false_99887766@lid_AAA1" });
    const peloNumero = msg({ id: "false_558699990000@c.us_AAA1" });
    expect(linhasNovas([pelaLid, peloNumero], D, new Set(), AGORA)).toHaveLength(1);
  });

  it("reação, modelo comercial sem texto e payload inválido ficam de fora; arquivo sem legenda entra", () => {
    const reacao = msg({ id: `false_${CHAT}_R1`, type: "reaction", body: "👍" });
    const modelo = msg({ id: `false_${CHAT}_T1`, body: null, _data: { message: { templateMessage: {} } } });
    const invalido = { id: 42 };
    const foto = msg({ id: `false_${CHAT}_F1`, body: null, hasMedia: true, _data: { message: { imageMessage: {} } } });
    const linhas = linhasNovas([reacao, modelo, invalido, foto], D, new Set(), AGORA);
    expect(linhas.map((l) => [l.external_id, l.type])).toEqual([[`false_${CHAT}_F1`, "image"]]);
  });
});

/** Banco falso: registra cada filtro por tabela e responde com o que a bancada manda. */
function bancada(opts: { gravadas?: string[]; conflitoNoLote?: boolean; telefone?: string; lid?: string | null } = {}) {
  const filtros: Array<{ tabela: string; filtros: Array<[string, unknown]> }> = [];
  const inseridas: Array<Record<string, unknown>> = [];
  const respostas: Record<string, unknown> = {
    conversations: { id: "conv-1", contact_id: "ct-1", channel_session_id: "ses-1", is_group: false },
    contacts: { phone_number: opts.telefone ?? "+5586999990000", wa_lid: opts.lid ?? null },
    channel_sessions: { waha_session_name: "sessao-a" },
  };
  let lote = true;
  const admin = {
    from(tabela: string) {
      const c = { tabela, filtros: [] as Array<[string, unknown]> };
      filtros.push(c);
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { c.filtros.push([k, v]); return q; },
        not: () => q,
        limit: async () => ({ data: (opts.gravadas ?? []).map((external_id) => ({ external_id })), error: null }),
        maybeSingle: async () => ({ data: respostas[tabela] ?? null, error: null }),
        insert(linhas: Record<string, unknown> | Record<string, unknown>[]) {
          const lista = Array.isArray(linhas) ? linhas : [linhas];
          const eLote = Array.isArray(linhas);
          const res = () => {
            if (eLote && opts.conflitoNoLote && lote) { lote = false; return { data: null, error: { code: "23505", message: "dup" } }; }
            const novas = lista.filter((l) => !(opts.gravadas ?? []).includes(l.external_id as string));
            if (!eLote && novas.length === 0) return { data: null, error: { code: "23505", message: "dup" } };
            inseridas.push(...novas);
            return { data: novas.map((_, i) => ({ id: `m${i}` })), error: null };
          };
          return Object.assign(Promise.resolve(res()), { select: async () => res() });
        },
      };
      return q;
    },
  };
  return { admin: admin as never, filtros, inseridas };
}

describe("importarHistoricoDaConversa", () => {
  it("toda consulta ao banco filtra pela organização pedida", async () => {
    const b = bancada();
    const waha = { listarMensagensDoChat: vi.fn(async () => [msg({})]) };
    await importarHistoricoDaConversa(b.admin, waha, "org-a", "conv-1");
    const lidas = b.filtros.filter((f) => f.filtros.length > 0);
    expect(lidas.length).toBeGreaterThanOrEqual(4);
    for (const f of lidas) expect(f.filtros, f.tabela).toContainEqual(["organization_id", "org-a"]);
  });

  it("pagina até a página vir incompleta", async () => {
    const b = bancada({ telefone: "+558632210000" });
    const cheia = Array.from({ length: PAGINA_DO_CANAL }, (_, i) => msg({ id: `false_${CHAT}_P${i}` }));
    const waha = { listarMensagensDoChat: vi.fn(async (_s: string, _c: string, _l?: number, offset = 0) => (offset === 0 ? cheia : [msg({ id: `false_${CHAT}_ULTIMA` })])) };
    const r = await importarHistoricoDaConversa(b.admin, waha, "org-a", "conv-1");
    expect(waha.listarMensagensDoChat.mock.calls.map((c) => c[3])).toEqual([0, PAGINA_DO_CANAL]);
    expect(r).toMatchObject({ ok: true, importadas: PAGINA_DO_CANAL + 1 });
  });

  it("a forma sem o nono dígito só é tentada quando o cadastro não trouxe nada", async () => {
    const vazio = bancada();
    const wahaVazio = { listarMensagensDoChat: vi.fn(async (_s: string, chat: string) => (chat === "558699990000@c.us" ? [msg({})] : [])) };
    expect(await importarHistoricoDaConversa(vazio.admin, wahaVazio, "org-a", "conv-1")).toMatchObject({ ok: true, importadas: 1 });
    expect(wahaVazio.listarMensagensDoChat.mock.calls.map((c) => c[1])).toEqual(["5586999990000@c.us", "558699990000@c.us"]);

    const achou = bancada();
    const wahaAchou = { listarMensagensDoChat: vi.fn(async (_s: string, _c: string) => [msg({})]) };
    await importarHistoricoDaConversa(achou.admin, wahaAchou, "org-a", "conv-1");
    expect(wahaAchou.listarMensagensDoChat.mock.calls.map((c) => c[1])).toEqual(["5586999990000@c.us"]);
  });

  it("o webhook ganhou a corrida: o lote bate na unique e o linha a linha pula só a repetida", async () => {
    const b = bancada({ conflitoNoLote: true });
    // a gravada entre a leitura e a escrita não está em `gravadas` na leitura; a unique é que pega
    const waha = { listarMensagensDoChat: vi.fn(async () => [msg({}), msg({ id: `false_${CHAT}_NOVA` })]) };
    const r = await importarHistoricoDaConversa(b.admin, waha, "org-a", "conv-1");
    expect(r).toMatchObject({ ok: true, importadas: 2 });
  });

  it("canal fora do ar não grava nada, e o log guarda o porquê (sem telefone)", async () => {
    const b = bancada();
    const aviso = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const waha = { listarMensagensDoChat: vi.fn(async () => { throw new Error("waha_chat_messages_500"); }) };
    expect(await importarHistoricoDaConversa(b.admin, waha, "org-a", "conv-1")).toEqual({ ok: false, motivo: "canal_indisponivel" });
    expect(b.inseridas).toEqual([]);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining("não respondeu"), { organizationId: "org-a", conversationId: "conv-1", erro: "waha_chat_messages_500" });
    expect(JSON.stringify(aviso.mock.calls)).not.toMatch(/5586/);
    aviso.mockRestore();
  });
});
