import { describe, expect, it } from "vitest";

import type { JanelaDeAtendimento } from "@/lib/agent-engine/agent/janela-de-atendimento";
import {
  calculaFunil,
  escolheHorario,
  fusoOuPadrao,
  inicioDoDia,
  lerDias,
  periodoDoFunil,
  type EntradaDoFunil,
  type EtapaId,
  type LinhaDeCaso,
  type LinhaDeConsulta,
  type LinhaDeConversa,
  type LinhaDeMensagem,
  type LinhaDeVinculo,
} from "@/lib/painel/funil";
import type { Leitura } from "@/lib/painel/leitura";

/**
 * 0001.E5 — a conta do painel de medição (`lib/painel/funil.ts`), segunda versão.
 *
 * MUTAÇÕES: provadas em 23/10/2026 por `C:/t/mut-painel/mutar.cjs` (cada uma aplicada, vista acusar e desfeita).
 * A lista e o teste que acusou cada uma estão no relatório da etapa e em `C:/t/mut-painel/mutar.log`.
 *   período:   fuso UTC no lugar do fuso da organização.
 *   etapa 1:   sem o filtro de conversa nova; sem a regra "primeira fala da história cai no período"; sem excluir grupo;
 *              `!== null` trocado por `=== null`; horário que atravessa a meia-noite devolvendo "sem horário".
 *   leituras:  erro ignorado; parcial ignorado; fuso ignorado.
 *   triados:   sem checar `triagem_em` no período; recusado contado como elegível; sem deduplicar por id.
 *   agenda:    consulta cancelada contando; desfecho faltando ignorado; futuras no denominador; ganho sem consulta contado como cliente.
 *   avisos:    `fusosDiferem` sempre falso.
 */

