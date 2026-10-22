import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 0001.E4 (#18) — a tela da ficha do caso.
 *
 *   - caso de outro escritório é 404, e TODA consulta filtra pela organização ativa;
 *   - critério 10: a ficha mostra quem, histórico, documentos e compromissos sem abrir a conversa;
 *   - área/resumo/urgência sem triagem aparecem como "a definir", nunca como palpite;
 *   - agendar é `agent` em diante, pela rota da agenda, com o contato do caso.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`);
  },
  useRouter: () => ({ refresh }),
}));
const auth = vi.hoisted(() => ({ role: "agent" as string, admin: {} as Record<string, unknown> }));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: async () => ({ id: "u1", idioma: "pt", is_platform_admin: false, support: null, ...auth.admin }),
  resolveActiveOrg: async () => ({ orgId: "org-a", name: "Escritório A", role: auth.role }),
}));

type Filtro = [string, unknown];
const consultas: Array<{ tabela: string; filtros: Filtro[] }> = [];
const banco = vi.hoisted(() => ({ caso: null as unknown, mensagens: [] as unknown[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      const c = { tabela, filtros: [] as Filtro[] };
      consultas.push(c);
      const dados = (): unknown =>
        ({
          crm_leads: banco.caso,
          contacts: { id: "p1", name: "Maria Souza", display_name: null, phone_number: "+5586999990000" },
          messages: banco.mensagens,
          calendar_appointments: [{ id: "ap1", title: "Retorno", starts_at: "2099-01-10T13:00:00Z", status: "confirmed" }],
          calendar_event_types: [{ id: "tp1", name: "Consulta inicial" }],
          organizations: { timezone: "America/Sao_Paulo" },
        })[tabela];
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "not"]) chain[m] = () => chain;
      chain.eq = (k: string, v: unknown) => (c.filtros.push([k, v]), chain);
      chain.maybeSingle = async () => ({ data: dados() });
      chain.then = (ok: (r: unknown) => unknown) => ok({ data: dados(), count: Array.isArray(dados()) ? (dados() as unknown[]).length : null });
      return chain;
    },
  }),
}));

import FichaDoCaso from "@/app/app/fichas/[id]/page";

const ID = "11111111-1111-4111-8111-111111111111";
const abre = async (id = ID) => render(await FichaDoCaso({ params: Promise.resolve({ id }) }));

beforeEach(() => {
  consultas.length = 0;
  auth.role = "agent";
  auth.admin = {};
  banco.caso = { id: ID, title: "Cobrança indevida", custom_fields: {}, created_at: "2026-10-20T10:00:00Z", contact_id: "p1" };
  banco.mensagens = [
    { id: "m1", conversation_id: "conv1", direction: "inbound", body: "Segue o contrato", media_mime: "application/pdf", media_size_bytes: 204800, created_at: "2026-10-21T10:00:00Z" },
    { id: "m2", conversation_id: "conv1", direction: "outbound", body: "Recebemos, obrigado.", media_mime: null, media_size_bytes: null, created_at: "2026-10-21T10:05:00Z" },
  ];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("isolamento entre escritórios", () => {
  it("id que não é uuid é 404 antes de consultar o banco", async () => {
    await expect(abre("1 or 1=1")).rejects.toThrow("NOT_FOUND");
    expect(consultas).toEqual([]);
  });

  it("caso que a organização ativa não enxerga é 404", async () => {
    banco.caso = null;
    await expect(abre()).rejects.toThrow("NOT_FOUND");
    expect(consultas[0]).toMatchObject({ tabela: "crm_leads", filtros: expect.arrayContaining([["organization_id", "org-a"]]) });
  });

  it("toda consulta da ficha filtra pela organização ativa", async () => {
    await abre();
    for (const c of consultas) {
      const campo = c.tabela === "organizations" ? "id" : "organization_id";
      expect(c.filtros, c.tabela).toContainEqual([campo, "org-a"]);
    }
  });
});

describe("a ficha, legível sem abrir a conversa (critério 10)", () => {
  it("mostra quem, área e resumo a definir, documentos, compromissos e histórico", async () => {
    await abre();
    expect(screen.getByTestId("ficha-quem").textContent).toBe("Maria Souza · +5586999990000");
    expect(screen.getByTestId("ficha-area").textContent).toBe("a definir pela triagem jurídica");
    expect(screen.getByTestId("ficha-resumo").textContent).toBe("a definir pela triagem jurídica");
    expect(screen.getByTestId("ficha-urgencia").textContent).toMatch(/a definir pela triagem jurídica/);
    expect(screen.getByTestId("ficha-documentos").textContent).toMatch(/PDF · 200 KB/);
    expect(screen.getByTestId("ficha-compromissos").textContent).toMatch(/Retorno/);
    const historico = screen.getByTestId("ficha-historico").textContent ?? "";
    expect(historico.indexOf("Segue o contrato")).toBeLessThan(historico.indexOf("Recebemos, obrigado."));
  });

  it("o documento leva à conversa dele na caixa de entrada", async () => {
    await abre();
    expect(screen.getByRole("link", { name: "abrir na conversa" }).getAttribute("href")).toBe("/app/inbox?id=conv1");
  });
});

describe("agendar a consulta", () => {
  it("quem só vê não tem o formulário", async () => {
    auth.role = "viewer";
    await abre();
    expect(screen.queryByRole("form", { name: "Agendar consulta" })).toBeNull();
  });

  it("platform admin: só o escopo `full` agenda; o suporte só-leitura não ganha o formulário", async () => {
    auth.role = "viewer";
    auth.admin = { is_platform_admin: true, platform_admin_scope: "support_readonly" };
    await abre();
    expect(screen.queryByRole("form", { name: "Agendar consulta" })).toBeNull();
    cleanup();
    auth.admin = { is_platform_admin: true, platform_admin_scope: "full" };
    await abre();
    expect(screen.getByRole("form", { name: "Agendar consulta" })).toBeTruthy();
  });

  it("agent agenda pela rota da agenda, com o contato e a conversa mais recente do cliente", async () => {
    const enviados: Array<{ url: string; corpo: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        enviados.push({ url, corpo: JSON.parse(init.body) });
        return { ok: true, status: 201, json: async () => ({ data: {} }) } as Response;
      }),
    );
    await abre();
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2099-01-15T14:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Agendar consulta" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.url).toBe("/api/v1/agenda/agendamentos");
    expect(enviados[0]!.corpo).toMatchObject({ event_type_id: "tp1", contact_id: "p1", conversation_id: "conv1", title: "Consulta — Maria Souza" });
    expect(new Date(enviados[0]!.corpo.starts_at as string).toISOString()).toBe(enviados[0]!.corpo.starts_at);
  });

  it("a recusa da agenda (conflito, fora do horário) aparece como alerta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: { message: "Horário ocupado." } }) }) as Response));
    await abre();
    fireEvent.change(screen.getByLabelText("Data e hora"), { target: { value: "2099-01-15T14:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Agendar consulta" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Horário ocupado.");
  });
});
