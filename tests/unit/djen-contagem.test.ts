import { describe, expect, it } from "vitest";

import { contaPrazo, type ContagemSugerida } from "@/lib/djen/contagem";
import type { PrazoLido } from "@/lib/djen/ler";

/**
 * 0006.E4 (#21) — contagem SUGERIDA. As datas esperadas foram contadas à mão num
 * calendário impresso (só os dias da semana), não recalculadas com a regra:
 *
 *   out/2026: 22 qui · 23 sex · 24 sáb · 25 dom · 26 seg … 30 sex · 31 sáb
 *   nov/2026: 02 seg (Finados) … 06 sex · 09 seg … 13 sex
 *   dez/2026: 16 qua · 17 qui · 18 sex · 21 seg … 25 sex (Natal) · 28 seg … 31 qui
 *   jan/2027: 01 sex · 04 seg … 07 qui
 *
 * A regra é PROPOSTA, não decisão: o advogado do piloto responde
 * `docs/advtec/decisao-contagem-de-prazo.md` e o teste muda junto.
 */

const prazo = (dias: number | null, contagem: PrazoLido["contagem"] = "util"): PrazoLido => ({ dias, contagem, trecho: "x" });
const sugerida = (c: ContagemSugerida) => {
  if (c.situacao !== "sugerida") throw new Error(c.situacao);
  return c;
};

describe("contagem sugerida (0006.E4)", () => {
  it("15 dias úteis: publicada no dia útil seguinte, começa no dia útil depois, conta o dia do início", () => {
    const c = sugerida(contaPrazo("2026-10-22", prazo(15)));
    expect({ publicada: c.publicada, inicio: c.inicio, vence: c.vence }).toEqual({
      publicada: "2026-10-23",
      inicio: "2026-10-26",
      vence: "2026-11-13",
    });
  });

  it("disponibilizada na sexta: o fim de semana não conta", () => {
    const c = sugerida(contaPrazo("2026-10-23", prazo(5)));
    expect({ publicada: c.publicada, inicio: c.inicio, vence: c.vence }).toEqual({
      publicada: "2026-10-26",
      inicio: "2026-10-27",
      vence: "2026-11-02",
    });
  });

  it("feriado nacional fixo no caminho NÃO entra na conta: vira aviso com o nome", () => {
    const c = sugerida(contaPrazo("2026-10-23", prazo(5)));
    expect(c.vence).toBe("2026-11-02"); // é Finados: o aviso é o que diz para conferir
    expect(c.feriados).toEqual([{ data: "2026-11-02", nome: "Finados" }]);
  });

  it("dias corridos: conta todo dia a partir do início", () => {
    const c = sugerida(contaPrazo("2026-10-22", prazo(10, "corrido")));
    expect({ inicio: c.inicio, ultimoDia: c.ultimoDia, vence: c.vence }).toEqual({ inicio: "2026-10-26", ultimoDia: "2026-11-04", vence: "2026-11-04" });
  });

  it("dias corridos terminando no sábado: passa para o próximo dia útil", () => {
    const c = sugerida(contaPrazo("2026-10-22", prazo(6, "corrido")));
    expect({ ultimoDia: c.ultimoDia, vence: c.vence }).toEqual({ ultimoDia: "2026-10-31", vence: "2026-11-02" });
  });

  it("texto que não declara útil nem corrido: conta em dias úteis e diz que não foi declarado", () => {
    const c = sugerida(contaPrazo("2026-10-22", prazo(15, "nao_declarada")));
    expect({ contagem: c.contagem, declarada: c.declarada, vence: c.vence }).toEqual({ contagem: "util", declarada: false, vence: "2026-11-13" });
    expect(sugerida(contaPrazo("2026-10-22", prazo(15))).declarada).toBe(true);
  });

  it("prazo sem número no texto: nenhuma data, nunca um chute", () => {
    expect(contaPrazo("2026-10-22", prazo(null))).toEqual({ situacao: "sem_data" });
    expect(contaPrazo("2026-10-22", prazo(0))).toEqual({ situacao: "sem_data" });
  });

  it("recesso de fim de ano no caminho vira aviso, e os feriados dele aparecem", () => {
    const c = sugerida(contaPrazo("2026-12-16", prazo(15)));
    expect({ inicio: c.inicio, vence: c.vence, recesso: c.recesso }).toEqual({ inicio: "2026-12-18", vence: "2027-01-07", recesso: true });
    expect(c.feriados.map((f) => f.data)).toEqual(["2026-12-25", "2027-01-01"]);
    expect(sugerida(contaPrazo("2026-10-22", prazo(15))).recesso).toBe(false);
  });

  it("disponibilização com hora: vale o dia", () => {
    expect(sugerida(contaPrazo("2026-10-22T03:00:00", prazo(15))).vence).toBe("2026-11-13");
  });

  it("data de disponibilização ilegível: nenhuma data", () => {
    expect(contaPrazo("22/10/2026", prazo(15))).toEqual({ situacao: "sem_data" });
  });
});