// Quarta-feira 21/10/2026, 12:00 em Brasília (UTC-3).
const AGORA = new Date("2026-10-21T15:00:00Z");
const JANELA: JanelaDeAtendimento = { timezone: "America/Sao_Paulo", start: "08:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] };

const ok = <T>(linhas: T[]): Leitura<T> => ({ linhas, estado: "ok" });
const HORARIO_OK = { janela: JANELA, agente: "Atendente", divergentes: false, atravessaMeiaNoite: null, estado: "ok" as const };

let seq = 0;
/** Um primeiro contato: a conversa nasce e a primeira fala do cliente chega em `iso`. */
function contato(iso: string, extra: { conversa?: Partial<LinhaDeConversa>; mensagens?: Partial<LinhaDeMensagem>[] } = {}) {
  const id = `c${++seq}`;
  const conversa: LinhaDeConversa = { id, created_at: iso, is_group: false, ...extra.conversa };
  const mensagens: LinhaDeMensagem[] = (extra.mensagens ?? [{}]).map((m) => ({
    id: `m${++seq}`,
    conversation_id: id,
    created_at: iso,
    direction: "inbound",
    type: "text",
    ...m,
  }));
  return { conversa, mensagens };
}
const contatos = (...lista: ReturnType<typeof contato>[]) => ({
  conversas: ok(lista.map((c) => c.conversa)),
  mensagens: ok(lista.flatMap((c) => c.mensagens)),
});

const caso = (id: string, campos: Record<string, unknown> = {}, extra: Partial<LinhaDeCaso> = {}): LinhaDeCaso => ({
  id,
  status: "open",
  created_at: "2026-10-01T15:00:00Z",
  custom_fields: { area_do_direito: "Trabalhista", triagem_em: "2026-10-15T15:00:00Z", triagem_decisao: "seguir", ...campos },
  ...extra,
});
const consulta = (id: string, status: string, starts = "2026-10-10T15:00:00Z"): LinhaDeConsulta => ({ id, status, starts_at: starts });
const vinculo = (lead: string, consultaId: string): LinhaDeVinculo => ({ id: `v-${lead}-${consultaId}`, lead_id: lead, target_id: consultaId });

function funil(parcial: Partial<EntradaDoFunil> = {}, dias = 30) {
  return calculaFunil({
    periodo: periodoDoFunil(dias, AGORA, "America/Sao_Paulo"),
    fusoLido: true,
    horario: HORARIO_OK,
    conversas: ok([]),
    mensagens: ok([]),
    casos: ok([]),
    vinculos: ok([]),
    consultas: ok([]),
    agora: AGORA,
    ...parcial,
  });
}
const etapa = (f: ReturnType<typeof funil>, id: EtapaId) => f.etapas.find((e) => e.id === id)!;
const NAO = (motivo: string, extra: Record<string, unknown> = {}) => ({ medido: false, motivo, ...extra });

describe("o período, no dia do escritório e não em UTC", () => {
  it("22h30 em Brasília é o dia 20 e não o 21", () => {
    // 22:30 do dia 20 em Brasília = 01:30 do dia 21 em UTC.
    const p = periodoDoFunil(1, new Date("2026-10-21T01:30:00Z"), "America/Sao_Paulo");
    expect(p.ate).toBe("2026-10-20");
    expect(p.de).toBe("2026-10-20");
  });

  it("a meia-noite do foro: o dia começa às 03:00 UTC, e 'últimos 7 dias' inclui hoje", () => {
    const p = periodoDoFunil(7, new Date("2026-10-21T01:30:00Z"), "America/Sao_Paulo");
    expect(p.de).toBe("2026-10-14");
    expect(p.inicio.toISOString()).toBe("2026-10-14T03:00:00.000Z");
    expect(inicioDoDia("2026-10-20", "America/Sao_Paulo").toISOString()).toBe("2026-10-20T03:00:00.000Z");
  });

  it("o fuso da organização manda no corte: em Lisboa, no horário de verão, o dia 1º de julho começa às 23:00 UTC do dia anterior", () => {
    expect(inicioDoDia("2026-07-01", "Europe/Lisbon").toISOString()).toBe("2026-06-30T23:00:00.000Z");
  });

  it("uma conversa 1 minuto antes da meia-noite do foro fica fora do período; a da própria meia-noite entra", () => {
    const periodo = periodoDoFunil(1, new Date("2026-10-21T01:30:00Z"), "America/Sao_Paulo");
    const f = funil({ periodo, ...contatos(contato("2026-10-20T02:59:00Z"), contato("2026-10-20T03:00:00Z")) });
    expect(f.totalDePrimeirosContatos).toBe(1);
  });

  it("fuso inválido ou vazio cai no do foro, sem lançar", () => {
    expect(fusoOuPadrao("Marte/Olympus")).toBe("America/Sao_Paulo");
    expect(fusoOuPadrao("")).toBe("America/Sao_Paulo");
    expect(fusoOuPadrao(null)).toBe("America/Sao_Paulo");
    expect(fusoOuPadrao("America/Fortaleza")).toBe("America/Fortaleza");
  });

  it("só 7, 30 e 90 dias; o resto vira 30", () => {
    expect([lerDias("7"), lerDias("30"), lerDias("90")]).toEqual([7, 30, 90]);
    expect([lerDias(undefined), lerDias("15"), lerDias("abc"), lerDias("0")]).toEqual([30, 30, 30, 30]);
  });
});

describe("etapa 1 — primeiros contatos fora do horário", () => {
  it("fora do horário: noite, fim de semana, antes da abertura e no minuto do fechamento; dentro: da abertura até o fechamento", () => {
    const f = funil(
      contatos(
        contato("2026-10-21T01:30:00Z"), // ter 20/10 22:30 BRT → fora
        contato("2026-10-17T14:00:00Z"), // sáb 17/10 11:00 BRT → fora
        contato("2026-10-21T10:59:00Z"), // qua 21/10 07:59 BRT → fora
        contato("2026-10-20T21:00:00Z"), // ter 20/10 18:00 BRT → fora (o fim é exclusivo)
        contato("2026-10-21T11:00:00Z"), // qua 21/10 08:00 BRT → dentro
        contato("2026-10-20T20:59:00Z"), // ter 20/10 17:59 BRT → dentro
      ),
    );
    expect(f.totalDePrimeirosContatos).toBe(6);
    expect(etapa(f, "fora_do_horario").medida).toEqual({ medido: true, valor: 4 });
    expect(etapa(f, "fora_do_horario").de).toBe(6);
  });

  it("cliente antigo: a conversa nasceu ANTES do período, e a mensagem de hoje não é primeiro contato", () => {
    const antigo = contato("2026-10-21T13:00:00Z", { conversa: { created_at: "2026-03-01T12:00:00Z" } });
    expect(funil(contatos(antigo)).totalDePrimeirosContatos).toBe(0);
  });

  it("história anterior ao período (conversa recriada, histórico importado): a primeira fala de TODA a história manda", () => {
    const importado = contato("2026-10-21T13:00:00Z", {
      mensagens: [{ created_at: "2026-02-01T13:00:00Z" }, { created_at: "2026-10-21T13:00:00Z" }],
    });
    expect(funil(contatos(importado)).totalDePrimeirosContatos).toBe(0);
  });

  it("vale a PRIMEIRA fala do cliente, não a última", () => {
    const f = funil(contatos(contato("2026-10-21T01:30:00Z", { mensagens: [{}, { created_at: "2026-10-21T13:00:00Z" }] })));
    expect(etapa(f, "fora_do_horario").medida).toEqual({ medido: true, valor: 1 });
    const g = funil(contatos(contato("2026-10-21T13:00:00Z", { mensagens: [{}, { created_at: "2026-10-21T23:30:00Z" }] })));
    expect(etapa(g, "fora_do_horario").medida).toEqual({ medido: true, valor: 0 });
  });

  it("grupo não é primeiro contato", () => {
    const f = funil(contatos(contato("2026-10-21T01:30:00Z", { conversa: { is_group: true } }), contato("2026-10-21T01:30:00Z")));
    expect(f.totalDePrimeirosContatos).toBe(1);
  });

  it("fala do escritório, reação e aviso de sistema não abrem primeiro contato", () => {
    const f = funil(
      contatos(
        contato("2026-10-21T01:30:00Z", { mensagens: [{ direction: "outbound" }] }),
        contato("2026-10-21T01:30:00Z", { mensagens: [{ type: "reaction" }] }),
        contato("2026-10-21T01:30:00Z", { mensagens: [{ type: "system" }] }),
      ),
    );
    expect(f.totalDePrimeirosContatos).toBe(0);
  });

  it("sem horário configurado: 'não medido' com o motivo — e o total de primeiros contatos continua contado", () => {
    const f = funil({
      ...contatos(contato("2026-10-21T01:30:00Z"), contato("2026-10-21T13:00:00Z")),
      horario: { ...HORARIO_OK, janela: null, agente: null },
    });
    expect(f.totalDePrimeirosContatos).toBe(2);
    expect(etapa(f, "fora_do_horario").medida).toEqual(NAO("sem_horario_configurado"));
  });

  it("horário que atravessa a meia-noite tem motivo próprio — não é 'sem horário'", () => {
    const horario = escolheHorario([
      { agente: "Noturno", criadoEm: "2026-01-01", trigger_config: { filters: { business_hours: { timezone: "America/Sao_Paulo", start: "22:00", end: "02:00", weekdays: [1, 2] } } } },
    ]);
    expect(horario).toMatchObject({ janela: null, atravessaMeiaNoite: "Noturno" });
    const f = funil({ ...contatos(contato("2026-10-21T01:30:00Z")), horario: { ...horario, estado: "ok" } });
    expect(etapa(f, "fora_do_horario").medida).toEqual(NAO("horario_atravessa_meia_noite"));
  });

  it("erro ao ler o horário do agente: não medido (e não 'sem horário')", () => {
    const f = funil({ ...contatos(contato("2026-10-21T01:30:00Z")), horario: { ...HORARIO_OK, janela: null, estado: "erro" } });
    expect(etapa(f, "fora_do_horario").medida).toEqual(NAO("erro_ao_ler"));
    expect(f.avisos).toContainEqual({ fonte: "horario", tipo: "erro" });
  });

  it("conversas ou mensagens com erro/parciais: não medido, e o total não é inventado", () => {
    const base = contatos(contato("2026-10-21T01:30:00Z"));
    const a = funil({ ...base, conversas: { linhas: [], estado: "erro" } });
    expect(etapa(a, "fora_do_horario").medida).toEqual(NAO("erro_ao_ler"));
    expect(a.totalDePrimeirosContatos).toBeNull();
    const b = funil({ ...base, mensagens: { linhas: base.mensagens.linhas, estado: "parcial" } });
    expect(etapa(b, "fora_do_horario").medida).toEqual(NAO("leitura_parcial"));
    expect(b.avisos).toContainEqual({ fonte: "mensagens", tipo: "parcial" });
  });

  it("avisa quando o fuso do escritório e o da janela do agente são diferentes", () => {
    expect(funil().fusosDiferem).toBe(false);
    const manaus = funil({ horario: { ...HORARIO_OK, janela: { ...JANELA, timezone: "America/Manaus" } } });
    expect(manaus.fusosDiferem).toBe(true);
    expect(funil({ horario: { ...HORARIO_OK, janela: null } }).fusosDiferem).toBe(false);
  });
});

describe("sem o fuso da organização, nada é medido", () => {
  it("as cinco etapas viram 'não medido — erro ao ler', com aviso", () => {
    const f = funil({ fusoLido: false, ...contatos(contato("2026-10-21T01:30:00Z")), casos: ok([caso("a")]) });
    for (const e of f.etapas) expect(e.medida, e.id).toEqual(NAO("erro_ao_ler"));
    expect(f.avisos).toContainEqual({ fonte: "fuso", tipo: "erro" });
  });
});

describe("etapa 2 — triados: casos que a triagem registrou NO período", () => {
  it("entra o caso com `triagem_em` no período e a área preenchida; o resto não", () => {
    const f = funil({
      casos: ok([
        caso("a"),
        caso("b", { triagem_em: "2026-08-01T15:00:00Z" }), // triado antes do período, ainda que o caso seja novo
        caso("c", { triagem_em: undefined }), // sem data da triagem
        caso("d", { area_do_direito: "   " }),
        caso("e", { area_do_direito: undefined }),
        caso("f", { area_do_direito: 7 }),
      ]),
    });
    expect(etapa(f, "triados").medida).toEqual({ medido: true, valor: 1 });
  });

  it("o caso é pela data da triagem, não pela de criação: caso antigo triado agora entra", () => {
    const f = funil({ casos: ok([caso("a", {}, { created_at: "2025-01-01T15:00:00Z" })]) });
    expect(etapa(f, "triados").medida).toEqual({ medido: true, valor: 1 });
  });

  it("o mesmo caso lido duas vezes conta uma", () => {
    expect(etapa(funil({ casos: ok([caso("a"), caso("a")]) }), "triados").medida).toEqual({ medido: true, valor: 1 });
  });

  it("desdobramento por decisão da triagem; recusados saem das etapas seguintes", () => {
    const f = funil({
      casos: ok([
        caso("s1"),
        caso("s2"),
        caso("r1", { triagem_decisao: "recusar" }),
        caso("p1", { triagem_decisao: "passar_ao_advogado" }),
        caso("x1", { triagem_decisao: undefined }),
      ]),
    });
    expect(etapa(f, "triados").medida).toEqual({ medido: true, valor: 5 });
    expect(f.desdobramento).toEqual({ seguiu: 2, recusou: 1, passouAoAdvogado: 1, semDecisao: 1 });
    expect(f.elegiveis).toBe(4);
    expect(etapa(f, "agendados").de).toBe(4);
  });

  it("ninguém triado: 0 medido, não 'não medido'", () => {
    expect(etapa(funil({ casos: ok([caso("a", { triagem_em: undefined })]) }), "triados").medida).toEqual({ medido: true, valor: 0 });
  });

  it("casos com erro ou parciais: triados e tudo o que depende deles viram 'não medido' — nunca zero", () => {
    for (const [estado, motivo] of [
      ["erro", "erro_ao_ler"],
      ["parcial", "leitura_parcial"],
    ] as const) {
      const f = funil({ casos: { linhas: [caso("a")], estado } });
      for (const id of ["triados", "agendados", "compareceram", "clientes"] as const) {
        expect(etapa(f, id).medida, `${estado} ${id}`).toEqual(NAO(motivo));
      }
      expect(f.desdobramento).toBeNull();
      expect(f.avisos).toContainEqual({ fonte: "casos", tipo: estado });
    }
  });
});

describe("etapa 3 — agendados: a consulta VINCULADA ao caso", () => {
  it("agendado = tem vínculo com consulta não cancelada; sem vínculo e cancelada não contam", () => {
    const f = funil({
      casos: ok([caso("a"), caso("b"), caso("c")]),
      vinculos: ok([vinculo("a", "q1"), vinculo("b", "q2")]),
      consultas: ok([consulta("q1", "confirmed", "2026-10-30T15:00:00Z"), consulta("q2", "cancelled")]),
    });
    expect(etapa(f, "agendados").medida).toEqual({ medido: true, valor: 1 });
  });

  it("um caso com várias consultas conta uma vez", () => {
    const f = funil({
      casos: ok([caso("a")]),
      vinculos: ok([vinculo("a", "q1"), vinculo("a", "q2")]),
      consultas: ok([consulta("q1", "completed"), consulta("q2", "completed")]),
    });
    expect(etapa(f, "agendados").medida).toEqual({ medido: true, valor: 1 });
  });

  it("a consulta de OUTRO caso do mesmo contato não vale: só o vínculo conta", () => {
    const f = funil({
      casos: ok([caso("novo")]),
      vinculos: ok([vinculo("caso-antigo", "q1")]),
      consultas: ok([consulta("q1", "completed")]),
    });
    expect(etapa(f, "agendados").medida).toEqual({ medido: true, valor: 0 });
  });

  it("caso recusado com consulta não entra no funil", () => {
    const f = funil({
      casos: ok([caso("r", { triagem_decisao: "recusar" })]),
      vinculos: ok([vinculo("r", "q1")]),
      consultas: ok([consulta("q1", "completed")]),
    });
    expect(etapa(f, "agendados").medida).toEqual({ medido: true, valor: 0 });
  });

  it("vínculos ou consultas com erro/parciais: agendados e as seguintes viram 'não medido'; triados segue medido", () => {
    const base = { casos: ok([caso("a")]) };
    const a = funil({ ...base, vinculos: { linhas: [], estado: "erro" } });
    expect(etapa(a, "triados").medida).toEqual({ medido: true, valor: 1 });
    for (const id of ["agendados", "compareceram", "clientes"] as const) expect(etapa(a, id).medida, id).toEqual(NAO("erro_ao_ler"));
    const b = funil({ ...base, consultas: { linhas: [], estado: "parcial" } });
    for (const id of ["agendados", "compareceram", "clientes"] as const) expect(etapa(b, id).medida, id).toEqual(NAO("leitura_parcial"));
    expect(b.avisos).toContainEqual({ fonte: "consultas", tipo: "parcial" });
  });
});

describe("etapa 4 — compareceram: só com TODO desfecho das consultas passadas registrado", () => {
  const dois = (consultas: LinhaDeConsulta[]) =>
    funil({
      casos: ok([caso("a"), caso("b")]),
      vinculos: ok(consultas.map((q, i) => vinculo(i === 0 ? "a" : "b", q.id))),
      consultas: ok(consultas),
    });

  it("sem nenhum agendado: 0 medido", () => {
    expect(etapa(funil({ casos: ok([caso("a")]) }), "compareceram").medida).toEqual({ medido: true, valor: 0 });
  });

  it("consulta passada sem desfecho: NÃO medido, e diz quantas faltam", () => {
    const f = dois([consulta("q1", "confirmed"), consulta("q2", "pending")]);
    expect(etapa(f, "compareceram").medida).toEqual(NAO("sem_registro_de_comparecimento", { faltam: 2 }));
    expect(etapa(f, "clientes").medida).toEqual(NAO("etapa_anterior_nao_medida"));
  });

  it("uma passada com desfecho e outra passada SEM: não medido, falta 1", () => {
    const f = dois([consulta("q1", "completed"), consulta("q2", "confirmed")]);
    expect(etapa(f, "compareceram").medida).toEqual(NAO("sem_registro_de_comparecimento", { faltam: 1 }));
  });

  it("só consultas futuras: NÃO medido, com outro motivo", () => {
    const f = dois([consulta("q1", "confirmed", "2026-10-30T15:00:00Z")]);
    expect(etapa(f, "compareceram").medida).toEqual(NAO("consultas_ainda_no_futuro"));
  });

  it("os futuros saem do denominador e aparecem como 'ainda por acontecer'", () => {
    const f = dois([consulta("q1", "completed"), consulta("q2", "confirmed", "2026-10-30T15:00:00Z")]);
    expect(etapa(f, "agendados").medida).toEqual({ medido: true, valor: 2 });
    expect(etapa(f, "compareceram").medida).toEqual({ medido: true, valor: 1 });
    expect(etapa(f, "compareceram").de).toBe(1);
    expect(etapa(f, "compareceram").passagem).toEqual({ tipo: "taxa", percentual: 100 });
    expect(f.aindaPorAcontecer).toBe(1);
  });

  it("só 'no_show' registrado: medido, e deu zero compareceram", () => {
    const f = dois([consulta("q1", "no_show")]);
    expect(etapa(f, "compareceram").medida).toEqual({ medido: true, valor: 0 });
  });
});

describe("etapa 5 — viraram cliente: ganhos ENTRE os que compareceram", () => {
  const cenario = () =>
    funil({
      casos: ok([caso("g1", {}, { status: "won" }), caso("g2", {}, { status: "won" }), caso("p", {}, { status: "lost" }), caso("o")]),
      vinculos: ok([vinculo("g1", "q1"), vinculo("p", "q2")]),
      consultas: ok([consulta("q1", "completed"), consulta("q2", "completed")]),
    });

  it("conta o ganho que compareceu; o ganho sem consulta fica à parte, em linha própria", () => {
    const f = cenario();
    expect(etapa(f, "compareceram").medida).toEqual({ medido: true, valor: 2 });
    expect(etapa(f, "clientes").medida).toEqual({ medido: true, valor: 1 });
    expect(etapa(f, "clientes").de).toBe(2);
    expect(f.ganhos).toEqual({ total: 2, semConsultaRealizada: 1 });
  });

  it("compareceram não medido: clientes não é medido, e os ganhos não separam quem teve consulta", () => {
    const f = funil({
      casos: ok([caso("g1", {}, { status: "won" })]),
      vinculos: ok([vinculo("g1", "q1")]),
      consultas: ok([consulta("q1", "confirmed")]),
    });
    expect(etapa(f, "clientes").medida).toEqual(NAO("etapa_anterior_nao_medida"));
    expect(f.ganhos).toEqual({ total: 1, semConsultaRealizada: null });
  });
});

describe("a taxa de passagem", () => {
  it("é a razão para a etapa anterior, com uma casa decimal; a etapa 1 não tem taxa para a 2 (conversas × casos)", () => {
    const f = funil({
      casos: ok([caso("t1"), caso("t2"), caso("t3")]),
      vinculos: ok([vinculo("t1", "q1"), vinculo("t2", "q2")]),
      consultas: ok([consulta("q1", "completed"), consulta("q2", "no_show")]),
    });
    expect(etapa(f, "fora_do_horario").passagem).toEqual({ tipo: "primeira" });
    expect(etapa(f, "triados").passagem).toEqual({ tipo: "outra_unidade" });
    expect(etapa(f, "agendados").passagem).toEqual({ tipo: "taxa", percentual: 66.7 });
    expect(etapa(f, "compareceram").passagem).toEqual({ tipo: "taxa", percentual: 50 });
  });

  it("base zero ou etapa anterior não medida: sem taxa (não divide por zero)", () => {
    const f = funil({ casos: ok([]) });
    expect(etapa(f, "agendados").passagem).toEqual({ tipo: "sem_base" });
    const g = funil({ casos: ok([caso("a")]), vinculos: ok([vinculo("a", "q1")]), consultas: ok([consulta("q1", "confirmed")]) });
    expect(etapa(g, "clientes").passagem).toEqual({ tipo: "sem_base" });
  });
});

describe("o horário", () => {
  const cfg = (inicio: string) => ({ filters: { business_hours: { timezone: "America/Sao_Paulo", start: inicio, end: "18:00", weekdays: [1, 2, 3] } } });

  it("escolhe o horário do agente mais antigo e avisa se há outro diferente", () => {
    const h = escolheHorario([
      { agente: "Novo", criadoEm: "2026-09-01", trigger_config: cfg("09:00") },
      { agente: "Antigo", criadoEm: "2026-01-01", trigger_config: cfg("08:00") },
    ]);
    expect(h.agente).toBe("Antigo");
    expect(h.janela?.start).toBe("08:00");
    expect(h.divergentes).toBe(true);
  });

  it("horários iguais não divergem; config torta ou ausente é ignorada; nenhum agente = sem horário", () => {
    const igual = escolheHorario([
      { agente: "A", criadoEm: "2026-01-01", trigger_config: cfg("08:00") },
      { agente: "B", criadoEm: "2026-02-01", trigger_config: cfg("08:00") },
    ]);
    expect(igual.divergentes).toBe(false);
    const torta = escolheHorario([
      { agente: "A", criadoEm: "2026-01-01", trigger_config: { filters: { business_hours: { start: "8h" } } } },
      { agente: "B", criadoEm: "2026-02-01", trigger_config: undefined },
    ]);
    expect(torta).toEqual({ janela: null, agente: null, divergentes: false, atravessaMeiaNoite: null });
    expect(escolheHorario([]).janela).toBeNull();
  });
});
