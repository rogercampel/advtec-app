import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 0001.E4 — a LISTA das fichas dos casos (`/app/fichas`).
 *
 * Achado no teste de fumaça de 22/10/2026: os dois casos locais apareciam como
 * "Caso sem contato", e os dois TINHAM contato — só não tinham nome, apenas telefone.
 * A lista só não tinha teste nenhum. Regra: com contato, mostra o rótulo da casa
 * (`rotuloDoContato`: nome, ou o telefone); "Caso sem contato" só quando não há contato.
 */

vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`);
  },
}));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: async () => ({ id: "u1", idioma: "pt" }),
  resolveActiveOrg: async () => ({ orgId: "org-a", name: "Escritório A", role: "agent" }),
}));

type Filtro = [string, unknown];
const consultas: Array<{ tabela: string; colunas: string; filtros: Filtro[] }> = [];
const banco = vi.hoisted(() => ({ casos: [] as unknown[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      const c = { tabela, colunas: "", filtros: [] as Filtro[] };
      consultas.push(c);
      const chain: Record<string, unknown> = {};
      chain.select = (col: string) => ((c.colunas = col), chain);
      for (const m of ["order", "limit"]) chain[m] = () => chain;
      chain.eq = (k: string, v: unknown) => (c.filtros.push([k, v]), chain);
      chain.then = (ok: (r: unknown) => unknown) => ok({ data: banco.casos });
      return chain;
    },
  }),
}));

import FichasDosCasos from "@/app/app/fichas/page";

const caso = (id: string, contacts: unknown) => ({ id, title: null, created_at: "2026-10-22T15:49:00Z", contacts });

beforeEach(() => {
  consultas.length = 0;
  banco.casos = [];
});
afterEach(() => cleanup());

describe("lista das fichas", () => {
  it("contato só com telefone aparece pelo telefone, não como 'Caso sem contato'", async () => {
    banco.casos = [caso("c1", { name: null, display_name: null, phone_number: "+5586999990000" })];
    render(await FichasDosCasos());
    expect(screen.queryByText(/Caso sem contato/)).toBeNull();
    // `phoneForDisplay` mostra o canônico com o nono dígito, como a ficha mostra.
    expect(screen.getByText(/\+5586999990000/)).toBeTruthy();
  });

  it("contato com nome aparece pelo nome", async () => {
    banco.casos = [caso("c1", { name: "Maria Souza", display_name: null, phone_number: "+5586999990000" })];
    render(await FichasDosCasos());
    expect(screen.getByText(/Maria Souza/)).toBeTruthy();
  });

  it("caso sem contato nenhum diz 'Caso sem contato'", async () => {
    banco.casos = [caso("c1", null)];
    render(await FichasDosCasos());
    expect(screen.getByText(/Caso sem contato/)).toBeTruthy();
  });

  it("a consulta filtra pela organização ativa e traz o telefone do contato", async () => {
    render(await FichasDosCasos());
    expect(consultas[0]).toMatchObject({ tabela: "crm_leads", filtros: [["organization_id", "org-a"]] });
    expect(consultas[0]!.colunas).toMatch(/phone_number/);
  });
});
