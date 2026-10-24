import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 0001.E5 — a tela do painel de medição (`/app/painel`), segunda versão.
 *
 *   - mostra os cinco números, cada um com rótulo e definição (critério 12);
 *   - onde falta dado diz "não medido" e o motivo — nenhum número inventado, e ERRO DE LEITURA NUNCA VIRA ZERO;
 *   - ISOLAMENTO: TODA consulta filtra pela organização ativa;
 *   - o período padrão é 30 dias e o seletor aceita 7/30/90; o fuso é o da organização.
 *
 * MUTAÇÕES: provadas em 23/10/2026 por `C:/t/mut-painel/mutar.cjs` (cada uma aplicada, vista acusar e desfeita):
 *   1. apagar `.eq("organization_id", org)` da leitura de `crm_leads` → reprovou "TODA consulta filtra pela organização ativa".
 *   2. `fusoLido` sempre verdadeiro (erro em `organizations` ignorado) → reprovou "sem o fuso da organização nada é medido".
 *   3. `lerDias` devolvendo o valor cru da URL → reprovou "período inválido volta para 30 dias".
 *   4. o erro de `crm_leads` descartado em `lerEmPaginas` (voltar ao `const { data }`) → reprovou "erro ao ler os casos".
 *   5. tirar `{ count: "exact" }` das leituras → reprovou "max_rows menor que a página".
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
type Linha = Record<string, unknown>;
const consultas: Array<{ tabela: string; filtros: Filtro[] }> = [];
const banco = vi.hoisted(() => ({
  tabelas: {} as Record<string, Linha[]>,
  organizacao: { timezone: "America/Sao_Paulo" } as unknown,
  /** tabelas cuja leitura devolve `error` */
  erros: {} as Record<string, boolean>,
  /** o `max_rows` do PostgREST da instalação */
  maxRows: Number.POSITIVE_INFINITY,
  /** força o `count` de uma tabela (para simular o teto) */
  contagem: {} as Record<string, number>,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      const c = { tabela, filtros: [] as Filtro[] };
      consultas.push(c);
      let pedeCount = false;
      let de = 0;
      let ate: number | null = null;
      const chain: Record<string, unknown> = {};
      chain.select = (_cols: string, opts?: { count?: string }) => ((pedeCount = opts?.count === "exact"), chain);
      chain.order = () => chain;
      for (const m of ["eq", "is", "not", "in", "gte", "lte"]) {
        chain[m] = (k: string, ...v: unknown[]) => (c.filtros.push([m, k, ...v]), chain);
      }
      chain.range = (a: number, b: number) => ((de = a), (ate = b), chain);
      chain.maybeSingle = async () =>
        banco.erros[tabela] ? { data: null, error: { message: "falha" } } : { data: banco.organizacao, error: null };
      chain.then = (ok: (r: unknown) => unknown) => {
        if (banco.erros[tabela]) return ok({ data: null, error: { message: "falha" }, count: null });
        // eq/in só filtram quando a fixture tem a coluna (as fixtures não repetem organization_id)
        const linhas = (banco.tabelas[tabela] ?? []).filter((l) =>
          c.filtros.every(([m, k, v]) => {
            if (!(typeof k === "string" && k in l)) return true;
            if (m === "eq") return l[k] === v;
            if (m === "in") return (v as unknown[]).includes(l[k]);
            return true;
          }),
        );
        const total = banco.contagem[tabela] ?? linhas.length;
        const pedido = ate === null ? linhas.length : ate - de + 1;
        const fatia = linhas.slice(de, de + Math.min(pedido, banco.maxRows));
        return ok({ data: fatia, error: null, count: pedeCount ? total : null });
      };
      return chain;
    },
  }),
}));

import PainelDeMedicao from "@/app/app/painel/page";

