/**
 * `registrar_triagem` sem banco: o executor contra um `Consultavel` falso. Cobre o que a revisão da parte 3 achou
 * (spec 0001.E3) — o banco de verdade continua em `tests/invariants/triagem-juridica.test.ts`.
 *
 *   B. a marca de urgência do modelo: só `true` ou um tipo do léxico conta;
 *   C. conflito: o campo do caso leva `true` e IDS, nunca o nome do outro cliente — e o que volta ao turno também não;
 *   D. SEM config de áreas a área só é registrada (`seguir`); COM config, área desconhecida vai ao advogado;
 *      urgência e conflito valem com e sem config;
 *   E. `registraUrgenciaNoCaso`: mescla só urgência e data, sem tocar a decisão.
 *
 * MUTAÇÕES (24/10/2026, `C:/t/mut-triagem/mutar2.cjs`; aplicadas, acusadas pelo teste citado e desfeitas):
 *   - `urgenciaDoModelo` voltando a aceitar qualquer texto → "não há urgência" e "sem urgência aparente" acusam;
 *   - gravar `nome` no campo do conflito → "o campo do conflito leva true e ids, nunca o nome" acusa;
 *   - devolver o `nome` na decisão → "o que volta ao turno não leva o nome" acusa;
 *   - tirar o `configVazia` de `decideArea` → "sem config a área só é registrada" acusa;
 *   - `registraUrgenciaNoCaso` gravando também `triagem_decisao` → "não mexe na decisão" acusa;
 *   - `registraUrgenciaNoCaso` sobrescrevendo a urgência que já estava → "mantém o que já estava" acusa.
 */
import { describe, expect, it } from "vitest";

import type { Consultavel } from "./banco";
import { CAMPOS_DA_TRIAGEM, executaRegistrarTriagem, registraUrgenciaNoCaso } from "./registrar-triagem";

type Contato = { id: string; name: string | null; display_name: string | null; casos: number; caso_ids: string[] };
type Estado = {
  settings: unknown;
  /** da mais antiga para a mais nova */
  mensagens: string[];
  contatos: Contato[];
  leads: Array<{ id: string; status: string; custom_fields: Record<string, unknown> }>;
  gravacoes: Array<Record<string, unknown>>;
  notas: number;
};

function banco(parcial: Partial<Estado> = {}): { db: Consultavel; e: Estado } {
  const e: Estado = { settings: {}, mensagens: [], contatos: [], leads: [{ id: "L1", status: "open", custom_fields: {} }], gravacoes: [], notas: 0, ...parcial };
  const db: Consultavel = {
    async query(sql: string, valores: unknown[] = []) {
      if (sql.includes("from public.organizations")) return { rows: [{ settings: e.settings }] as never[] };
      if (sql.includes("from public.messages")) return { rows: [...e.mensagens].reverse().map((body) => ({ body })) as never[] };
      if (sql.includes("from public.contacts c")) return { rows: e.contatos as never[] };
      if (sql.includes("from public.crm_leads l")) {
        return {
          rows: e.leads.map((l) => ({ ...l, organization_id: "org", pipeline_id: "p", last_activity_at: null, created_at: "2026-10-01T00:00:00Z" })) as never[],
        };
      }
      if (sql.includes("from public.crm_pipelines")) return { rows: [] };
      if (sql.includes("fn_lead_anotar_campos")) {
        const campos = JSON.parse(String(valores[2])) as Record<string, unknown>;
        e.gravacoes.push(campos);
        const lead = e.leads.find((l) => l.id === valores[1]);
        if (!lead) return { rows: [{ campos: null }] as never[] };
        lead.custom_fields = { ...lead.custom_fields, ...campos };
        return { rows: [{ campos: lead.custom_fields }] as never[] };
      }
      if (sql.includes("insert into public.crm_lead_activities")) {
        e.notas += 1;
        return { rows: [] };
      }
      throw new Error(`SQL inesperado: ${sql.slice(0, 60)}`);
    },
  };
  return { db, e };
}

const QUEM = { organizationId: "org", contactId: "contato", conversationId: "conversa" };
const PILOTO = { triagem: { areas_atendidas: ["trabalhista", "familia_sucessoes"], areas_recusadas: ["criminal"] } };
const MARIA: Contato = { id: "cm", name: "Maria da Silva Souza", display_name: null, casos: 2, caso_ids: ["lead-1", "lead-2"] };
const TRABALHO = ["Fui mandado embora ontem, trabalhei 4 anos sem carteira assinada"];

