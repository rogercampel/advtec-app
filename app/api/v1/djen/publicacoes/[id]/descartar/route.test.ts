/**
 * POST /api/v1/djen/publicacoes/[id]/descartar — "não é nossa" (spec 0009.E2).
 *
 * O que não pode acontecer: descarte sem motivo, descarte pela organização do
 * CORPO (o filtro vem de `requireRole`), e descarte que apaga um descarte
 * anterior (só sai da caixa quem ainda está nela).
 *
 * MUTAÇÕES (20/10/2026), uma por vez, restauradas e conferidas — 7 de 7 acusadas
 * (junto com tests/unit/djen-caixa.test.ts): descartada que continua na caixa,
 * negócio sem número que vira caso, motivo sem mínimo, organização do corpo,
 * descarte que reescreve o anterior, rota sem checar papel, id sem validar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    new NextRequest(`http://x/api/v1/djen/publicacoes/${id}/descartar`, {
      method: "POST",
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ id }) },
  );

describe("não é nossa", () => {
  let cap: Cap;
  beforeEach(() => {
    vi.clearAllMocks();
    cap = { filtros: [] };
  });

  it("sem papel, recusa sem tocar no banco", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden", "x", 403) } as never);
    banco(cap, null);
    const r = await chama({ motivo: "homônimo da OAB" });
    expect(r.status).toBe(403);
    expect(cap.patch).toBeUndefined();
  });

  it("motivo curto é recusado — descarte sem motivo é o descarte silencioso", async () => {
    autorizado();
    banco(cap, null);
    const r = await chama({ motivo: "  x " });
    expect(r.status).toBe(422);
    expect(cap.patch).toBeUndefined();
  });

  it("id que não é uuid é recusado antes do banco", async () => {
    autorizado();
    banco(cap, null);
    expect((await chama({ motivo: "homônimo da OAB" }, "1 or 1=1")).status).toBe(422);
    expect(cap.patch).toBeUndefined();
  });

  it("grava data, autor e motivo, filtrando pela organização da sessão — nunca a do corpo", async () => {
    autorizado();
    banco(cap, { id: PUB, descartada_em: "2026-10-20T10:00:00Z" });
    const r = await chama({ motivo: "  processo de outro escritório ", organization_id: OUTRA_ORG });
    expect(r.status).toBe(200);
    expect(cap.patch).toMatchObject({ descartada_por: USER, descartada_motivo: "processo de outro escritório" });
    expect(typeof cap.patch!.descartada_em).toBe("string");
    expect(cap.filtros).toContainEqual(["eq", "organization_id", ORG]);
    expect(cap.filtros).not.toContainEqual(["eq", "organization_id", OUTRA_ORG]);
    expect(cap.filtros).toContainEqual(["eq", "id", PUB]);
  });

  it("só descarta quem ainda está na caixa: já descartada vira 404, sem reescrever o motivo", async () => {
    autorizado();
    banco(cap, null);
    const r = await chama({ motivo: "homônimo da OAB" });
    expect(cap.filtros).toContainEqual(["is", "descartada_em", null]);
    expect(r.status).toBe(404);
  });

  it("publicação com prazo confirmado não é descartada: a data conferida não pode sumir (0006.E5)", async () => {
    autorizado();
    banco(cap, null);
    const r = await chama({ motivo: "homônimo da OAB" });
    expect(cap.filtros).toContainEqual(["is", "prazo_vence_em", null]);
    expect(r.status).toBe(404);
  });
});
