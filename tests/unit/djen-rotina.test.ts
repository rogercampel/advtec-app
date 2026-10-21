import { describe, expect, it } from "vitest";

import type { ComunicacaoBruta } from "@/lib/djen/comunica";
import type { LinhaPublicacao, ResultadoColeta } from "@/lib/djen/coletar";
import { rodaRotina, type ClienteDaRotina } from "@/lib/djen/rotina";
import { clienteDaRotina, limitesDoDia } from "@/lib/djen/rotina-banco";

/**
 * Ticket 0009.E1 — a rotina diária liga o motor da 0006 a um relógio.
 *
 * Critérios da spec 0009 que este arquivo cobre:
 *  1. a rotina roda sem ninguém abrir o sistema, e reexecutar no mesmo dia não
 *     duplica publicação (nem coleta de novo);
 *  2. dia sem coleta bem-sucedida gera aviso; silêncio nunca aparece como "em dia".
 *
 * O banco é um dublê em memória que calcula o estado do alarme do MESMO jeito
 * que a consulta real: a partir das rodadas registradas, não de um campo pronto.
 *
 * MUTAÇÕES (17/10/2026), uma por vez, restauradas e conferidas — 8 de 8 acusadas:
 *  coleta toda hora · rodada sempre ok · aviso que não se fecha · erro inesperado
 *  que derruba a rodada · dia em UTC · escritório parado entra · alarme que nunca
 *  avisa · limite do dia em UTC.
 */

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";

const ITEM: ComunicacaoBruta = {
  id: 700000001,
  data_disponibilizacao: "2026-10-16",
  siglaTribunal: "TJSP",
  tipoComunicacao: "Intimação",
  nomeOrgao: "3ª Vara Cível",
  numero_processo: "0001234-56.2026.8.26.0100",
  texto: "Intime-se para contestar no prazo de 15 dias úteis.",
  link: "https://comunica.pje.jus.br/700000001",
};

const fonteOk = (itens: ComunicacaoBruta[] = [ITEM]) => async () =>
  ({ ok: true, status: 200, json: async () => ({ status: "success", count: itens.length, items: itens }) }) as unknown as Response;

const fonteFora = async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response;

type Rodada = { id: string; org: string; inicio: Date; ok: boolean; fechada: boolean };

function bancoEmMemoria(escritorios: Array<{ org: string; oabs: number }>) {
  const publicacoes = new Map<string, LinhaPublicacao>();
  const rodadas: Rodada[] = [];
  const alarme = new Map<string, Date>();
  const avisosAbertos = new Map<string, string>();
  const avisosEnviados: Array<{ org: string; texto: string }> = [];
  let seq = 0;

  const cliente: ClienteDaRotina = {
    async escritoriosMonitorados() {
      return escritorios
        .filter((e) => e.oabs > 0)
        .map((e) => ({
          organizationId: e.org,
          oabs: Array.from({ length: e.oabs }, (_, i) => ({ numero: `10000${i}`, uf: "SP" })),
        }));
    },
    async coletouBemNoDia(org, dia) {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      return rodadas.some((r) => r.org === org && r.ok && fmt.format(r.inicio) === dia);
    },
    async abreRodada(org, inicio) {
      const id = `r${++seq}`;
      rodadas.push({ id, org, inicio, ok: false, fechada: false });
      return id;
    },
    async fechaRodada(id, _r: ResultadoColeta, ok) {
      const r = rodadas.find((x) => x.id === id)!;
      r.ok = ok;
      r.fechada = true;
    },
    async estadoDoAlarme(org) {
      const minhas = rodadas.filter((r) => r.org === org).sort((a, b) => +a.inicio - +b.inicio);
      const ultima = minhas.at(-1);
      const ultimaOk = minhas.filter((r) => r.ok).at(-1);
      return {
        ultimaTentativaEm: ultima?.inicio ?? null,
        ultimaFoiOk: ultima ? ultima.ok : null,
        ultimoSucessoEm: ultimaOk?.inicio ?? null,
        alarmeEnviadoEm: alarme.get(org) ?? null,
      };
    },
    async avisa(org, texto, quando) {
      avisosAbertos.set(org, texto);
      avisosEnviados.push({ org, texto });
      alarme.set(org, quando);
    },
    async resolveAviso(org) {
      avisosAbertos.delete(org);
    },
    async upsertPublicacoes(org, linhas) {
      let novas = 0;
      for (const l of linhas) {
        const k = `${org}:${l.djen_id}`;
        if (!publicacoes.has(k)) novas += 1;
        publicacoes.set(k, l);
      }
      return { gravadas: novas };
    },
  };
  return { cliente, publicacoes, rodadas, avisosAbertos, avisosEnviados };
}