const CFG = { filters: { business_hours: { timezone: "America/Sao_Paulo", start: "08:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] } } };
const agente = (extra: Record<string, unknown> = {}) => ({ id: "ag1", name: "Atendente", created_at: "2026-01-01T00:00:00Z", published_version_id: "v1", ...extra });
const caso = (id: string, extra: Record<string, unknown> = {}, campos: Record<string, unknown> = {}) => ({
  id,
  status: "open",
  created_at: "2026-10-01T15:00:00Z",
  custom_fields: { area_do_direito: "Trabalhista", triagem_em: "2026-10-15T15:00:00Z", triagem_decisao: "seguir", ...campos },
  ...extra,
});

async function abre(dias?: string) {
  render(await PainelDeMedicao({ searchParams: Promise.resolve(dias === undefined ? {} : { dias }) }));
}
const numero = (id: string) => screen.getByTestId(`numero-${id}`).textContent;
const etapa = (id: string) => screen.getByTestId(`etapa-${id}`).textContent ?? "";
const filtroDe = (tabela: string, op: string) => consultas.find((c) => c.tabela === tabela)!.filtros.find((f) => f[0] === op);

beforeEach(() => {
  consultas.length = 0;
  banco.tabelas = {};
  banco.organizacao = { timezone: "America/Sao_Paulo" };
  banco.erros = {};
  banco.maxRows = Number.POSITIVE_INFINITY;
  banco.contagem = {};
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const CENARIO_COMPLETO = () => ({
  ai_agents: [agente()],
  ai_agent_versions: [{ id: "v1", trigger_config: CFG }],
  conversations: [
    { id: "c1", created_at: "2026-10-21T01:30:00Z", is_group: false }, // ter 22:30 → fora
    { id: "c2", created_at: "2026-10-21T13:00:00Z", is_group: false }, // qua 10:00 → dentro
    { id: "g1", created_at: "2026-10-21T01:30:00Z", is_group: true }, // grupo: fora da conta
  ],
  messages: [
    { id: "m1", conversation_id: "c1", created_at: "2026-10-21T01:30:00Z", direction: "inbound", type: "text" },
    { id: "m2", conversation_id: "c2", created_at: "2026-10-21T13:00:00Z", direction: "inbound", type: "text" },
  ],
  crm_leads: [
    caso("l1", { status: "won" }),
    caso("l2"),
    caso("l3", {}, { triagem_decisao: "recusar" }),
    caso("l4", {}, { triagem_em: undefined }), // sem registro da triagem: fora
  ],
  crm_lead_links: [
    { id: "k1", lead_id: "l1", target_id: "q1", target_kind: "appointment" },
    { id: "k2", lead_id: "l2", target_id: "q2", target_kind: "appointment" },
  ],
  calendar_appointments: [
    { id: "q1", status: "completed", starts_at: "2026-10-18T15:00:00Z" },
    { id: "q2", status: "no_show", starts_at: "2026-10-19T15:00:00Z" },
  ],
});

describe("painel de medição", () => {
  it("mostra os cinco números com rótulo, denominador, definição e taxa de passagem", async () => {
    banco.tabelas = CENARIO_COMPLETO();
    await abre();

    const rotulos: Array<[string, string, string]> = [
      ["fora_do_horario", "Primeiros contatos fora do horário", "1"],
      ["triados", "Triados", "3"],
      ["agendados", "Agendados", "2"],
      ["compareceram", "Compareceram", "1"],
      ["clientes", "Viraram cliente", "1"],
    ];
    for (const [id, rotulo, valor] of rotulos) {
      expect(within(screen.getByTestId(`etapa-${id}`)).getByRole("heading").textContent).toContain(rotulo);
      expect(numero(id)).toBe(valor);
    }
    expect(etapa("fora_do_horario")).toContain("1 de 2 primeiros contatos no período");
    expect(etapa("agendados")).toContain("2 de 2 triados não recusados · 100% da etapa anterior");
    expect(etapa("compareceram")).toContain("1 de 2 casos agendados com consulta já passada · 50% da etapa anterior");
    expect(etapa("clientes")).toContain("1 de 1 casos que compareceram · 100% da etapa anterior");
    // triados: o desdobramento por decisão da triagem
    expect(screen.getByTestId("desdobramento-da-triagem").textContent).toContain("Seguiram: 2 · Recusados: 1 · Passaram ao advogado: 0");
    // definições à mostra
    expect(screen.getByText(/a primeira mensagem do cliente, em toda a história, caiu no período/)).toBeTruthy();
    expect(screen.getByText(/Conta só casos que a triagem registrou/)).toBeTruthy();
    expect(screen.getByText(/os que foram ganhos no funil/)).toBeTruthy();
    // o horário usado e o que ele vale
    const horario = screen.getByTestId("horario-usado").textContent ?? "";
    expect(horario).toContain("08:00–18:00");
    expect(horario).toContain("Atendente");
    expect(horario).toContain("é o horário publicado hoje e vale para o período inteiro");
    // a velha frase que ficaria falsa quando a triagem passa a gravar
    expect(document.body.textContent).not.toContain("A triagem ainda não grava");
  });

  it("ganho sem consulta realizada aparece em linha própria", async () => {
    banco.tabelas = {
      ...CENARIO_COMPLETO(),
      crm_leads: [caso("l1", { status: "won" }), caso("l2", { status: "won" })],
      crm_lead_links: [{ id: "k1", lead_id: "l1", target_id: "q1", target_kind: "appointment" }],
      calendar_appointments: [{ id: "q1", status: "completed", starts_at: "2026-10-18T15:00:00Z" }],
    };
    await abre();
    expect(numero("clientes")).toBe("1");
    expect(screen.getByTestId("ganhos-sem-consulta").textContent).toContain("Ganhos sem consulta realizada: 1 de 2");
  });

  it("sem horário configurado, 'fora do horário' diz não medido — e não um zero", async () => {
    banco.tabelas = { ...CENARIO_COMPLETO(), ai_agents: [], ai_agent_versions: [] };
    await abre();
    expect(numero("fora_do_horario")).toBe("não medido");
    expect(etapa("fora_do_horario")).toContain("nenhum agente publicado tem horário de funcionamento configurado");
  });

  it("horário que atravessa a meia-noite tem mensagem própria", async () => {
    banco.tabelas = {
      ...CENARIO_COMPLETO(),
      ai_agent_versions: [{ id: "v1", trigger_config: { filters: { business_hours: { timezone: "America/Sao_Paulo", start: "22:00", end: "02:00", weekdays: [1, 2] } } } }],
    };
    await abre();
    expect(numero("fora_do_horario")).toBe("não medido");
    expect(etapa("fora_do_horario")).toContain("horário que atravessa a meia-noite não é suportado");
    expect(etapa("fora_do_horario")).not.toContain("nenhum agente publicado tem horário");
  });

  it("avisa quando o fuso do escritório e o da janela do agente são diferentes", async () => {
    banco.organizacao = { timezone: "America/Manaus" };
    banco.tabelas = CENARIO_COMPLETO();
    await abre();
    const aviso = screen.getByTestId("aviso-fusos").textContent ?? "";
    expect(aviso).toContain("America/Manaus");
    expect(aviso).toContain("America/Sao_Paulo");
  });

  it("consulta passada sem desfecho: 'compareceram' diz não medido, quantas faltam e por quê", async () => {
    banco.tabelas = {
      crm_leads: [caso("l1")],
      crm_lead_links: [{ id: "k1", lead_id: "l1", target_id: "q1", target_kind: "appointment" }],
      calendar_appointments: [{ id: "q1", status: "confirmed", starts_at: "2026-10-18T15:00:00Z" }],
    };
    await abre();
    expect(numero("agendados")).toBe("1");
    expect(numero("compareceram")).toBe("não medido");
    expect(etapa("compareceram")).toContain("falta registrar o desfecho de 1 consultas que já passaram");
    expect(numero("clientes")).toBe("não medido");
    expect(etapa("clientes")).not.toMatch(/\d%/);
  });

  it("consultas futuras saem da conta e aparecem como 'ainda por acontecer'", async () => {
    banco.tabelas = {
      crm_leads: [caso("l1"), caso("l2")],
      crm_lead_links: [
        { id: "k1", lead_id: "l1", target_id: "q1", target_kind: "appointment" },
        { id: "k2", lead_id: "l2", target_id: "q2", target_kind: "appointment" },
      ],
      calendar_appointments: [
        { id: "q1", status: "completed", starts_at: "2026-10-18T15:00:00Z" },
        { id: "q2", status: "confirmed", starts_at: "2026-10-30T15:00:00Z" },
      ],
    };
    await abre();
    expect(etapa("compareceram")).toContain("1 de 1 casos agendados com consulta já passada");
    expect(screen.getByTestId("ainda-por-acontecer").textContent).toContain("1 casos agendados com consulta ainda por acontecer");
  });

  it("banco vazio: nenhum número inventado e nenhuma taxa", async () => {
    await abre();
    expect(numero("fora_do_horario")).toBe("não medido");
    expect(numero("triados")).toBe("0");
    expect(numero("agendados")).toBe("0");
    expect(numero("clientes")).toBe("0");
    expect(document.body.textContent).not.toMatch(/\d%/);
    expect(document.body.textContent).not.toContain("A triagem ainda não grava");
  });
});

describe("erro de leitura nunca vira zero", () => {
  it("erro ao ler os casos: as etapas que dependem deles dizem 'não medido', com aviso — e nenhum 0", async () => {
    banco.tabelas = CENARIO_COMPLETO();
    banco.erros = { crm_leads: true };
    await abre();
    expect(screen.getByRole("alert").textContent).toContain("Erro ao ler os casos");
    for (const id of ["triados", "agendados", "compareceram", "clientes"]) expect(numero(id), id).toBe("não medido");
    expect(etapa("triados")).toContain("erro ao ler os dados desta etapa");
    // a etapa 1 não depende dos casos
    expect(numero("fora_do_horario")).toBe("1");
  });

  it("erro ao ler as conversas: primeiros contatos não medido", async () => {
    banco.tabelas = CENARIO_COMPLETO();
    banco.erros = { conversations: true };
    await abre();
    expect(numero("fora_do_horario")).toBe("não medido");
    expect(screen.getByRole("alert").textContent).toContain("Erro ao ler as conversas");
    expect(numero("triados")).toBe("3");
  });

  it("erro ao ler o horário do agente: 'fora do horário' não medido, e não 'sem horário'", async () => {
    banco.tabelas = CENARIO_COMPLETO();
    banco.erros = { ai_agents: true };
    await abre();
    expect(numero("fora_do_horario")).toBe("não medido");
    expect(screen.getByRole("alert").textContent).toContain("Erro ao ler o horário do agente");
    expect(etapa("fora_do_horario")).not.toContain("nenhum agente publicado tem horário");
  });

  it("sem o fuso da organização nada é medido (e nem as outras tabelas são lidas)", async () => {
    banco.tabelas = CENARIO_COMPLETO();
    banco.erros = { organizations: true };
    await abre();
    for (const id of ["fora_do_horario", "triados", "agendados", "compareceram", "clientes"]) expect(numero(id), id).toBe("não medido");
    expect(screen.getByRole("alert").textContent).toContain("Erro ao ler o fuso da organização");
    expect(consultas.map((c) => c.tabela)).toEqual(["organizations"]);
  });

  it("organização invisível (sem linha e sem erro) também não é fuso lido", async () => {
    banco.organizacao = null;
    await abre();
    expect(numero("triados")).toBe("não medido");
  });

  it("bateu no teto de linhas: 'não medido — leitura parcial', sem mostrar o número parcial", async () => {
    banco.tabelas = CENARIO_COMPLETO();
    banco.contagem = { conversations: 10_001 };
    await abre();
    expect(numero("fora_do_horario")).toBe("não medido");
    expect(screen.getByRole("alert").textContent).toContain("Leitura parcial: as conversas");
    expect(etapa("fora_do_horario")).toContain("leitura parcial");
  });

  it("max_rows menor que a página: a leitura continua de onde parou e conta tudo", async () => {
    banco.maxRows = 300;
    banco.tabelas = {
      ai_agents: [agente()],
      ai_agent_versions: [{ id: "v1", trigger_config: CFG }],
      conversations: Array.from({ length: 1200 }, (_, i) => ({ id: `c${i}`, created_at: "2026-10-21T13:00:00Z", is_group: false })),
      messages: Array.from({ length: 1200 }, (_, i) => ({ id: `m${i}`, conversation_id: `c${i}`, created_at: "2026-10-21T13:00:00Z", direction: "inbound", type: "text" })),
    };
    await abre();
    expect(etapa("fora_do_horario")).toContain("0 de 1200 primeiros contatos no período");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("isolamento e período", () => {
  it("TODA consulta filtra pela organização ativa", async () => {
    banco.tabelas = CENARIO_COMPLETO();
    await abre();
    const tabelas = [...new Set(consultas.map((c) => c.tabela))].sort();
    expect(tabelas).toEqual(
      ["ai_agent_versions", "ai_agents", "calendar_appointments", "conversations", "crm_lead_links", "crm_leads", "messages", "organizations"].sort(),
    );
    for (const c of consultas) {
      const chave = c.tabela === "organizations" ? "id" : "organization_id";
      expect(c.filtros, c.tabela).toContainEqual(["eq", chave, "org-a"]);
    }
  });

  it("o período padrão é 30 dias do calendário do escritório, hoje incluído", async () => {
    await abre();
    // 21/10 em Brasília; 30 dias incluindo hoje começam em 22/09
    expect(filtroDe("crm_leads", "gte")).toEqual(["gte", "custom_fields->>triagem_em", "2026-09-22T03:00:00.000Z"]);
    expect(filtroDe("conversations", "gte")).toEqual(["gte", "created_at", "2026-09-22T03:00:00.000Z"]);
    expect(screen.getByTestId("periodo-do-painel").textContent).toContain("America/Sao_Paulo");
    expect(screen.getByRole("link", { name: "30 dias" }).getAttribute("aria-current")).toBe("page");
  });

  it("o seletor oferece 7, 30 e 90 dias, e 7 recorta o período", async () => {
    await abre("7");
    expect(filtroDe("conversations", "gte")).toEqual(["gte", "created_at", "2026-10-15T03:00:00.000Z"]);
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
    expect(filtroDe("conversations", "gte")).toEqual(["gte", "created_at", "2026-10-15T04:00:00.000Z"]);
  });
});
