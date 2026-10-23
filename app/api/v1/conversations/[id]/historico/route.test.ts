import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { importarHistoricoDoCanal } from "@/lib/channels/historico-do-canal";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";

import { POST } from "./route";

const liberado = { allowed: true, count: 1, limit: 10 } as Awaited<ReturnType<typeof checkRateLimit>>;

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/channels/historico-do-canal", () => ({ importarHistoricoDoCanal: vi.fn() }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: vi.fn() }));

/** AdvTec — a rota que traz o histórico do WhatsApp para a conversa. */
const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const filtros: Array<[string, unknown]> = [];
let visivel = true;
const req = () => new NextRequest(`http://localhost/api/v1/conversations/${CONV}/historico`, { method: "POST" });
const ctx = (id = CONV) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  filtros.length = 0;
  visivel = true;
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({ ok: true, user: { id: "u1", idioma: "pt" }, org: { orgId: ORG, role: "agent" } } as unknown as Awaited<ReturnType<typeof requireRole>>);
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => { filtros.push([k, v]); return q; },
    maybeSingle: async () => ({ data: visivel ? { id: CONV } : null, error: null }),
  };
  vi.mocked(createClient).mockResolvedValue({ from: () => q } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(importarHistoricoDoCanal).mockResolvedValue({ ok: true, importadas: 27, jaEstavam: 2, noCanal: 29 });
  vi.mocked(checkRateLimit).mockResolvedValue(liberado);
});

describe("teto de pedidos (auditoria de 22/10/2026, OWASP API4)", () => {
  it("passou do teto da pessoa: 429 com Retry-After, sem tocar no canal", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, count: 11, limit: 10 } as Awaited<ReturnType<typeof checkRateLimit>>);
    const res = await POST(req(), ctx());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(importarHistoricoDoCanal).not.toHaveBeenCalled();
  });

  it("passou do teto da organização: 429, sem tocar no canal", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(liberado).mockResolvedValueOnce({ allowed: false, count: 41, limit: 40 } as Awaited<ReturnType<typeof checkRateLimit>>);
    expect((await POST(req(), ctx())).status).toBe(429);
    expect(importarHistoricoDoCanal).not.toHaveBeenCalled();
  });

  it("o teto é por pessoa e por organização", async () => {
    await POST(req(), ctx());
    expect(vi.mocked(checkRateLimit).mock.calls.map((c) => c[0])).toEqual(["conversa-historico:u1", `conversa-historico-org:${ORG}`]);
  });

  it("conversa que a pessoa não vê é 404 antes de gastar o teto", async () => {
    visivel = false;
    expect((await POST(req(), ctx())).status).toBe(404);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/conversations/[id]/historico", () => {
  it("exige agent em diante; negado não importa nada", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden", "Acesso negado.", 403) });
    expect((await POST(req(), ctx())).status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith("agent", expect.anything());
    expect(importarHistoricoDoCanal).not.toHaveBeenCalled();
  });

  it("modo suporte só-leitura não importa", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("forbidden", "Somente leitura.", 403));
    expect((await POST(req(), ctx())).status).toBe(403);
    expect(importarHistoricoDoCanal).not.toHaveBeenCalled();
  });

  it("conversa que a pessoa não vê (outra organização, ou fora do escopo dela) é 404 e não importa", async () => {
    visivel = false;
    expect((await POST(req(), ctx())).status).toBe(404);
    expect(filtros).toContainEqual(["organization_id", ORG]);
    expect(importarHistoricoDoCanal).not.toHaveBeenCalled();
  });

  it("id que não é uuid é 404 antes de consultar", async () => {
    expect((await POST(req(), ctx("1 or 1=1"))).status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("visível: importa na organização ativa e devolve quantas vieram", async () => {
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ importadas: 27, ja_estavam: 2, no_canal: 29 });
    expect(importarHistoricoDoCanal).toHaveBeenCalledWith(expect.anything(), ORG, CONV);
  });

  it("canal fora do ar é 503, com a mensagem dizendo isso", async () => {
    vi.mocked(importarHistoricoDoCanal).mockResolvedValue({ ok: false, motivo: "canal_indisponivel" });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(503);
  });
});