const em = (iso: string) => new Date(iso);
// 09:00 em Brasília = 12:00Z
const HOJE_9H = em("2026-10-17T12:00:00Z");
const hora = (h: number) => new Date(HOJE_9H.getTime() + h * 3600_000);

describe("a coleta roda uma vez por dia, sem ninguém abrir o sistema", () => {
  it("primeira rodada do dia coleta, grava e registra a rodada como ok", async () => {
    const b = bancoEmMemoria([{ org: ORG_A, oabs: 1 }]);
    const [r] = await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: fonteOk() });

    expect(r).toMatchObject({ organizationId: ORG_A, coletou: true, ok: true, gravadas: 1 });
    expect(b.rodadas).toHaveLength(1);
    expect(b.rodadas[0]).toMatchObject({ ok: true, fechada: true });
  });

  it("as rodadas seguintes do mesmo dia não coletam de novo — e nada duplica", async () => {
    const b = bancoEmMemoria([{ org: ORG_A, oabs: 1 }]);
    await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: fonteOk() });
    const [r] = await rodaRotina(b.cliente, { agora: hora(1), fetchImpl: fonteOk() });

    expect(r!.coletou).toBe(false);
    expect(b.rodadas).toHaveLength(1);
    expect(b.publicacoes.size).toBe(1);
  });

  it("no dia seguinte (fuso do foro) coleta de novo, e a publicação repetida não duplica", async () => {
    const b = bancoEmMemoria([{ org: ORG_A, oabs: 1 }]);
    await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: fonteOk() });
    const [r] = await rodaRotina(b.cliente, { agora: hora(24), fetchImpl: fonteOk() });

    expect(r!.coletou).toBe(true);
    expect(b.rodadas).toHaveLength(2);
    expect(b.publicacoes.size).toBe(1);
  });

  it("às 22h de Brasília ainda é o mesmo dia do foro, mesmo já sendo amanhã em UTC", async () => {
    const b = bancoEmMemoria([{ org: ORG_A, oabs: 1 }]);
    await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: fonteOk() });
    // 22:00 em Brasília = 01:00Z do dia seguinte
    const [r] = await rodaRotina(b.cliente, { agora: em("2026-10-18T01:00:00Z"), fetchImpl: fonteOk() });
    expect(r!.coletou).toBe(false);
  });

  it("escritório sem OAB monitorada fica fora da rodada — sem coleta e sem alarme", async () => {
    const b = bancoEmMemoria([
      { org: ORG_A, oabs: 1 },
      { org: ORG_B, oabs: 0 },
    ]);
    const r = await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: fonteOk() });
    expect(r.map((x) => x.organizationId)).toEqual([ORG_A]);
    expect(b.avisosEnviados).toEqual([]);
  });
});

