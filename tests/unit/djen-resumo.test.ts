import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { CAMPO_DO_PROCESSO, type PublicacaoDaCaixa } from "@/lib/djen/caixa";
import { montaPauta } from "@/lib/djen/pauta";
import { montaResumo, rodaResumo, type Mensagem, type PortaDoResumo } from "@/lib/djen/resumo";

/**
 * Ticket 0009.E5 — o resumo da manhã.
 *
 * Critério 6: o resumo vai só para usuários do escritório; nenhum caminho de
 * código envia pauta a contato de cliente. Teste de comportamento (o único
 * destinatário possível é `destinatarios`) e de varredura, com controle negativo.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - mandar também para um endereço achado no texto da publicação;
 *   - um envio só com todos no "Para" em vez de um por pessoa;
 *   - tirar o "nada novo" do dia vazio;
 *   - tirar o "sugerido" das linhas de prazo.
 */

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const NUM = "0001234-56.2026.8.26.0100";
const HOJE = new Date("2026-10-20T10:00:00Z"); // 7h em Brasília

const pub = (id: string, data: string, texto: string): PublicacaoDaCaixa => ({
  id,
  organizationId: ORG,
  numeroProcesso: NUM,
  dataDisponibilizacao: data,
  tipoComunicacao: "Intimação",
  siglaTribunal: "TJSP",
  nomeOrgao: "3ª Vara",
  texto,
  descartadaEm: null,
});
const caso = { id: "n1", organization_id: ORG, title: "Caso", custom_fields: { [CAMPO_DO_PROCESSO]: NUM } };
const COM_PRAZO = "DESPACHO. Manifeste-se no prazo de 15 (quinze) dias úteis. Cliente: maria.cliente@exemplo.com";

function porta(publicacoes: PublicacaoDaCaixa[], destinatarios: string[], falhaPara: string[] = []) {
  const enviadas: Mensagem[] = [];
  const p: PortaDoResumo = {
    escritorios: async () => [{ organizationId: ORG, nome: "Silva Advogados" }],
    leituraDaPauta: async () => ({ publicacoes, negocios: [caso] }),
    destinatarios: async () => destinatarios,
    enviar: vi.fn(async (m: Mensagem) => {
      enviadas.push(m);
      return { ok: !falhaPara.includes(m.to) };
    }),
  };
  return { p, enviadas };
}

describe("montaResumo", () => {
  it("dia vazio diz 'nada novo', não some", () => {
    const r = montaResumo(montaPauta([], [caso], HOJE), "Silva", "https://x/app/publicacoes");
    expect(r.subject).toBe("Pauta de 2026-10-20 · Silva: nada novo");
    expect(r.text).toMatch(/Nada novo hoje/);
  });

  it("prazo aparece como sugerido, com o trecho, e o link da tela vai junto", () => {
    const r = montaResumo(montaPauta([pub("p1", "2026-10-20", COM_PRAZO)], [caso], HOJE), "Silva", "https://x/app/publicacoes");
    expect(r.subject).toMatch(/1 nova\(s\)/);
    expect(r.text).toMatch(/prazo sugerido de 15 dias úteis, a confirmar: "prazo de 15 \(quinze\) dias úteis/);
    expect(r.text).toContain("https://x/app/publicacoes");
  });
});

describe("critério 6: só para usuários do escritório", () => {
  it("cada destinatário recebe o seu e-mail, e ninguém mais — nem o endereço que está no texto", async () => {
    const { p, enviadas } = porta([pub("p1", "2026-10-20", COM_PRAZO)], ["ana@silva.adv.br", "beto@silva.adv.br"]);
    const r = await rodaResumo(p, { agora: HOJE, url: "https://x" });
    expect(enviadas.map((m) => m.to)).toEqual(["ana@silva.adv.br", "beto@silva.adv.br"]);
    expect(r).toEqual([{ organizationId: ORG, enviados: 2, falhas: 0, vazio: false }]);
  });

  it("sem usuário no escritório, nada sai", async () => {
    const { p, enviadas } = porta([pub("p1", "2026-10-20", COM_PRAZO)], []);
    await rodaResumo(p, { agora: HOJE, url: "https://x" });
    expect(enviadas).toEqual([]);
  });

  it("falha de um envio é contada e não impede os outros", async () => {
    const { p } = porta([], ["ana@silva.adv.br", "beto@silva.adv.br"], ["ana@silva.adv.br"]);
    const r = await rodaResumo(p, { agora: HOJE, url: "https://x" });
    expect(r[0]).toMatchObject({ enviados: 1, falhas: 1, vazio: true });
  });

  /** Varredura: o resumo não toca em contato, telefone ou canal de cliente. */
  const ARQUIVOS = ["lib/djen/resumo.ts", "lib/djen/resumo-banco.ts", "app/api/v1/cron/djen-resumo/route.ts"];
  const PROIBIDO = /\bcontacts\b|contact_id|\bphone\b|telefone|whatsapp|waha|conversations|sendMessage|messaging/i;

  it("controle negativo: a varredura reconhece leitura de contato", () => {
    expect(PROIBIDO.test('admin.from("contacts").select("phone")')).toBe(true);
    expect(PROIBIDO.test('admin.from("user_organizations")')).toBe(false);
  });

  it.each(ARQUIVOS)("%s não lê contato nem fala por canal de cliente", (arquivo) => {
    const codigo = readFileSync(arquivo, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(codigo).not.toMatch(PROIBIDO);
  });
});
