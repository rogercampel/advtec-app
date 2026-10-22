import { describe, expect, it } from "vitest";

import { CAMPO_DA_AREA, CAMPO_DO_RESUMO, MENSAGENS_NA_FICHA, montaFicha, tipoDoArquivo, type MensagemDaFicha } from "@/lib/casos/ficha";

/**
 * 0001.E4 (#18) — a ficha do caso, com o que existe antes da triagem jurídica.
 *
 *   - critério 10: legível sem abrir a conversa — quem, histórico, documentos, compromissos;
 *   - não inventa: área e resumo só se gravados no caso; senão, "a definir pela triagem";
 *   - urgência nunca vira "sem urgência": só a mensagem literal em que o detector acendeu.
 */

const AGORA = new Date("2026-10-22T12:00:00Z");
const caso = (custom_fields: unknown = {}) => ({ id: "c1", title: "Cobrança indevida", custom_fields, created_at: "2026-10-20T10:00:00Z", contact_id: "p1" });
const contato = { id: "p1", name: "Maria Souza", display_name: null, phone_number: "+5586999990000" };
const msg = (id: string, em: string, direction: "inbound" | "outbound", body: string | null, media_mime: string | null = null, media_size_bytes: number | null = null): MensagemDaFicha => ({
  id,
  conversation_id: "conv1",
  direction,
  body,
  media_mime,
  media_size_bytes,
  created_at: em,
});
const ficha = (over: Partial<Parameters<typeof montaFicha>[0]> = {}) =>
  montaFicha({ caso: caso(), contato, mensagens: [], compromissos: [], agora: AGORA, ...over });

describe("quem, área e resumo — sem palpite", () => {
  it("quem vem do contato do caso (nome de exibição antes do nome)", () => {
    expect(ficha().quem).toEqual({ nome: "Maria Souza", telefone: "+5586999990000" });
    expect(ficha({ contato: { ...contato, display_name: "Dona Maria" } }).quem?.nome).toBe("Dona Maria");
    expect(ficha({ contato: null }).quem).toBeNull();
  });

  it("sem área e resumo gravados, a ficha diz que esperam a triagem — e não inventa", () => {
    const f = ficha();
    expect(f.area).toBeNull();
    expect(f.resumo).toBeNull();
    expect(f.daTriagem).toEqual(["area", "resumo", "urgencia"]);
  });

  it("área e resumo gravados no caso aparecem", () => {
    const f = ficha({ caso: caso({ [CAMPO_DA_AREA]: " Consumidor ", [CAMPO_DO_RESUMO]: "Cobrança em duplicidade no cartão." }) });
    expect(f.area).toBe("Consumidor");
    expect(f.resumo).toBe("Cobrança em duplicidade no cartão.");
    expect(f.daTriagem).toEqual(["urgencia"]);
  });

  it("campo que não é texto, ou vazio, conta como não gravado", () => {
    expect(ficha({ caso: caso({ [CAMPO_DA_AREA]: 42, [CAMPO_DO_RESUMO]: "  " }) }).daTriagem).toEqual(["area", "resumo", "urgencia"]);
    expect(ficha({ caso: caso(null) }).area).toBeNull();
  });
});

describe("urgência — nunca 'sem urgência'", () => {
  it("o detector da base acende: a ficha mostra a mensagem literal do cliente, com a data", () => {
    const f = ficha({ mensagens: [msg("m1", "2026-10-21T10:00:00Z", "inbound", "Por favor, é urgente, a audiência é amanhã!")] });
    expect(f.palavrasDeUrgencia).toEqual([{ id: "m1", em: "2026-10-21T10:00:00Z", trecho: "Por favor, é urgente, a audiência é amanhã!" }]);
    expect(f.daTriagem).toContain("urgencia");
  });

  it("palavra de urgência na mensagem DO ESCRITÓRIO não conta", () => {
    expect(ficha({ mensagens: [msg("m1", "2026-10-21T10:00:00Z", "outbound", "Não é urgente, fique tranquila.")] }).palavrasDeUrgencia).toEqual([]);
  });

  it("sem palavra de urgência, a urgência continua a cargo da triagem (o detector não conhece 'audiência')", () => {
    const f = ficha({ mensagens: [msg("m1", "2026-10-21T10:00:00Z", "inbound", "Minha audiência é amanhã.")] });
    expect(f.palavrasDeUrgencia).toEqual([]);
    expect(f.daTriagem).toContain("urgencia");
  });
});