describe("silêncio nunca aparece como em dia", () => {
  it("coleta que falha vira rodada NÃO-ok, e a hora seguinte tenta de novo", async () => {
    const b = bancoEmMemoria([{ org: ORG_A, oabs: 1 }]);
    const [r1] = await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: fonteFora });
    expect(r1).toMatchObject({ coletou: true, ok: false });

    const [r2] = await rodaRotina(b.cliente, { agora: hora(1), fetchImpl: fonteOk() });
    expect(r2).toMatchObject({ coletou: true, ok: true });
  });

  it("a falha abre aviso na Central na mesma rodada, com o motivo", async () => {
    const b = bancoEmMemoria([{ org: ORG_A, oabs: 1 }]);
    await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: fonteFora });
    expect(b.avisosAbertos.get(ORG_A)).toMatch(/falhou/);
  });

  it("uma OAB que falha entre duas torna a rodada não-ok — buraco não passa por coleta boa", async () => {
    const b = bancoEmMemoria([{ org: ORG_A, oabs: 2 }]);
    let n = 0;
    const metade = async () => (++n === 1 ? fonteOk()() : fonteFora());
    const [r] = await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: metade as never });
    expect(r!.ok).toBe(false);
  });

  it("a coleta que PAROU de rodar alarma, mesmo sem nenhuma falha registrada", async () => {
    const b = bancoEmMemoria([{ org: ORG_A, oabs: 1 }]);
    await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: fonteOk() });
    // A rotina "morre" por dois dias: nenhuma rodada registrada. Na volta ela
    // coleta primeiro; com a fonte fora, o alarme diz há quanto tempo está sem.
    const [r] = await rodaRotina(b.cliente, { agora: hora(48), fetchImpl: fonteFora });
    expect(r!.decisao.alarmar).toBe(true);
    expect(b.avisosAbertos.get(ORG_A)).toMatch(/há 48 horas|há 2 dias/);
  });

  it("não repete o mesmo aviso dentro da carência de 12 horas", async () => {
    const b = bancoEmMemoria([{ org: ORG_A, oabs: 1 }]);
    await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: fonteFora });
    await rodaRotina(b.cliente, { agora: hora(1), fetchImpl: fonteFora });
    await rodaRotina(b.cliente, { agora: hora(2), fetchImpl: fonteFora });
    expect(b.avisosEnviados).toHaveLength(1);

    await rodaRotina(b.cliente, { agora: hora(13), fetchImpl: fonteFora });
    expect(b.avisosEnviados).toHaveLength(2);
  });

  it("quando a coleta volta, o aviso se fecha sozinho", async () => {
    const b = bancoEmMemoria([{ org: ORG_A, oabs: 1 }]);
    await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: fonteFora });
    expect(b.avisosAbertos.has(ORG_A)).toBe(true);

    await rodaRotina(b.cliente, { agora: hora(1), fetchImpl: fonteOk() });
    expect(b.avisosAbertos.has(ORG_A)).toBe(false);
  });

  it("um escritório com a fonte fora não impede a coleta do outro", async () => {
    const b = bancoEmMemoria([
      { org: ORG_A, oabs: 1 },
      { org: ORG_B, oabs: 1 },
    ]);
    let n = 0;
    const so1Falha = async () => (++n === 1 ? fonteFora() : fonteOk()());
    const r = await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: so1Falha as never });
    expect(r.map((x) => x.ok)).toEqual([false, true]);
  });

  it("erro inesperado na gravação vira rodada não-ok com motivo, e a rodada continua", async () => {
    const b = bancoEmMemoria([
      { org: ORG_A, oabs: 1 },
      { org: ORG_B, oabs: 1 },
    ]);
    const original = b.cliente.upsertPublicacoes;
    b.cliente.upsertPublicacoes = async (org, l) => {
      if (org === ORG_A) throw new Error("banco caiu");
      return original(org, l);
    };
    const r = await rodaRotina(b.cliente, { agora: HOJE_9H, fetchImpl: fonteOk() });
    expect(r.map((x) => x.ok)).toEqual([false, true]);
    expect(b.rodadas.find((x) => x.org === ORG_A)).toMatchObject({ ok: false, fechada: true });
  });
});

describe("o adaptador de banco", () => {
  function adminFalso(oabs: Array<Record<string, unknown>>, paradas: string[]) {
    return {
      from(tabela: string) {
        if (tabela === "organizations") {
          return { select: () => ({ neq: async () => ({ data: paradas.map((id) => ({ id })), error: null }) }) };
        }
        return { select: () => ({ eq: async () => ({ data: oabs, error: null }) }) };
      },
    } as never;
  }

  it("escritório parado (suspenso, arquivado) não entra na rodada", async () => {
    const c = clienteDaRotina(
      adminFalso(
        [
          { organization_id: ORG_A, numero: "1", uf: "SP" },
          { organization_id: ORG_A, numero: "2", uf: "RJ" },
          { organization_id: ORG_B, numero: "3", uf: "SP" },
        ],
        [ORG_B],
      ),
    );
    expect(await c.escritoriosMonitorados()).toEqual([
      { organizationId: ORG_A, oabs: [{ numero: "1", uf: "SP" }, { numero: "2", uf: "RJ" }] },
    ]);
  });

  it("o dia do foro vira o intervalo certo em instante absoluto (-03:00)", () => {
    expect(limitesDoDia("2026-10-17")).toEqual({
      de: "2026-10-17T00:00:00-03:00",
      ate: "2026-10-17T23:59:59.999-03:00",
    });
  });
});
