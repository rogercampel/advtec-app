// @vitest-environment node
/**
 * POST /api/v1/acervo/minutas (spec 0005.E2).
 *
 * O que não pode acontecer:
 *   - minuta de um escritório alimentada pelo acervo de outro: a organização é a do
 *     `requireRole`, e o `organization_id` do corpo é ignorado;
 *   - papel abaixo de `agent`, ou acompanhamento só leitura, gastando modelo;
 *   - passar do teto por pessoa (429 com Retry-After) — e organização SEM acervo gastando
 *     uma das vagas do teto;
 *   - o filtro "deixar de fora" tirar TUDO e a tela dizer "não há base no acervo";
 *   - falha do modelo, do formato ou do orçamento de IA virar o mesmo "tente de novo".
 *
 * MUTAÇÕES (23/10/2026, cada uma desfeita depois de ver o teste acusar): (1) `organizationId` lido do
 * corpo; (2) `checkRateLimit` antes da leitura das fontes; (3) tirar o ramo `TUDO_DEIXADO_DE_FORA`;
 * (4) tirar o ramo do orçamento (`llm_budget_exceeded`); (5) tirar `requireSupportWrite`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { buscadorDaSessao } from "@/lib/acervo/buscador-da-sessao";
import { chamadaPelaAssinatura } from "@/lib/acervo/leitura-por-modelo";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: vi.fn(() => ({})) }));
// A busca e o modelo são falsos; o filtro (`semOsDocumentos`) e a minuta (`escreveMinuta`) são os de verdade.
vi.mock("@/lib/acervo/buscador-da-sessao", async (original) => ({
  ...(await original<typeof import("@/lib/acervo/buscador-da-sessao")>()),
  buscadorDaSessao: vi.fn(),
}));
vi.mock("@/lib/acervo/leitura-por-modelo", async (original) => ({
  ...(await original<typeof import("@/lib/acervo/leitura-por-modelo")>()),
  chamadaPelaAssinatura: vi.fn(),
}));

import { POST } from "./route";

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const PEDIDO = "Contestação de reclamação trabalhista com pedido de horas extras.";

const hit = (nome: string, content = "Trecho do modelo do escritório sobre horas extras.") => ({
  content,
  similarity: 0.9,
  metadata: { documento: `doc-${nome}`, nome, pagina_inicial: 1, pagina_final: 2 },
});

const MODELO_OK = JSON.stringify({ blocos: [{ texto: "Do pedido de horas extras, conforme o modelo do escritório.", fontes: ["T1"] }], faltou: [] });

type Estado = { consultas: Array<{ tabela: string; filtros: Array<[string, unknown]> }>; fontes: Array<{ id: string }> };
let estado: Estado;
let buscas: Array<{ organizationId: string; topK: number }>;
let resultados: unknown[];
let modelo: ReturnType<typeof vi.fn>;

function banco() {
  vi.mocked(createClient).mockResolvedValue({
    from: (tabela: string) => {
      const c = { tabela, filtros: [] as Array<[string, unknown]> };
      estado.consultas.push(c);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (k: string, v: unknown) => (c.filtros.push([k, v]), chain);
      chain.then = (ok: (r: unknown) => unknown) => ok({ data: estado.fontes, error: null });
      return chain;
    },
  } as never);
}

const envia = (corpo: unknown) =>
  POST(new NextRequest("http://x/api/v1/acervo/minutas", { method: "POST", body: JSON.stringify(corpo), headers: { "content-type": "application/json" } }));

describe("minuta do acervo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estado = { consultas: [], fontes: [{ id: "fonte-1" }] };
    buscas = [];
    resultados = [hit("Modelo de contestação.pdf")];
    modelo = vi.fn(async () => ({ texto: MODELO_OK }));
    banco();
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: { id: USER, idioma: "pt" }, org: { orgId: ORG, name: "Org", role: "agent" } } as never);
    vi.mocked(buscadorDaSessao).mockReturnValue((async (q: { organizationId: string; topK: number }) => {
      buscas.push({ organizationId: q.organizationId, topK: q.topK });
      return { ok: true, results: resultados };
    }) as never);
    vi.mocked(chamadaPelaAssinatura).mockReturnValue(modelo as never);
  });

  it("papel abaixo de agent: recusa antes de ler o acervo ou chamar o modelo", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden_role", "x", 403) } as never);
    expect((await envia({ pedido: PEDIDO })).status).toBe(403);
    expect(vi.mocked(requireRole).mock.calls[0]![0]).toBe("agent");
    expect(estado.consultas).toHaveLength(0);
    expect(modelo).not.toHaveBeenCalled();
  });

  it("acompanhamento só leitura não escreve minuta: ela gasta modelo", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValueOnce(fail("support_readonly", "x", 403) as never);
    expect((await envia({ pedido: PEDIDO })).status).toBe(403);
    expect(requireRole).not.toHaveBeenCalled();
    expect(modelo).not.toHaveBeenCalled();
  });

  it("a organização vem do requireRole: o organization_id do corpo é ignorado", async () => {
    const r = await envia({ pedido: PEDIDO, organization_id: OUTRA_ORG });
    expect(r.status).toBe(200);
    expect(estado.consultas[0]).toMatchObject({ tabela: "ai_knowledge_sources" });
    expect(estado.consultas[0]!.filtros).toContainEqual(["organization_id", ORG]);
    expect(estado.consultas[0]!.filtros).not.toContainEqual(["organization_id", OUTRA_ORG]);
    expect(buscas).toEqual([{ organizationId: ORG, topK: expect.any(Number) }]);
    expect(vi.mocked(chamadaPelaAssinatura).mock.calls[0]![1]).toBe(ORG);
    expect(vi.mocked(chamadaPelaAssinatura).mock.calls[0]![2]).toEqual({ purpose: "minuta_do_acervo" });
  });

  it("pedido curto demais: 422, nada lido", async () => {
    expect((await envia({ pedido: "curto" })).status).toBe(422);
    expect(estado.consultas).toHaveLength(0);
  });

  it("muitas minutas seguidas: 429 com Retry-After, modelo não chamado", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false } as never);
    const r = await envia({ pedido: PEDIDO });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("3600");
    expect(vi.mocked(checkRateLimit).mock.calls[0]![0]).toBe(`acervo-minuta:${USER}`);
    expect(modelo).not.toHaveBeenCalled();
  });

  it("escritório sem acervo: 404 com a mensagem da pesquisa, e a vaga do teto NÃO é gasta", async () => {
    estado.fontes = [];
    const r = await envia({ pedido: PEDIDO });
    expect(r.status).toBe(404);
    expect(JSON.stringify(await r.json())).toMatch(/ainda não tem acervo enviado/);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(modelo).not.toHaveBeenCalled();
  });

  it("o filtro tirou TUDO o que veio: 422 dizendo para conferir os nomes — nunca 'sem base no acervo'", async () => {
    resultados = [hit("Contestacao_Silva.pdf"), hit("Contestação Silva (rascunho).docx")];
    const r = await envia({ pedido: PEDIDO, deixar_de_fora: ["contestação silva"] });
    expect(r.status).toBe(422);
    const corpo = (await r.json()) as { error: { message: string; details: { deixados_de_fora: string[] } } };
    expect(corpo.error.message).toBe("O filtro deixou de fora todo o acervo encontrado; confira os nomes.");
    expect(corpo.error.details.deixados_de_fora.sort()).toEqual(["Contestacao_Silva.pdf", "Contestação Silva (rascunho).docx"]);
    expect(modelo).not.toHaveBeenCalled();
  });

  it("deixar de fora: pede o triplo ao buscador, devolve os nomes tirados e o termo que não casou com nada", async () => {
    resultados = [hit("Contestacao_Silva.pdf", "Peça do próprio advogado."), hit("Modelo de contestação.pdf")];
    const r = await envia({ pedido: PEDIDO, deixar_de_fora: ["contestação silva", "inicial souza"] });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { deixados_de_fora: string[]; termos_sem_efeito: string[]; arquivo: string; minuta: { situacao: string } } };
    expect(corpo.data.minuta.situacao).toBe("minuta");
    expect(corpo.data.deixados_de_fora).toEqual(["Contestacao_Silva.pdf"]);
    expect(corpo.data.termos_sem_efeito).toEqual(["inicial souza"]);
    expect(corpo.data.arquivo).toMatch(/RASCUNHO/);
    // A peça excluída NÃO chegou ao modelo.
    const pedidoAoModelo = (modelo.mock.calls[0]![0] as { user: string }).user;
    expect(pedidoAoModelo).not.toMatch(/Peça do próprio advogado/);
    expect(buscas[0]!.topK % 3).toBe(0);
  });

  it("sem filtro, a busca não ganha folga e as listas voltam vazias", async () => {
    const r = await envia({ pedido: PEDIDO });
    const corpo = (await r.json()) as { data: { deixados_de_fora: string[]; termos_sem_efeito: string[] } };
    expect(corpo.data).toMatchObject({ deixados_de_fora: [], termos_sem_efeito: [] });
    const comFiltro = buscas[0]!.topK;
    buscas.length = 0;
    await envia({ pedido: PEDIDO, deixar_de_fora: ["zzz inexistente"] });
    expect(buscas[0]!.topK).toBe(comFiltro * 3);
  });

  it("orçamento mensal de IA esgotado: 402 com mensagem clara, não 'tente de novo'", async () => {
    modelo.mockRejectedValue(Object.assign(new Error("orçamento mensal de IA da organização atingido"), { name: "llm_budget_exceeded" }));
    const r = await envia({ pedido: PEDIDO });
    expect(r.status).toBe(402);
    expect(JSON.stringify(await r.json())).toMatch(/limite mensal de uso de IA/);
  });

  it("o modelo cai ou responde fora do formato: 502, mensagem própria", async () => {
    modelo.mockRejectedValueOnce(new Error("503 provedor fora do ar"));
    const queda = await envia({ pedido: PEDIDO });
    expect(queda.status).toBe(502);
    modelo.mockResolvedValueOnce({ texto: "isto não é JSON" });
    const formato = await envia({ pedido: PEDIDO });
    expect(formato.status).toBe(502);
    expect(JSON.stringify(await formato.json())).toMatch(/respondeu fora do esperado/);
  });

  it("a mensagem de erro não vaza o motivo bruto do provedor", async () => {
    modelo.mockRejectedValue(new Error("401 sk-segredo-do-provedor"));
    const r = await envia({ pedido: PEDIDO });
    expect(JSON.stringify(await r.json())).not.toMatch(/sk-segredo/);
  });
});
