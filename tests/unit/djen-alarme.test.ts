import { describe, expect, it } from "vitest";

import {
  avaliaColeta,
  mensagem,
  HORAS_DE_CARENCIA,
  HORAS_DE_SILENCIO_ATE_ALARMAR,
  type EstadoDaColeta,
} from "@/lib/djen/alarme";

/**
 * Ticket 0006.E6 — alarme de falha de coleta. Critério 7 da spec 0006.
 *
 * A spec chama esta etapa de BLOQUEANTE: "coleta sem alarme de falha é pior que
 * não ter coleta, porque cria confiança sem lastro". Nada da 0006 chega a
 * advogado real antes daqui.
 *
 * O caso que domina este arquivo é o SILÊNCIO — a coleta que parou de rodar.
 * Falha aparece; silêncio parece calmaria, e é o que faz o escritório olhar uma
 * tela vazia e concluir que não houve publicação.
 *
 * MUTAÇÕES (19/08/2026), feitas e conferidas:
 *
 *  - o ramo `coleta_parou` removido → vermelho em "a coleta que PAROU dispara
 *    alarme". É a mutação que importa: sem ele o módulo só avisa quando roda e
 *    falha, e nunca avisa depois que para.
 *  - a carência ignorada → vermelho em "não repete o mesmo alarme".
 *  - `temOabMonitorada` ignorado → vermelho em "escritório sem OAB não alarma".
 */

const AGORA = new Date("2026-08-19T12:00:00.000Z");
const hAtras = (h: number) => new Date(AGORA.getTime() - h * 60 * 60 * 1000);

function estado(over: Partial<EstadoDaColeta> = {}): EstadoDaColeta {
  return {
    ultimaTentativaEm: hAtras(2),
    ultimaFoiOk: true,
    ultimoSucessoEm: hAtras(2),
    alarmeEnviadoEm: null,
    temOabMonitorada: true,
    ...over,
  };
}

describe("o silêncio é o defeito perigoso", () => {
  it("a coleta que PAROU dispara alarme, mesmo sem nenhuma falha registrada", () => {
    // O agendador morreu: nada falhou, nada aconteceu, e a tela do escritório
    // mostra a lista de ontem como se fosse a de hoje.
    const d = avaliaColeta(
      estado({ ultimaTentativaEm: hAtras(40), ultimaFoiOk: true, ultimoSucessoEm: hAtras(40) }),
      { agora: AGORA },
    );
    expect(d.alarmar).toBe(true);
    expect(d.motivo).toBe("coleta_parou");
  });

  it("nunca ter coletado também é alarme — e não 'em dia por omissão'", () => {
    const d = avaliaColeta(
      estado({ ultimaTentativaEm: null, ultimaFoiOk: null, ultimoSucessoEm: null }),
      { agora: AGORA },
    );
    expect(d.alarmar).toBe(true);
    expect(d.motivo).toBe("nunca_coletou");
  });

  it("atraso de rotina NÃO é alarme — senão o alarme vira ruído", () => {
    const d = avaliaColeta(estado({ ultimoSucessoEm: hAtras(25), ultimaTentativaEm: hAtras(25) }), {
      agora: AGORA,
    });
    expect(d.alarmar).toBe(false);
    expect(d.motivo).toBe("em_dia");
  });

  it("a fronteira é a declarada, e não um número solto no código", () => {
    const antes = avaliaColeta(
      estado({ ultimoSucessoEm: hAtras(HORAS_DE_SILENCIO_ATE_ALARMAR - 1) }),
      { agora: AGORA },
    );
    const depois = avaliaColeta(
      estado({ ultimoSucessoEm: hAtras(HORAS_DE_SILENCIO_ATE_ALARMAR) }),
      { agora: AGORA },
    );
    expect(antes.alarmar).toBe(false);
    expect(depois.alarmar).toBe(true);
  });
});

describe("a falha visível também alarma", () => {
  it("última coleta com erro dispara na primeira verificação", () => {
    const d = avaliaColeta(estado({ ultimaFoiOk: false, ultimaTentativaEm: hAtras(1) }), {
      agora: AGORA,
    });
    expect(d.alarmar).toBe(true);
    expect(d.motivo).toBe("ultima_coleta_falhou");
  });

  it("o critério 7 pede 1 hora: falha de 30 minutos atrás já alarma", () => {
    const d = avaliaColeta(estado({ ultimaFoiOk: false, ultimaTentativaEm: hAtras(0.5) }), {
      agora: AGORA,
    });
    expect(d.alarmar).toBe(true);
  });
});

describe("o alarme não vira ruído", () => {
  it("não repete o mesmo alarme dentro da carência", () => {
    const d = avaliaColeta(
      estado({ ultimaFoiOk: false, alarmeEnviadoEm: hAtras(HORAS_DE_CARENCIA - 1) }),
      { agora: AGORA },
    );
    expect(d.alarmar).toBe(false);
    // O motivo continua sendo a falha: a situação não melhorou, só já foi avisada.
    expect(d.motivo).toBe("ultima_coleta_falhou");
  });

  it("passada a carência, avisa de novo — a falha continua de pé", () => {
    const d = avaliaColeta(
      estado({ ultimaFoiOk: false, alarmeEnviadoEm: hAtras(HORAS_DE_CARENCIA + 1) }),
      { agora: AGORA },
    );
    expect(d.alarmar).toBe(true);
  });

  it("escritório sem OAB cadastrada não alarma", () => {
    // Ruído aqui ensina a ignorar o alarme de quem TEM OAB monitorada.
    const d = avaliaColeta(
      estado({ temOabMonitorada: false, ultimaTentativaEm: null, ultimoSucessoEm: null }),
      { agora: AGORA },
    );
    expect(d.alarmar).toBe(false);
    expect(d.motivo).toBe("nao_monitorado");
  });
});

describe("a mensagem diz há quanto tempo, não só que falhou", () => {
  it("'falha na coleta' sem tempo não é acionável", () => {
    const d = avaliaColeta(estado({ ultimaFoiOk: false, ultimoSucessoEm: hAtras(30) }), {
      agora: AGORA,
    });
    expect(mensagem(d)).toMatch(/30 horas/);
  });

  it("acima de dois dias, fala em dias — 72 horas ninguém converte de cabeça", () => {
    const d = avaliaColeta(estado({ ultimaFoiOk: false, ultimoSucessoEm: hAtras(72) }), {
      agora: AGORA,
    });
    expect(mensagem(d)).toMatch(/3 dias/);
  });

  it("nunca coletou não inventa tempo", () => {
    const d = avaliaColeta(
      estado({ ultimaTentativaEm: null, ultimaFoiOk: null, ultimoSucessoEm: null }),
      { agora: AGORA },
    );
    expect(d.horasSemSucesso).toBeNull();
    expect(mensagem(d)).toMatch(/ainda não rodou/);
  });
});
