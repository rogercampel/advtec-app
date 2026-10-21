/**
 * POST /api/v1/djen/publicacoes/[id]/confirmar-prazo (spec 0006.E5).
 *
 * O que não pode acontecer: confirmação pela organização do CORPO, data que não
 * existe ou longe demais de hoje virando "vence em", confirmação de publicação
 * descartada, e rota que grava sem checar papel.
 *
 * Mutações (21/10/2026), 5 de 5 acusadas: sem filtro de organização, sem o
 * filtro de descartada, sem a janela de data plausível, sem checar o papel, sem
 * gravar quem confirmou.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

import { POST } from "./route";

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const PUB = "44444444-4444-4444-8444-444444444444";

type Cap = { patch?: Record<string, unknown>; filtros: Array<[string, string, unknown]> };

function banco(cap: Cap, devolve: unknown) {
  const chain: Record<string, unknown> = {
    eq: (c: string, v: unknown) => (cap.filtros.push(["eq", c, v]), chain),
    is: (c: string, v: unknown) => (cap.filtros.push(["is", c, v]), chain),
    select: () => chain,
    maybeSingle: async () => ({ data: devolve, error: null }),
  };
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        cap.patch = patch;
        return chain;
      },
    }),
  } as never);
}

function autorizado() {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER },
    org: { orgId: ORG, name: "Org", role: "agent" },
  } as never);
}

const chama = (corpo: unknown, id = PUB) =>
  POST(
    new NextRequest(`http://x/api/v1/djen/publicacoes/${id}/confirmar-prazo`, {
      method: "POST",
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ id }) },
  );

describe("confirmar prazo", () => {
  let cap: Cap;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T13:00:00Z"));
    cap = { filtros: [] };
  });
  afterEach(() => vi.useRealTimers());

  it("sem papel, recusa sem tocar no banco", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden", "x", 403) } as never);
    banco(cap, null);
    expect((await chama({ vence_em: "2026-11-05" })).status).toBe(403);
    expect(cap.patch).toBeUndefined();
  });

  it.each([
    ["sem data", {}],
    ["data que não existe", { vence_em: "2026-02-31" }],
    ["formato brasileiro", { vence_em: "05/11/2026" }],
    ["longe demais no futuro (2062 no lugar de 2026)", { vence_em: "2062-11-05" }],
    ["vencida há mais de 60 dias", { vence_em: "2026-08-01" }],
    ["observação longa", { vence_em: "2026-11-05", observacao: "x".repeat(301) }],
  ])("%s é recusado antes do banco", async (_, corpo) => {
    autorizado();
    banco(cap, null);
    expect((await chama(corpo)).status).toBe(422);
    expect(cap.patch).toBeUndefined();
  });

  it("id que não é uuid é recusado antes do banco", async () => {
    autorizado();
    banco(cap, null);
    expect((await chama({ vence_em: "2026-11-05" }, "1 or 1=1")).status).toBe(422);
    expect(cap.patch).toBeUndefined();
  });

  it("grava data, autor e momento, filtrando pela organização da sessão — nunca a do corpo", async () => {
    autorizado();
    banco(cap, { id: PUB, prazo_vence_em: "2026-11-05", prazo_confirmado_em: "2026-10-21T13:00:00Z" });
    const r = await chama({ vence_em: "2026-11-05", observacao: "  conferido na agenda ", organization_id: OUTRA_ORG });
    expect(r.status).toBe(200);
    expect(cap.patch).toMatchObject({
      prazo_vence_em: "2026-11-05",
      prazo_confirmado_por: USER,
      prazo_observacao: "conferido na agenda",
    });
    expect(typeof cap.patch!.prazo_confirmado_em).toBe("string");
    expect(cap.filtros).toContainEqual(["eq", "organization_id", ORG]);
    expect(cap.filtros).not.toContainEqual(["eq", "organization_id", OUTRA_ORG]);
    expect(cap.filtros).toContainEqual(["eq", "id", PUB]);
  });

  it("vencida há poucos dias passa: quem confirma atrasado registra o que aconteceu", async () => {
    autorizado();
    banco(cap, { id: PUB });
    expect((await chama({ vence_em: "2026-10-15" })).status).toBe(200);
    expect(cap.patch).toMatchObject({ prazo_vence_em: "2026-10-15", prazo_observacao: null });
  });

  it("publicação descartada não recebe prazo: 404", async () => {
    autorizado();
    banco(cap, null);
    const r = await chama({ vence_em: "2026-11-05" });
    expect(cap.filtros).toContainEqual(["is", "descartada_em", null]);
    expect(r.status).toBe(404);
  });
});
