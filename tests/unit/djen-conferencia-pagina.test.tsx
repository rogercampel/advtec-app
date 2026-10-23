import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 0006.E5 — a PÁGINA de publicações liga a conferência da contagem ao banco:
 *   - a consulta nova lê só as confirmações da organização ativa, as mais recentes primeiro;
 *   - ao bater no teto de linhas, a conferência avisa que é parcial (e não fala em confiar);
 *   - abaixo do teto, nenhum aviso.
 *
 * MUTAÇÃO (23/10/2026): trocar `cortada: (conferidas.data?.length ?? 0) >= LIMITE` por `cortada: false`
 * na página reprova "no teto, a conferência avisa…"; apagar `.eq("organization_id", org)` da consulta
 * `conferidas` reprova "a consulta da conferência filtra pela organização ativa".
 */

vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: async () => ({ id: "u1", idioma: "pt", is_platform_admin: false, support: null }),
  resolveActiveOrg: async () => ({ orgId: "org-a", name: "Escritório A", role: "agent" }),
}));
// A caixa e a pauta não são o assunto: a página só precisa entregar os `children`.
vi.mock("@/app/app/publicacoes/_components/PublicacoesClient", () => ({
  PublicacoesClient: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/app/app/publicacoes/_components/PautaDeHoje", () => ({ PautaDeHoje: () => null }));

type Filtro = unknown[];
const consultas: Array<{ tabela: string; filtros: Filtro[]; ordem: unknown[] }> = [];
const banco = vi.hoisted(() => ({ confirmadas: [] as unknown[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      const c = { tabela, filtros: [] as Filtro[], ordem: [] as unknown[] };
      consultas.push(c);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "limit", "in", "is", "gte"]) chain[m] = () => chain;
      for (const m of ["eq", "not"]) chain[m] = (...a: unknown[]) => (c.filtros.push([m, ...a]), chain);
      chain.order = (...a: unknown[]) => ((c.ordem = a), chain);
      // Só a consulta das confirmações (ordenada por `prazo_confirmado_em`) devolve linhas.
      chain.then = (ok: (r: unknown) => unknown) => ok({ data: c.ordem[0] === "prazo_confirmado_em" ? banco.confirmadas : [], error: null });
      return chain;
    },
  }),
}));

import PublicacoesPage from "@/app/app/publicacoes/page";

const linha = (i: number) => ({
  id: `p${i}`,
  organization_id: "org-a",
  numero_processo: `000${i}`,
  data_disponibilizacao: "2026-10-22",
  tipo_comunicacao: "Intimação",
  sigla_tribunal: "TJSP",
  nome_orgao: null,
  texto: "Manifeste-se no prazo de 5 (cinco) dias úteis.",
  descartada_em: null,
  prazo_vence_em: "2026-10-30",
  prazo_confirmado_em: "2026-10-21T15:00:00Z",
  prazo_observacao: null,
});

beforeEach(() => {
  consultas.length = 0;
  banco.confirmadas = [];
});
afterEach(() => cleanup());

describe("a conferência da contagem na página de publicações", () => {
  it("a consulta da conferência filtra pela organização ativa e lê as confirmações mais recentes primeiro", async () => {
    render(await PublicacoesPage());
    const c = consultas.find((q) => q.ordem[0] === "prazo_confirmado_em")!;
    expect(c.tabela).toBe("djen_publicacoes");
    expect(c.filtros).toContainEqual(["eq", "organization_id", "org-a"]);
    expect(c.filtros).toContainEqual(["not", "prazo_confirmado_em", "is", null]);
    expect(c.ordem[1]).toEqual({ ascending: false });
  });

  it("no teto de 300 linhas, a conferência avisa que é parcial", async () => {
    banco.confirmadas = Array.from({ length: 300 }, (_, i) => linha(i));
    render(await PublicacoesPage());
    expect(screen.getByTestId("conferencia-cortada").textContent).toBe("Leitura parcial: só as 300 confirmações mais recentes.");
    expect(screen.getByTestId("conferencia-da-contagem").textContent).not.toMatch(/pode começar a conversa/);
  });

  it("abaixo do teto, nenhum aviso de leitura parcial", async () => {
    banco.confirmadas = Array.from({ length: 299 }, (_, i) => linha(i));
    render(await PublicacoesPage());
    expect(screen.queryByTestId("conferencia-cortada")).toBeNull();
    expect(screen.getByTestId("conferencia-da-contagem").textContent).toContain("299 prazos confirmados");
  });
});
