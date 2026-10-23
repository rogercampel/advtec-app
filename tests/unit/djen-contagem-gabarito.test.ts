import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { julga, type Julgamento } from "@/lib/djen/conferencia";
import { contaPrazo } from "@/lib/djen/contagem";
import { lePrazos, type Contagem } from "@/lib/djen/ler";

/**
 * 0006.E4 / 0009.E4 (#66) — a contagem sugerida contra o GABARITO do advogado do
 * piloto: publicações reais com o prazo contado à mão. Regra da decisão
 * (`docs/advtec/decisao-contagem-de-prazo.md`, §5.1): passa se acertar todas, ou
 * se o erro for "incerto — confira" (a sugestão avisava, e o aviso EXPLICA a
 * diferença — ver `julga`); nunca uma data errada com cara de certa.
 *
 * ═══ O QUE ESTE GABARITO PROVA, E O QUE NÃO PROVA ═══
 *
 * SEM a coluna `texto`, o gabarito prova só a ARITMÉTICA: ele alimenta a contagem
 * com os `dias` e a `contagem` que o próprio advogado anotou. Nada diz que o
 * sistema LÊ o mesmo número e o mesmo tipo (útil/corrido) do texto da publicação —
 * e é na leitura do texto que a tela erra no mundo real. COM `texto` (o texto da
 * publicação, colado na linha), o teste "a leitura bate com o gabarito" confere que
 * `lePrazos(texto)` acha o mesmo `dias` e a mesma `contagem` que ele anotou. Linha
 * sem `texto` fica de fora desse teste e é contada à parte.
 *
 * Enquanto o gabarito está vazio, os testes de controle (linhas sintéticas) provam
 * que o juiz e a leitura reprovam o que devem. Quando a tabela chegar, ela entra em
 * `tests/fixtures/gabarito-contagem.json` e este arquivo não muda.
 */

type Linha = {
  processo: string;
  disponibilizada: string;
  dias: number | null;
  contagem: Contagem;
  vencimento: string;
  /** O texto da publicação. Opcional; com ele, a LEITURA do texto também é conferida. */
  texto?: string;
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

/** As linhas com `texto` cuja leitura NÃO acha o prazo que o advogado anotou (`dias` e `contagem`). */
function leiturasQueNaoBatem(linhas: Linha[]): string[] {
  return linhas
    .filter((l) => typeof l.texto === "string" && l.texto.trim() !== "")
    .filter((l) => !lePrazos(l.texto!).some((p) => p.dias === l.dias && p.contagem === l.contagem))
    .map((l) => l.processo);
}

describe("contagem sugerida × gabarito do advogado", () => {
  it("nenhuma data errada com cara de certa", () => {
    const erradas = confere(gabarito.publicacoes).filter((r) => r.julgamento === "errou");
    expect(erradas).toEqual([]);
  });

  it("a leitura bate com o gabarito: o texto da publicação dá o mesmo prazo que o advogado anotou", () => {
    expect(leiturasQueNaoBatem(gabarito.publicacoes)).toEqual([]);
  });

  it("o juiz reprova data errada sem aviso, e aceita a divergência que o aviso explica (controle, linhas sintéticas)", () => {
    // Contadas à mão: disp. qui 22/10/2026, 5 dias úteis → vence sex 30/10 (nenhum aviso);
    // disp. ter 20/10/2026, 15 dias úteis → vence qua 11/11 (Finados, 02/11, no caminho, não descontado).
    const r = confere([
      { processo: "certa", disponibilizada: "2026-10-22", dias: 5, contagem: "util", vencimento: "2026-10-30" },
      { processo: "errada", disponibilizada: "2026-10-22", dias: 5, contagem: "util", vencimento: "2026-11-03" },
      { processo: "avisada", disponibilizada: "2026-10-20", dias: 15, contagem: "util", vencimento: "2026-11-12" },
      { processo: "aviso que não explica", disponibilizada: "2026-10-20", dias: 15, contagem: "util", vencimento: "2026-11-25" },
      { processo: "sem número", disponibilizada: "2026-10-20", dias: null, contagem: "nao_declarada", vencimento: "2026-11-12" },
    ]);
    expect(r.map((x) => [x.processo, x.julgamento])).toEqual([
      ["certa", "acertou"],
      ["errada", "errou"],
      ["avisada", "incerta"],
      ["aviso que não explica", "errou"],
      ["sem número", "incerta"],
    ]);
  });

  it("a leitura do texto é conferida de verdade (controle, linhas sintéticas)", () => {
    const util: Linha = { processo: "ok-util", disponibilizada: "2026-10-22", dias: 5, contagem: "util", vencimento: "2026-10-30", texto: "Manifeste-se no prazo de 5 (cinco) dias úteis." };
    const corrido: Linha = { processo: "ok-corrido", disponibilizada: "2026-10-22", dias: 10, contagem: "corrido", vencimento: "2026-11-05", texto: "Cumpra-se no prazo de 10 (dez) dias corridos." };
    const semTexto: Linha = { processo: "sem-texto", disponibilizada: "2026-10-22", dias: 99, contagem: "util", vencimento: "2026-10-30" };
    expect(leiturasQueNaoBatem([util, corrido, semTexto])).toEqual([]);
    // O advogado anotou 15 dias úteis, mas o texto diz 5: a leitura NÃO bate.
    expect(leiturasQueNaoBatem([{ ...util, processo: "dias-trocados", dias: 15 }])).toEqual(["dias-trocados"]);
    // O advogado anotou "corrido", mas o texto diz úteis.
    expect(leiturasQueNaoBatem([{ ...util, processo: "tipo-trocado", contagem: "corrido" }])).toEqual(["tipo-trocado"]);
    // Texto sem prazo nenhum.
    expect(leiturasQueNaoBatem([{ ...util, processo: "sem-prazo", texto: "DESPACHO. Intime-se." }])).toEqual(["sem-prazo"]);
  });
});
