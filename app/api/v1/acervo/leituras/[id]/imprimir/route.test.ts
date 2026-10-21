/**
 * GET /api/v1/acervo/leituras/[id]/imprimir (spec 0003.E6).
 *
 * O que não pode acontecer: documento de outro escritório (a leitura é pela
 * sessão, com RLS, e filtrada pela organização da sessão); leitura que não está
 * pronta servida como documento; a página de impressão rodar script.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { montaDocumento } from "@/lib/acervo/documento-de-leitura";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { GET } from "./route";

const ORG = "22222222-2222-4222-8222-222222222222";
const LEITURA = "44444444-4444-4444-8444-444444444444";
const documento = montaDocumento({
  quemEQuem: { juizo: null, autor: { valor: "<script>x</script>", pagina: 1, trecho: "t" }, classe: null, reu: null, valor_da_causa: null, advogados: [] },
  linhaDoTempo: { eventos: [], carimbos: 0, citacoes: 0 },
  alegacoes: {
    alegacoes: [],
    naoConsta: ["pedido", "causa_de_pedir", "defesa", "decisao"],
    descartados: [],
    removidas: { sem_pagina: 0, trecho_nao_literal: 0, tamanho_do_trecho: 0, numero_sem_apoio: 0, formato: 0, repetido: 0, decisao_sem_verbo: 0 },
    blocosNaoLidos: [],
    paginasSemTexto: [],
  },
  contradicoes: { contradicoes: [], lacunas: [], paginasQueImportam: [], removidas: { numero_inexistente: 0, mesmo_item: 0, numero_sem_apoio: 0, acima_do_teto: 0, repetido: 0 }, naoLido: null },
});

let filtros: Array<[string, unknown]> = [];
function banco(linha: unknown) {
  filtros = [];
  const chain = { select: () => chain, eq: (c: string, v: unknown) => (filtros.push([c, v]), chain), maybeSingle: async () => ({ data: linha, error: null }) };
  vi.mocked(createClient).mockResolvedValue({ from: () => chain } as never);
}
const pede = (id = LEITURA) => GET(new NextRequest(`http://x/api/v1/acervo/leituras/${id}/imprimir`), { params: Promise.resolve({ id }) });

describe("versão para imprimir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: { id: "u", idioma: "pt" }, org: { orgId: ORG, name: "Org", role: "viewer" } } as never);
  });

  it("sem papel, recusa", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden", "x", 403) } as never);
    banco(null);
    expect((await pede()).status).toBe(403);
  });

  it("id que não é uuid é recusado antes do banco", async () => {
    banco(null);
    expect((await pede("1 or 1=1")).status).toBe(422);
    expect(filtros).toEqual([]);
  });

  it("leitura de outro escritório (a RLS não devolve) é 404, e a consulta filtra pela organização da sessão", async () => {
    banco(null);
    expect((await pede()).status).toBe(404);
    expect(filtros).toContainEqual(["organization_id", ORG]);
  });

  it("leitura que ainda não está pronta é 404, nunca documento parcial", async () => {
    banco({ nome_do_arquivo: "x.pdf", estado: "lendo", documento: null });
    expect((await pede()).status).toBe(404);
  });

  it("pronta: página HTML própria, conteúdo escapado, sem script permitido", async () => {
    banco({ nome_do_arquivo: "processo.pdf", estado: "pronta", documento });
    const r = await pede();
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toMatch(/text\/html/);
    expect(r.headers.get("Content-Security-Policy")).toMatch(/default-src 'none'/);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const html = await r.text();
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("Leitura de processo.pdf");
  });
});
