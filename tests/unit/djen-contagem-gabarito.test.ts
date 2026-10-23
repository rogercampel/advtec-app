import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { julga, type Julgamento } from "@/lib/djen/conferencia";
import { contaPrazo } from "@/lib/djen/contagem";
import type { Contagem } from "@/lib/djen/ler";

/**
 * 0006.E4 / 0009.E4 (#66) — a contagem sugerida contra o GABARITO do advogado do
 * piloto: publicações reais com o prazo contado à mão. Regra da decisão
 * (`docs/advtec/decisao-contagem-de-prazo.md`, §5.1): passa se acertar todas, ou
 * se o erro for "incerto — confira" (a sugestão avisava); nunca uma data errada
 * com cara de certa.
 *
 * Enquanto o gabarito está vazio, o teste de baixo prova que o juiz reprova o
 * que deve — e o de cima não tem o que conferir. Quando a tabela chegar, ela
 * entra em `tests/fixtures/gabarito-contagem.json` e este arquivo não muda.
 */

type Linha = {
  processo: string;
  disponibilizada: string;
  dias: number | null;
  contagem: Contagem;
  vencimento: string;
  observacao?: string;
};
const gabarito = JSON.parse(readFileSync("tests/fixtures/gabarito-contagem.json", "utf8")) as { publicacoes: Linha[] };

/** O que a contagem diz de cada linha. Prazo sem número vira "incerta": o sistema não deu data. */
function confere(linhas: Linha[]): Array<{ processo: string; julgamento: Julgamento; sugerida: string | null; correta: string }> {
  return linhas.map((l) => {
    const s = contaPrazo(l.disponibilizada, { dias: l.dias, contagem: l.contagem, trecho: "" });
    if (s.situacao === "sem_data") return { processo: l.processo, julgamento: "incerta" as const, sugerida: null, correta: l.vencimento };
    return { processo: l.processo, julgamento: julga(s, l.vencimento), sugerida: s.vence, correta: l.vencimento };
  });
}

describe("contagem sugerida × gabarito do advogado", () => {
  it("nenhuma data errada com cara de certa", () => {
    const erradas = confere(gabarito.publicacoes).filter((r) => r.julgamento === "errou");
    expect(erradas).toEqual([]);
  });

  it("o juiz reprova data errada sem aviso, e aceita a divergência avisada (controle, linhas sintéticas)", () => {
    // Contadas à mão: disp. qui 22/10/2026, 5 dias úteis → vence sex 30/10 (nenhum aviso);
    // disp. ter 20/10/2026, 15 dias úteis → vence qua 11/11 (Finados, 02/11, no caminho).
    const r = confere([
      { processo: "certa", disponibilizada: "2026-10-22", dias: 5, contagem: "util", vencimento: "2026-10-30" },
      { processo: "errada", disponibilizada: "2026-10-22", dias: 5, contagem: "util", vencimento: "2026-11-03" },
      { processo: "avisada", disponibilizada: "2026-10-20", dias: 15, contagem: "util", vencimento: "2026-11-12" },
      { processo: "sem número", disponibilizada: "2026-10-20", dias: null, contagem: "nao_declarada", vencimento: "2026-11-12" },
    ]);
    expect(r.map((x) => [x.processo, x.julgamento])).toEqual([
      ["certa", "acertou"],
      ["errada", "errou"],
      ["avisada", "incerta"],
      ["sem número", "incerta"],
    ]);
  });
});