describe("B — a marca de urgência do modelo", () => {
  it.each(["não há urgência", "sem urgência aparente", "nenhuma urgência", "urgente", "talvez prazo na semana que vem", "nenhuma", "não", "false"])(
    "'%s' NÃO conta",
    async (texto) => {
      const { db } = banco({ mensagens: TRABALHO });
      const d = await executaRegistrarTriagem(db, QUEM, { area_do_direito: "Trabalhista", urgencia: texto });
      expect(d.acao).toBe("seguir");
    },
  );

  it("`false` e ausente não contam", async () => {
    const { db } = banco({ mensagens: TRABALHO });
    expect((await executaRegistrarTriagem(db, QUEM, { area_do_direito: "Trabalhista", urgencia: false })).acao).toBe("seguir");
    expect((await executaRegistrarTriagem(db, QUEM, { area_do_direito: "Trabalhista" })).acao).toBe("seguir");
  });

  it.each([true, "prazo", "Prazo correndo", "preso", "audiência", "despejo", "liminar", "alimentos_atrasados"])("%s conta", async (marca) => {
    const { db, e } = banco({ mensagens: TRABALHO });
    const d = await executaRegistrarTriagem(db, QUEM, { area_do_direito: "Trabalhista", urgencia: marca });
    expect(d).toMatchObject({ acao: "passar_ao_advogado", motivo: "urgencia" });
    expect(String(e.gravacoes[0]?.[CAMPOS_DA_TRIAGEM.urgencia])).toContain("marcada pelo agente");
  });
});

describe("C — conflito: o nome do outro cliente não vai para custom_fields", () => {
  const cenario = () => banco({ settings: PILOTO, mensagens: ["Quero abrir uma ação contra a Maria"], contatos: [MARIA] });

  it("o campo do conflito leva `true` e ids, nunca o nome", async () => {
    const { db, e } = cenario();
    // o cliente escreve "maria souza"; o escritório conhece "Maria da Silva Souza": é este segundo nome que não pode vazar
    const d = await executaRegistrarTriagem(db, QUEM, { area_do_direito: "Trabalhista", parte_contraria: "maria souza" });
    expect(d).toMatchObject({ acao: "passar_ao_advogado", motivo: "conflito" });
    const g = e.gravacoes[0]!;
    expect(g[CAMPOS_DA_TRIAGEM.conflitoPossivel]).toBe(true);
    expect(g[CAMPOS_DA_TRIAGEM.conflitoContatos]).toEqual(["cm"]);
    expect(g[CAMPOS_DA_TRIAGEM.conflitoCasos]).toEqual(["lead-1", "lead-2"]);
    expect(JSON.stringify(e.leads[0]!.custom_fields)).not.toMatch(/da Silva/i);
    // a parte contrária que o PRÓPRIO cliente citou continua gravada: é dele, e vai à ficha
    expect(g[CAMPOS_DA_TRIAGEM.parteContraria]).toBe("maria souza");
  });

  it("o que volta ao turno não leva o nome do outro cliente", async () => {
    const { db } = cenario();
    const d = await executaRegistrarTriagem(db, QUEM, { area_do_direito: "Trabalhista", parte_contraria: "maria souza" });
    if (d.acao !== "passar_ao_advogado") throw new Error("esperava passar ao advogado");
    expect(d.conflito).toHaveLength(1);
    expect(d.conflito[0]).not.toHaveProperty("nome");
    expect(d.conflito[0]).toMatchObject({ contactId: "cm", casoIds: ["lead-1", "lead-2"] });
    expect(JSON.stringify(d)).not.toMatch(/da Silva/i);
  });

  it("sem conflito, nada de conflito no campo", async () => {
    const { db, e } = banco({ settings: PILOTO, mensagens: TRABALHO, contatos: [MARIA] });
    const d = await executaRegistrarTriagem(db, QUEM, { area_do_direito: "Trabalhista", parte_contraria: "Padaria Pão Quente" });
    expect(d.acao).toBe("seguir");
    expect(Object.keys(e.gravacoes[0]!).filter((k) => k.startsWith("conflito"))).toEqual([]);
  });
});

