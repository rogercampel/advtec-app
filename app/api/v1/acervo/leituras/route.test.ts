// @vitest-environment node
// Multipart real (File/FormData) precisa do realm do Node — o jsdom corrompe o corpo (ver skills/import).
/**
 * POST /api/v1/acervo/leituras (spec 0003.E6).
 *
 * O que não pode acontecer:
 *   - PDF escaneado virar documento vazio (critério 5): recusa com o motivo,
 *     nada gravado, modelo não chamado;
 *   - leitura começar sem o advogado ver a estimativa (critério 7): sem
 *     `confirmar`, só a estimativa — nada gravado, modelo não chamado;
 *   - leitura gravada na organização do CORPO: vale a da sessão;
 *   - falha da leitura sumir: a linha termina `falhou`, com o motivo.
 *
 * Mutações: ver o fim do arquivo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { lePaginasDoPdf } from "@/lib/acervo/paginas-do-pdf";
import { executaLeitura } from "@/lib/acervo/leitura-de-processo";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { PdfExtractError } from "@/lib/ai/rag/extractors/pdf";
import { MOTIVO_SEM_TEXTO } from "@/lib/acervo/paginas-do-pdf";

const tarefas: Array<() => Promise<void>> = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => Promise<void>) => tarefas.push(fn) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: vi.fn(() => ({})) }));
vi.mock("@/lib/acervo/paginas-do-pdf", async (original) => ({
  ...(await original<typeof import("@/lib/acervo/paginas-do-pdf")>()),
  lePaginasDoPdf: vi.fn(),
}));
vi.mock("@/lib/acervo/leitura-de-processo", async (original) => ({
  ...(await original<typeof import("@/lib/acervo/leitura-de-processo")>()),
  executaLeitura: vi.fn(),
}));

import { POST } from "./route";

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const LEITURA = "44444444-4444-4444-8444-444444444444";
const PDF = new TextEncoder().encode("%PDF-1.7 conteúdo");
const PAGINAS = [{ numero: 1, texto: "EXMO. SR. DR. JUIZ DE DIREITO DA 1ª VARA CÍVEL. FULANO DE TAL, brasileiro, vem propor a presente AÇÃO DE COBRANÇA." }];

type Cap = { insert?: Record<string, unknown>; updates: Array<{ patch: Record<string, unknown>; filtros: Array<[string, unknown]> }>; erroNoUpdate?: string };

function banco(cap: Cap) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => ({
      insert: (linha: Record<string, unknown>) => {
        cap.insert = linha;
        return { select: () => ({ single: async () => ({ data: { id: LEITURA }, error: null }) }) };
      },
      update: (patch: Record<string, unknown>) => {
        const u = { patch, filtros: [] as Array<[string, unknown]> };
        cap.updates.push(u);
        const erro = cap.updates.length === 1 && cap.erroNoUpdate ? { message: cap.erroNoUpdate } : null;
        const chain = { eq: (c: string, v: unknown) => (u.filtros.push([c, v]), chain), then: (ok: (r: unknown) => unknown) => ok({ error: erro }) };
        return chain;
      },
    }),
  } as never);
}

function autorizado() {
  vi.mocked(requireRole).mockResolvedValue({ ok: true, user: { id: USER, idioma: "pt" }, org: { orgId: ORG, name: "Org", role: "agent" } } as never);
}

const envia = (campos: Record<string, string | Blob>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.append(k, v);
  return POST(new NextRequest("http://x/api/v1/acervo/leituras", { method: "POST", body: form }));
};
const pdf = (bytes: Uint8Array<ArrayBuffer> = PDF) => new File([bytes], "processo.pdf", { type: "application/pdf" });

describe("leitura de processo", () => {
  let cap: Cap;
  beforeEach(() => {
    vi.clearAllMocks();
    tarefas.length = 0;
    cap = { updates: [] };
    banco(cap);
    autorizado();
    vi.mocked(lePaginasDoPdf).mockResolvedValue({ paginas: PAGINAS, totalDePaginas: 1, paginasSemTexto: [] });
  });

  it("sem papel, recusa sem ler o arquivo", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden", "x", 403) } as never);
    expect((await envia({ arquivo: pdf() })).status).toBe(403);
    expect(lePaginasDoPdf).not.toHaveBeenCalled();
  });

  it("acompanhamento só leitura não lê: a leitura gasta modelo", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValueOnce(fail("support_readonly", "x", 403) as never);
    expect((await envia({ arquivo: pdf(), confirmar: "1" })).status).toBe(403);
    expect(cap.insert).toBeUndefined();
  });

  it("arquivo que não é PDF é recusado antes de abrir", async () => {
    expect((await envia({ arquivo: new File([new TextEncoder().encode("GIF89a")], "x.pdf") })).status).toBe(422);
    expect(lePaginasDoPdf).not.toHaveBeenCalled();
  });

  it("critério 5: PDF escaneado é recusado com o motivo — nada gravado, modelo não chamado", async () => {
    // O leitor de verdade LANÇA no escaneado (`motivo: "sem_texto"`) — o falso faz igual.
    vi.mocked(lePaginasDoPdf).mockRejectedValue(new PdfExtractError(MOTIVO_SEM_TEXTO, undefined, "sem_texto"));
    const r = await envia({ arquivo: pdf(), confirmar: "1" });
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).toMatch(/camada de texto/);
    expect(cap.insert).toBeUndefined();
    expect(tarefas).toHaveLength(0);
  });

  it("PDF que não abre (corrompido, com senha) tem outra mensagem — não 'escaneado'", async () => {
    vi.mocked(lePaginasDoPdf).mockRejectedValue(new PdfExtractError("não foi possível ler este PDF (corrompido ou protegido)", new Error("Invalid PDF"), "falha"));
    const r = await envia({ arquivo: pdf() });
    expect(r.status).toBe(422);
    const corpo = JSON.stringify(await r.json());
    expect(corpo).toMatch(/protegido por senha ou corrompido/);
    expect(corpo).not.toMatch(/camada de texto/);
  });

  it("critério 7: sem confirmar, só a estimativa — nada gravado, modelo não chamado", async () => {
    const r = await envia({ arquivo: pdf() });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { estimativa: { paginas: number; minutos: number } } };
    expect(corpo.data.estimativa).toMatchObject({ paginas: 1 });
    expect(corpo.data.estimativa.minutos).toBeGreaterThan(0);
    expect(cap.insert).toBeUndefined();
    expect(tarefas).toHaveLength(0);
  });

  it("confirmada: grava 'lendo' na organização da SESSÃO e devolve o id na hora", async () => {
    const r = await envia({ arquivo: pdf(), confirmar: "1", organization_id: OUTRA_ORG });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { id: string } }).data.id).toBe(LEITURA);
    expect(cap.insert).toMatchObject({ organization_id: ORG, criada_por: USER, nome_do_arquivo: "processo.pdf", total_de_paginas: 1 });
    expect(cap.insert).not.toHaveProperty("estado"); // nasce 'lendo' pelo default do banco
    expect(tarefas).toHaveLength(1);
  });

  it("a leitura termina 'pronta' com o documento, filtrando pela organização da sessão", async () => {
    vi.mocked(executaLeitura).mockResolvedValue({ aviso: "x" } as never);
    await envia({ arquivo: pdf(), confirmar: "1" });
    await tarefas[0]!();
    expect(cap.updates).toHaveLength(1);
    expect(cap.updates[0]!.patch).toMatchObject({ estado: "pronta", documento: { aviso: "x" } });
    expect(cap.updates[0]!.filtros).toEqual([
      ["id", LEITURA],
      ["organization_id", ORG],
    ]);
  });

  it("folha escaneada no meio dos autos vai para a leitura como página vazia — e o documento a marca como não lida", async () => {
    vi.mocked(lePaginasDoPdf).mockResolvedValue({ paginas: PAGINAS, totalDePaginas: 2, paginasSemTexto: [2] });
    vi.mocked(executaLeitura).mockResolvedValue({ aviso: "x" } as never);
    await envia({ arquivo: pdf(), confirmar: "1" });
    await tarefas[0]!();
    expect(vi.mocked(executaLeitura).mock.calls[0]![0]).toEqual([...PAGINAS, { numero: 2, texto: "" }]);
  });

  it("falha da leitura não some: a linha termina 'falhou', com o motivo", async () => {
    vi.mocked(executaLeitura).mockRejectedValue(new Error("429 limite de uso"));
    await envia({ arquivo: pdf(), confirmar: "1" });
    await tarefas[0]!();
    expect(cap.updates[0]!.patch).toMatchObject({ estado: "falhou", motivo_da_falha: "Error: 429 limite de uso" });
    expect(cap.updates[0]!.filtros).toContainEqual(["organization_id", ORG]);
  });

  it("documento que o banco recusa não deixa a linha 'lendo': termina 'falhou', com o motivo", async () => {
    vi.mocked(executaLeitura).mockResolvedValue({ aviso: "x" } as never);
    cap.erroNoUpdate = "unsupported Unicode escape sequence";
    await envia({ arquivo: pdf(), confirmar: "1" });
    await tarefas[0]!();
    expect(cap.updates.map((u) => u.patch.estado)).toEqual(["pronta", "falhou"]);
    expect(cap.updates[1]!.patch.motivo_da_falha).toMatch(/não foi gravado: unsupported Unicode/);
  });

  it("corpo acima de 10 MB é recusado pelo cabeçalho, antes de ler — o proxy do Next o entregaria cortado", async () => {
    const req = new NextRequest("http://x/api/v1/acervo/leituras", { method: "POST", body: "x", headers: { "content-length": String(10 * 1024 * 1024 + 1) } });
    const r = await POST(req);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/10 MB/);
    expect(cap.insert).toBeUndefined();
  });

  it("muitas leituras seguidas: 429, nada gravado", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false } as never);
    expect((await envia({ arquivo: pdf(), confirmar: "1" })).status).toBe(429);
    expect(cap.insert).toBeUndefined();
  });
});

/*
 * Mutações (21/10/2026): 12 de 12 acusadas (+ erro do update ignorado; sem o limite pelo cabeçalho). Sem recusar escaneado (o leitor lança `sem_texto`); sem o passo
 * da estimativa; organização do corpo; atualização sem filtro de organização;
 * sem conferir que é PDF; sem limite de frequência; sem a guarda de suporte; sem
 * checar o papel; folhas escaneadas do meio fora da leitura; motivo da falha
 * perdido.
 */
