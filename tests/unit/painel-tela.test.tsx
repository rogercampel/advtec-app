import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 0001.E5 — a tela do painel de medição (`/app/painel`).
 *
 *   - mostra os cinco números, cada um com rótulo e definição (critério 12);
 *   - onde falta dado diz "não medido" e o motivo — nenhum número inventado;
 *   - ISOLAMENTO: TODA consulta filtra pela organização ativa;
 *   - o período padrão é 30 dias e o seletor aceita 7/30/90.
 *
 * MUTAÇÕES (provadas em 23/10/2026, cada uma desfeita depois de ver o teste acusar):
 *   1. apagar `.eq("organization_id", org)` da consulta de `crm_leads` na página → reprovou
 *      "toda consulta filtra pela organização ativa".
 *   2. trocar `etapa.medida.medido ?` por sempre mostrar o valor (cai em `undefined`/0) → reprovou
 *      "sem horário configurado, 'fora do horário' diz não medido".
 *   3. `lerDias` devolvendo o valor cru da URL → reprovou "período inválido volta para 30 dias".
 */

vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`);
  },
}));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: async () => ({ id: "u1", idioma: "pt" }),
  resolveActiveOrg: async () => ({ orgId: "org-a", name: "Escritório A", role: "viewer" }),
}));

type Filtro = unknown[];
const consultas: Array<{ tabela: string; filtros: Filtro[] }> = [];
const banco = vi.hoisted(() => ({
  tabelas: {} as Record<string, unknown[]>,
  organizacao: { timezone: "America/Sao_Paulo" } as unknown,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      const c = { tabela, filtros: [] as Filtro[] };
      consultas.push(c);
      let pagina = 0;
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "order"]) chain[m] = () => chain;
      for (const m of ["eq", "is", "not", "in", "gte", "lte"]) {
        chain[m] = (k: string, ...v: unknown[]) => (c.filtros.push([m, k, ...v]), chain);
      }
      chain.range = (de: number) => ((pagina = de), chain);
      chain.maybeSingle = async () => ({ data: banco.organizacao });
      chain.then = (ok: (r: unknown) => unknown) => ok({ data: pagina === 0 ? (banco.tabelas[tabela] ?? []) : [] });
      return chain;
    },
  }),
}));

import PainelDeMedicao from "@/app/app/painel/page";

const CFG = { filters: { business_hours: { timezone: "America/Sao_Paulo", start: "08:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] } } };
const agente = (extra: Record<string, unknown> = {}) => ({ id: "ag1", name: "Atendente", created_at: "2026-01-01T00:00:00Z", published_version_id: "v1", ...extra });

async function abre(dias?: string) {
  render(await PainelDeMedicao({ searchParams: Promise.resolve(dias === undefined ? {} : { dias }) }));
}
const numero = (id: string) => screen.getByTestId(`numero-${id}`).textContent;

beforeEach(() => {
  consultas.length = 0;
  banco.tabelas = {};
  banco.organizacao = { timezone: "America/Sao_Paulo" };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("painel de medição", () => {
  it("mostra os cinco números com rótulo, definição e taxa de passagem", async () => {
    banco.tabelas = {
      ai_agents: [agente()],
      ai_agent_versions: [{ id: "v1", trigger_config: CFG }],
      messages: [
        { conversation_id: "c1", created_at: "2026-10-21T01:30:00Z", direction: "inbound", type: "text" }, // ter 22:30 → fora
        { conversation_id: "c2", created_at: "2026-10-21T13:00:00Z", direction: "inbound", type: "text" }, // qua 10:00 → dentro
      ],
      crm_leads: [
        { id: "l1", status: "won", custom_fields: { area_do_direito: "Trabalhista" }, contact_id: "p1", created_at: "2026-10-15T15:00:00Z" },
        { id: "l2", status: "open", custom_fields: { area_do_direito: "Família" }, contact_id: "p2", created_at: "2026-10-16T15:00:00Z" },
        { id: "l3", status: "open", custom_fields: {}, contact_id: "p3", created_at: "2026-10-17T15:00:00Z" },
      ],
      calendar_appointments: [
        { contact_id: "p1", status: "completed", starts_at: "2026-10-18T15:00:00Z" },
        { contact_id: "p2", status: "no_show", starts_at: "2026-10-19T15:00:00Z" },
      ],
    };
    await abre();

    const rotulos: Array<[string, string, string]> = [
      ["fora_do_horario", "Atendimentos fora do horário", "1"],
      ["triados", "Triados", "2"],
      ["agendados", "Agendados", "2"],
      ["compareceram", "Compareceram", "1"],
      ["clientes", "Viraram cliente", "1"],
    ];
    for (const [id, rotulo, valor] of rotulos) {
      const linha = screen.getByTestId(`etapa-${id}`);
      expect(within(linha).getByRole("heading").textContent).toContain(rotulo);
      expect(numero(id)).toBe(valor);
    }
    // o denominador do "fora do horário" é o total de atendimentos no período
    expect(screen.getByTestId("etapa-fora_do_horario").textContent).toContain("1 de 2 atendimentos no período");
    // taxas de passagem: agendados/triados = 100%, compareceram/agendados = 50%, clientes/compareceram = 100%
    expect(screen.getByTestId("etapa-agendados").textContent).toContain("100% da etapa anterior");
    expect(screen.getByTestId("etapa-compareceram").textContent).toContain("50% da etapa anterior");
    expect(screen.getByTestId("etapa-clientes").textContent).toContain("100% da etapa anterior");
    // a definição de cada etapa está na tela
    expect(screen.getByText(/primeira mensagem do cliente no período chegou fora do horário comercial/)).toBeTruthy();
    expect(screen.getByText(/os que foram ganhos no funil/)).toBeTruthy();
    // o horário usado é mostrado
    expect(screen.getByTestId("horario-usado").textContent).toContain("08:00–18:00");
    expect(screen.getByTestId("horario-usado").textContent).toContain("Atendente");
  });

  it("sem horário configurado, 'fora do horário' diz não medido — e não um zero", async () => {
    banco.tabelas = {
      messages: [{ conversation_id: "c1", created_at: "2026-10-21T01:30:00Z", direction: "inbound", type: "text" }],
    };
    await abre();
    expect(numero("fora_do_horario")).toBe("não medido");
    expect(screen.getByTestId("etapa-fora_do_horario").textContent).toContain("nenhum agente publicado tem horário de funcionamento configurado");
  });

  it("consulta que passou sem desfecho registrado: 'compareceram' diz não medido e por quê", async () => {
    banco.tabelas = {
      crm_leads: [{ id: "l1", status: "open", custom_fields: {}, contact_id: "p1", created_at: "2026-10-15T15:00:00Z" }],
      calendar_appointments: [{ contact_id: "p1", status: "confirmed", starts_at: "2026-10-18T15:00:00Z" }],
    };
    await abre();
    expect(numero("agendados")).toBe("1");
    expect(numero("compareceram")).toBe("não medido");
    expect(screen.getByTestId("etapa-compareceram").textContent).toContain("ninguém registrou se o cliente compareceu");
    // sem a etapa anterior medida, a taxa para 'clientes' não aparece
    expect(screen.getByTestId("etapa-clientes").textContent).not.toMatch(/\d%/);
  });

  it("banco vazio: nenhum número inventado; a triagem que não grava a área é dita", async () => {
    banco.tabelas = { crm_leads: [{ id: "l1", status: "open", custom_fields: {}, contact_id: "p1", created_at: "2026-10-15T15:00:00Z" }] };
    await abre();
    expect(numero("fora_do_horario")).toBe("não medido");
    expect(numero("triados")).toBe("0");
    expect(numero("agendados")).toBe("0");
    expect(numero("clientes")).toBe("0");
    expect(screen.getByText(/A triagem ainda não grava a área do direito nos casos/)).toBeTruthy();
    // nada de percentual onde a base é zero
    expect(document.body.textContent).not.toMatch(/\d%/);
  });

  it("TODA consulta filtra pela organização ativa", async () => {
    banco.tabelas = { ai_agents: [agente()], ai_agent_versions: [{ id: "v1", trigger_config: CFG }] };
    await abre();
    const tabelas = consultas.map((c) => c.tabela).sort();
    expect(tabelas).toEqual(["ai_agent_versions", "ai_agents", "calendar_appointments", "crm_leads", "messages", "organizations"].sort());
    for (const c of consultas) {
      const chave = c.tabela === "organizations" ? "id" : "organization_id";
      expect(c.filtros, c.tabela).toContainEqual(["eq", chave, "org-a"]);
    }
  });

  it("o período padrão é 30 dias do calendário do escritório, hoje incluído", async () => {
    await abre();
    // 21/10 em Brasília; 30 dias incluindo hoje começam em 22/09
    const desde = consultas.find((c) => c.tabela === "crm_leads")!.filtros.find((f) => f[0] === "gte");
    expect(desde).toEqual(["gte", "created_at", "2026-09-22T03:00:00.000Z"]);
    expect(screen.getByTestId("periodo-do-painel").textContent).toContain("America/Sao_Paulo");
    expect(screen.getByRole("link", { name: "30 dias" }).getAttribute("aria-current")).toBe("page");
  });

  it("o seletor oferece 7, 30 e 90 dias, e 7 recorta o período", async () => {
    await abre("7");
    const desde = consultas.find((c) => c.tabela === "messages")!.filtros.find((f) => f[0] === "gte");
    expect(desde).toEqual(["gte", "created_at", "2026-10-15T03:00:00.000Z"]);
    expect(screen.getByRole("link", { name: "7 dias" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "90 dias" }).getAttribute("href")).toBe("/app/painel?dias=90");
  });

  it("período inválido volta para 30 dias", async () => {
    await abre("1000");
    expect(screen.getByRole("link", { name: "30 dias" }).getAttribute("aria-current")).toBe("page");
  });

  it("o fuso da organização manda: em Manaus (UTC-4) o dia começa às 04:00 UTC", async () => {
    banco.organizacao = { timezone: "America/Manaus" };
    await abre("7");
    const desde = consultas.find((c) => c.tabela === "messages")!.filtros.find((f) => f[0] === "gte");
    expect(desde).toEqual(["gte", "created_at", "2026-10-15T04:00:00.000Z"]);
  });
});
