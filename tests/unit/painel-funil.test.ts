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
  type LinhaDeMensagem,
} from "@/lib/painel/funil";

/**
 * 0001.E5 — a conta do painel de medição (`lib/painel/funil.ts`).
 *
 * MUTAÇÕES (provadas em 23/10/2026, cada uma desfeita depois de ver o teste acusar):
 *   1. `diaNoFuso(agora, "UTC")` no lugar do fuso da organização em `periodoDoFunil` → reprovou "22h30 em
 *      Brasília é o dia 20 e não o 21" e "a meia-noite do foro".
 *   2. `msAteAJanelaAbrir(...) !== null` trocado por `=== null` (conta o DENTRO como fora) → reprovou
 *      "fora do horário: noite, fim de semana, antes da abertura e no minuto do fechamento".
 *   3. tirar o `if (c.status === "cancelled") continue` → reprovou "consulta cancelada não é agendamento".
 *   4. `medidaComparecimento` sempre `medido(compareceram.length)` → reprovou os dois "não medido" do comparecimento.
 *   5. tirar o `dentro(c.created_at)` da coorte de casos → reprovou "só entram casos abertos no período".
 */

// Quarta-feira 21/10/2026, 12:00 em Brasília (UTC-3).
const AGORA = new Date("2026-10-21T15:00:00Z");
const JANELA: JanelaDeAtendimento = { timezone: "America/Sao_Paulo", start: "08:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] };

const msg = (conversa: string, iso: string, extra: Partial<LinhaDeMensagem> = {}): LinhaDeMensagem => ({
  conversation_id: conversa,
  created_at: iso,
  direction: "inbound",
  type: "text",
  ...extra,
});
const caso = (id: string, extra: Partial<LinhaDeCaso> = {}): LinhaDeCaso => ({
  id,
  status: "open",
  custom_fields: {},
  contact_id: `p-${id}`,
  created_at: "2026-10-15T15:00:00Z",
  ...extra,
});
const consulta = (contato: string | null, status: string, starts = "2026-10-10T15:00:00Z"): LinhaDeConsulta => ({
  contact_id: contato,
  status,
  starts_at: starts,
});

function funil(parcial: Partial<EntradaDoFunil> = {}, dias = 30) {
  return calculaFunil({
    periodo: periodoDoFunil(dias, AGORA, "America/Sao_Paulo"),
    janela: JANELA,
    mensagens: [],
    casos: [],
    consultas: [],
    agora: AGORA,
    ...parcial,
  });
}
const etapa = (f: ReturnType<typeof funil>, id: EtapaId) => f.etapas.find((e) => e.id === id)!;

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

  it("uma mensagem 1 minuto antes da meia-noite do foro fica fora do período; a da própria meia-noite entra", () => {
    const periodo = periodoDoFunil(1, new Date("2026-10-21T01:30:00Z"), "America/Sao_Paulo");
    const f = funil({ periodo, mensagens: [msg("c1", "2026-10-20T02:59:00Z"), msg("c2", "2026-10-20T03:00:00Z")] });
    expect(f.totalDeAtendimentos).toBe(1);
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

describe("etapa 1 — atendimentos fora do horário", () => {
  it("fora do horário: noite, fim de semana, antes da abertura e no minuto do fechamento; dentro: da abertura até o fechamento", () => {
    const f = funil({
      mensagens: [
        msg("noite", "2026-10-21T01:30:00Z"), // ter 20/10 22:30 BRT → fora
        msg("sabado", "2026-10-17T14:00:00Z"), // sáb 17/10 11:00 BRT → fora
        msg("antes", "2026-10-21T10:59:00Z"), // qua 21/10 07:59 BRT → fora
        msg("fecha", "2026-10-20T21:00:00Z"), // ter 20/10 18:00 BRT → fora (o fim é exclusivo)
        msg("abre", "2026-10-21T11:00:00Z"), // qua 21/10 08:00 BRT → dentro
        msg("tarde", "2026-10-20T20:59:00Z"), // ter 20/10 17:59 BRT → dentro
      ],
    });
    expect(f.totalDeAtendimentos).toBe(6);
    expect(etapa(f, "fora_do_horario").medida).toEqual({ medido: true, valor: 4 });
  });

  it("vale a PRIMEIRA fala do cliente no período, não a última", () => {
    const f = funil({ mensagens: [msg("c1", "2026-10-21T01:30:00Z"), msg("c1", "2026-10-21T13:00:00Z")] });
    expect(f.totalDeAtendimentos).toBe(1);
    expect(etapa(f, "fora_do_horario").medida).toEqual({ medido: true, valor: 1 });
    // ao contrário: primeira dentro, depois fora → dentro.
    const g = funil({ mensagens: [msg("c1", "2026-10-21T13:00:00Z"), msg("c1", "2026-10-21T23:30:00Z")] });
    expect(etapa(g, "fora_do_horario").medida).toEqual({ medido: true, valor: 0 });
  });

  it("fala do escritório, reação e aviso de sistema não abrem atendimento", () => {
    const f = funil({
      mensagens: [
        msg("c1", "2026-10-21T01:30:00Z", { direction: "outbound" }),
        msg("c2", "2026-10-21T01:30:00Z", { type: "reaction" }),
        msg("c3", "2026-10-21T01:30:00Z", { type: "system" }),
      ],
    });
    expect(f.totalDeAtendimentos).toBe(0);
  });

  it("sem horário configurado: 'não medido' com o motivo — e o total de atendimentos continua contado", () => {
    const f = funil({ janela: null, mensagens: [msg("c1", "2026-10-21T01:30:00Z"), msg("c2", "2026-10-21T13:00:00Z")] });
    expect(f.totalDeAtendimentos).toBe(2);
    expect(etapa(f, "fora_do_horario").medida).toEqual({ medido: false, motivo: "sem_horario_configurado" });
  });

  it("mensagem anterior ao período não conta", () => {
    const f = funil({ mensagens: [msg("velha", "2026-08-01T01:30:00Z")] });
    expect(f.totalDeAtendimentos).toBe(0);
  });
});

describe("etapas 2 a 5 — a coorte de casos abertos no período", () => {
  it("só entram casos abertos no período", () => {
    const f = funil({ casos: [caso("a"), caso("velho", { created_at: "2026-08-01T15:00:00Z" })] });
    expect(f.casosAbertos).toBe(1);
  });

  it("triado = área do direito preenchida (texto em branco e campo ausente não valem)", () => {
    const f = funil({
      casos: [
        caso("a", { custom_fields: { area_do_direito: "Trabalhista" } }),
        caso("b", { custom_fields: { area_do_direito: "   " } }),
        caso("c", { custom_fields: {} }),
        caso("d", { custom_fields: null }),
        caso("e", { custom_fields: { area_do_direito: 7 } }),
      ],
    });
    expect(etapa(f, "triados").medida).toEqual({ medido: true, valor: 1 });
    expect(f.casosAbertos).toBe(5);
  });

  it("ninguém grava a área ainda: triados é 0 medido, não 'não medido'", () => {
    const f = funil({ casos: [caso("a"), caso("b")] });
    expect(etapa(f, "triados").medida).toEqual({ medido: true, valor: 0 });
  });

  it("agendado = contato com consulta; consulta cancelada não é agendamento", () => {
    const f = funil({
      casos: [caso("a"), caso("b"), caso("c"), caso("sem-contato", { contact_id: null })],
      consultas: [consulta("p-a", "confirmed", "2026-10-30T15:00:00Z"), consulta("p-b", "cancelled"), consulta(null, "confirmed")],
    });
    expect(etapa(f, "agendados").medida).toEqual({ medido: true, valor: 1 });
  });

  it("clientes = status 'won' (e 'lost'/'open' não)", () => {
    const f = funil({ casos: [caso("a", { status: "won" }), caso("b", { status: "lost" }), caso("c"), caso("d", { status: "won" })] });
    expect(etapa(f, "clientes").medida).toEqual({ medido: true, valor: 2 });
  });
});

describe("compareceram — só é medido quando alguém registra o desfecho", () => {
  const comAgendados = (consultas: LinhaDeConsulta[]) => funil({ casos: [caso("a"), caso("b")], consultas });

  it("sem nenhum agendado: 0 medido", () => {
    expect(etapa(funil({ casos: [caso("a")] }), "compareceram").medida).toEqual({ medido: true, valor: 0 });
  });

  it("consulta que já passou e segue 'confirmed': NÃO medido, e diz por quê", () => {
    const f = comAgendados([consulta("p-a", "confirmed"), consulta("p-b", "confirmed")]);
    expect(etapa(f, "compareceram").medida).toEqual({ medido: false, motivo: "sem_registro_de_comparecimento" });
    expect(f.agendadosSemDesfecho).toBe(2);
  });

  it("consulta ainda no futuro: NÃO medido, com outro motivo", () => {
    const f = comAgendados([consulta("p-a", "confirmed", "2026-10-30T15:00:00Z")]);
    expect(etapa(f, "compareceram").medida).toEqual({ medido: false, motivo: "consultas_ainda_no_futuro" });
  });

  it("com desfecho registrado: conta os 'completed' e informa as que passaram sem registro", () => {
    const f = comAgendados([consulta("p-a", "completed"), consulta("p-b", "confirmed")]);
    expect(etapa(f, "compareceram").medida).toEqual({ medido: true, valor: 1 });
    expect(f.agendadosSemDesfecho).toBe(1);
  });

  it("só 'no_show' registrado: medido, e deu zero compareceram", () => {
    const f = comAgendados([consulta("p-a", "no_show")]);
    expect(etapa(f, "compareceram").medida).toEqual({ medido: true, valor: 0 });
  });

  it("se compareceram não foi medido, a taxa para 'clientes' não é inventada", () => {
    const f = funil({ casos: [caso("a", { status: "won" })], consultas: [consulta("p-a", "confirmed")] });
    expect(etapa(f, "clientes").passagem).toEqual({ tipo: "sem_base" });
  });
});

describe("a taxa de passagem", () => {
  it("é a razão para a etapa anterior, com uma casa decimal; a etapa 1 não tem taxa para a 2 (conversas × casos)", () => {
    const f = funil({
      casos: [1, 2, 3].map((n) => caso(`t${n}`, { custom_fields: { area_do_direito: "Família" } })),
      consultas: [consulta("p-t1", "completed"), consulta("p-t2", "confirmed", "2026-10-30T15:00:00Z")],
    });
    expect(etapa(f, "fora_do_horario").passagem).toEqual({ tipo: "primeira" });
    expect(etapa(f, "triados").passagem).toEqual({ tipo: "outra_unidade" });
    expect(etapa(f, "agendados").passagem).toEqual({ tipo: "taxa", percentual: 66.7, acimaDaAnterior: false });
    expect(etapa(f, "compareceram").passagem).toEqual({ tipo: "taxa", percentual: 50, acimaDaAnterior: false });
  });

  it("etapa maior que a anterior aparece como é, marcada 'acima' — o funil não é forçado", () => {
    // 1 triado, 2 agendados: agendado sem triagem existe.
    const f = funil({
      casos: [caso("a", { custom_fields: { area_do_direito: "Cível" } }), caso("b")],
      consultas: [consulta("p-a", "confirmed", "2026-10-30T15:00:00Z"), consulta("p-b", "confirmed", "2026-10-30T15:00:00Z")],
    });
    expect(etapa(f, "agendados").passagem).toEqual({ tipo: "taxa", percentual: 200, acimaDaAnterior: true });
  });

  it("anterior zero: sem taxa (não divide por zero)", () => {
    const f = funil({ casos: [caso("a")], consultas: [consulta("p-a", "confirmed", "2026-10-30T15:00:00Z")] });
    expect(etapa(f, "agendados").passagem).toEqual({ tipo: "sem_base" });
  });
});

describe("leitura parcial e horário", () => {
  it("avisa quando a leitura bateu no teto", () => {
    expect(funil({ truncado: { mensagens: true, casos: true, consultas: true } }).avisos).toEqual([
      "leitura_parcial_mensagens",
      "leitura_parcial_casos",
      "leitura_parcial_consultas",
    ]);
    expect(funil().avisos).toEqual([]);
  });

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
    const torta = escolheHorario([{ agente: "A", criadoEm: "2026-01-01", trigger_config: { filters: { business_hours: { start: "8h" } } } }, { agente: "B", criadoEm: "2026-02-01", trigger_config: undefined }]);
    expect(torta).toEqual({ janela: null, agente: null, divergentes: false });
    expect(escolheHorario([]).janela).toBeNull();
  });
});