describe("D — com e sem configuração de áreas", () => {
  it("SEM config (settings.triagem ausente ou vazio) a área só é registrada: seguir", async () => {
    for (const settings of [{}, null, { triagem: {} }, { triagem: { areas_atendidas: [], areas_recusadas: [] } }]) {
      const { db, e } = banco({ settings, mensagens: ["O INSS cortou meu benefício"] });
      const d = await executaRegistrarTriagem(db, QUEM, { area_do_direito: "Previdenciário" });
      expect(d.acao, JSON.stringify(settings)).toBe("seguir");
      expect(e.gravacoes[0]).toMatchObject({ area_do_direito: "Previdenciário", triagem_decisao: "seguir" });
    }
  });

  it("SEM config nem a área criminal é recusada ou entregue: é registrada", async () => {
    const { db } = banco({ settings: {}, mensagens: ["Preciso de ajuda com um processo de furto"] });
    expect((await executaRegistrarTriagem(db, QUEM, { area_do_direito: "Criminal" })).acao).toBe("seguir");
  });

  it("COM config, área desconhecida continua indo ao advogado", async () => {
    const { db } = banco({ settings: PILOTO, mensagens: ["O INSS cortou meu benefício"] });
    expect(await executaRegistrarTriagem(db, QUEM, { area_do_direito: "Previdenciário" })).toMatchObject({
      acao: "passar_ao_advogado",
      motivo: "area_a_decidir",
    });
  });

  it("COM config, a área atendida segue e a recusada é recusada (sem guardar a história)", async () => {
    const a = banco({ settings: PILOTO, mensagens: TRABALHO });
    expect((await executaRegistrarTriagem(a.db, QUEM, { area_do_direito: "Trabalhista" })).acao).toBe("seguir");
    const b = banco({ settings: PILOTO, mensagens: ["Preciso de ajuda com um processo de furto"] });
    const d = await executaRegistrarTriagem(b.db, QUEM, { area_do_direito: "Criminal", resumo_do_caso: "furto na loja" });
    expect(d.acao).toBe("recusar");
    expect(b.e.gravacoes[0]).not.toHaveProperty("resumo_do_caso");
  });

  it("urgência e conflito valem COM e SEM config", async () => {
    for (const settings of [{}, PILOTO]) {
      const u = banco({ settings, mensagens: ["Meu prazo no processo vence amanhã"], contatos: [MARIA] });
      expect(await executaRegistrarTriagem(u.db, QUEM, { area_do_direito: "Trabalhista" })).toMatchObject({ motivo: "urgencia" });
      const c = banco({ settings, mensagens: TRABALHO, contatos: [MARIA] });
      expect(await executaRegistrarTriagem(c.db, QUEM, { area_do_direito: "Trabalhista", parte_contraria: "Maria da Silva Souza" })).toMatchObject({ motivo: "conflito" });
    }
  });
});

describe("E — registraUrgenciaNoCaso", () => {
  const prazo = { tipo: "prazo", trecho: "meu prazo vence" } as const;
  const preso = { tipo: "preso", trecho: "foi preso" } as const;
  const AGORA = () => new Date("2026-10-24T12:00:00Z");

  it("mescla só a urgência e a data — não mexe na decisão da triagem", async () => {
    const { db, e } = banco({
      leads: [{ id: "L1", status: "open", custom_fields: { area_do_direito: "Trabalhista", triagem_decisao: "seguir", triagem_motivo: null, numero_processo: "1" } }],
    });
    const r = await registraUrgenciaNoCaso(db, QUEM, [prazo], { agora: AGORA });
    expect(r).toEqual({ gravado: true, casoId: "L1" });
    expect(Object.keys(e.gravacoes[0]!).sort()).toEqual(["triagem_em", "urgencia_juridica"]);
    expect(e.gravacoes[0]).toEqual({ urgencia_juridica: "prazo correndo: «meu prazo vence»", triagem_em: "2026-10-24T12:00:00.000Z" });
    // o resto do caso intacto
    expect(e.leads[0]!.custom_fields).toMatchObject({ triagem_decisao: "seguir", area_do_direito: "Trabalhista", numero_processo: "1" });
  });

  it("mantém o que já estava e não repete", async () => {
    const { db, e } = banco({ leads: [{ id: "L1", status: "open", custom_fields: { urgencia_juridica: "prazo correndo: «meu prazo vence»" } }] });
    await registraUrgenciaNoCaso(db, QUEM, [prazo, preso], { agora: AGORA });
    expect(e.gravacoes[0]!.urgencia_juridica).toBe("prazo correndo: «meu prazo vence» | pessoa presa ou na delegacia: «foi preso»");
  });

  it("sem urgência não grava nada; sem caso aberto diz por quê", async () => {
    const a = banco();
    expect(await registraUrgenciaNoCaso(a.db, QUEM, [])).toEqual({ gravado: false, casoId: null });
    expect(a.e.gravacoes).toEqual([]);
    const b = banco({ leads: [] });
    expect(await registraUrgenciaNoCaso(b.db, QUEM, [prazo])).toEqual({ gravado: false, casoId: null, motivo: "sem_caso_aberto" });
    const c = banco({ leads: [{ id: "L9", status: "lost", custom_fields: {} }] });
    expect((await registraUrgenciaNoCaso(c.db, QUEM, [prazo])).gravado).toBe(false);
  });
});