describe("histórico e documentos — legível sem abrir a conversa (critério 10)", () => {
  it("histórico em ordem de tempo, com quem falou; arquivo sem texto vira o tipo dele", () => {
    const f = ficha({
      mensagens: [
        msg("m2", "2026-10-21T10:05:00Z", "outbound", "Recebemos, obrigado."),
        msg("m1", "2026-10-21T10:00:00Z", "inbound", null, "application/pdf", 204800),
      ],
    });
    expect(f.historico.map((h) => [h.id, h.de, h.texto])).toEqual([
      ["m1", "cliente", "[PDF]"],
      ["m2", "escritorio", "Recebemos, obrigado."],
    ]);
  });

  it("o teto do histórico fica com as mais recentes e diz quantas ficaram de fora", () => {
    const muitas = Array.from({ length: MENSAGENS_NA_FICHA + 5 }, (_, i) =>
      msg(`m${i}`, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), "inbound", `oi ${i}`),
    );
    const f = ficha({ mensagens: muitas });
    expect(f.historico).toHaveLength(MENSAGENS_NA_FICHA);
    expect(f.historico[0]!.id).toBe("m5");
    expect(f.historicoCortado).toBe(5);
  });

  it("documentos: só mensagens com arquivo, com tipo e tamanho", () => {
    const f = ficha({
      mensagens: [
        msg("m1", "2026-10-21T10:00:00Z", "inbound", "segue o contrato", "application/pdf", 204800),
        msg("m2", "2026-10-21T10:01:00Z", "inbound", "e a foto", "image/jpeg", 10),
        msg("m3", "2026-10-21T10:02:00Z", "inbound", "só texto"),
      ],
    });
    expect(f.documentos.map((d) => [d.id, d.tipo, d.tamanhoKb])).toEqual([
      ["m1", "PDF", 200],
      ["m2", "Imagem", 1],
    ]);
  });

  it("documentos são os que o CLIENTE enviou: o PDF do escritório fica só no histórico", () => {
    const f = ficha({
      mensagens: [
        msg("m1", "2026-10-21T10:00:00Z", "inbound", "meu RG", "image/jpeg"),
        msg("m2", "2026-10-21T10:01:00Z", "outbound", "segue a procuração", "application/pdf"),
      ],
    });
    expect(f.documentos.map((d) => d.id)).toEqual(["m1"]);
    expect(f.historico.map((h) => h.id)).toEqual(["m1", "m2"]);
  });

  it("reação e aviso de sistema não são fala de ninguém: ficam fora da ficha", () => {
    const f = ficha({
      mensagens: [
        msg("m1", "2026-10-21T10:00:00Z", "inbound", "oi"),
        { ...msg("m2", "2026-10-21T10:01:00Z", "outbound", null), type: "reaction" },
        { ...msg("m3", "2026-10-21T10:02:00Z", "outbound", "conversa atribuída"), type: "system" },
        { ...msg("m4", "2026-10-21T10:03:00Z", "outbound", "bom dia"), type: "text" },
      ],
    });
    expect(f.historico.map((h) => h.id)).toEqual(["m1", "m4"]);
  });

  it("o tipo do arquivo em palavra de gente", () => {
    expect(["application/pdf", "image/png", "audio/ogg", "video/mp4", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/zip"].map(tipoDoArquivo)).toEqual(
      ["PDF", "Imagem", "Áudio", "Vídeo", "Documento de texto", "Planilha", "Arquivo"],
    );
  });
});

describe("compromissos", () => {
  it("próximos em ordem de data, passados do mais recente; cancelado não aparece", () => {
    const f = ficha({
      compromissos: [
        { id: "a", title: "Consulta", starts_at: "2026-10-25T13:00:00Z", status: "confirmed" },
        { id: "b", title: "Retorno", starts_at: "2026-10-23T13:00:00Z", status: "confirmed" },
        { id: "c", title: "Antiga", starts_at: "2026-10-01T13:00:00Z", status: "completed" },
        { id: "d", title: "Desmarcada", starts_at: "2026-10-24T13:00:00Z", status: "cancelled" },
      ],
    });
    expect(f.compromissos.proximos.map((c) => c.id)).toEqual(["b", "a"]);
    expect(f.compromissos.passados.map((c) => c.id)).toEqual(["c"]);
  });
});
