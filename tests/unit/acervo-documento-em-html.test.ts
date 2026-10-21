import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { afirmacoesDo, montaDocumento } from "@/lib/acervo/documento-de-leitura";
import { documentoEmHtml, escapa } from "@/lib/acervo/documento-em-html";
import type { Pagina } from "@/lib/acervo/fatiar";
import { executaLeitura } from "@/lib/acervo/leitura-de-processo";

/**
 * Ticket 0003.E6 (#41) — o documento em HTML, o mesmo na tela e na impressão.
 *
 * O que não pode acontecer:
 *   - afirmação sem a página à vista (critério 2, agora no que o advogado VÊ);
 *   - trecho dos autos virando marcação (`<script>` num PDF);
 *   - o aviso e o "não lido" sumindo do topo.
 */

type Gravada = { paginas: Pagina[]; alegacoes: string[]; contradicoes: string };
const { pecas } = JSON.parse(readFileSync("tests/fixtures/leitura-luna-gravada.json", "utf8")) as {
  pecas: Record<"tjmg" | "mprj", Gravada>;
};
const t = (s: string) => s;

async function doc(qual: "tjmg" | "mprj") {
  const p = pecas[qual];
  const respostas = [...p.alegacoes, p.contradicoes];
  return executaLeitura(p.paginas, async () => ({ texto: respostas.shift()! }));
}

describe.each(["tjmg", "mprj"] as const)("%s — o que o advogado vê", (qual) => {
  it("toda afirmação do documento aparece com 'p. N' ao lado", async () => {
    const d = await doc(qual);
    const html = documentoEmHtml(d, t, "Leitura");
    for (const a of afirmacoesDo(d)) {
      expect(html, `${a.texto} (p. ${a.pagina})`).toContain(`<span class="pg">p. ${a.pagina}</span>`);
      expect(html).toContain(escapa(a.texto.split("; ")[0]!));
    }
  });

  it("o aviso vem antes de qualquer conteúdo", async () => {
    const html = documentoEmHtml(await doc(qual), t, "Leitura");
    expect(html.indexOf('class="aviso"')).toBeLessThan(html.indexOf("Quem é quem"));
  });
});

describe("conteúdo dos autos nunca vira marcação", () => {
  it("trecho com <script> sai escapado", () => {
    const d = montaDocumento({
      quemEQuem: { juizo: null, autor: { valor: "<script>alert(1)</script>", pagina: 1, trecho: "x" }, classe: null, reu: null, valor_da_causa: null, advogados: [] },
      linhaDoTempo: { eventos: [{ data: "2024-01-02", pagina: 2, trecho: 'Em 02/01/2024 "<img src=x onerror=alert(1)>"' }], carimbos: 0, citacoes: 0 },
      alegacoes: {
        alegacoes: [],
        naoConsta: ["pedido", "causa_de_pedir", "defesa", "decisao"],
        descartados: [],
        removidas: { sem_pagina: 0, trecho_nao_literal: 0, tamanho_do_trecho: 0, numero_sem_apoio: 0, formato: 0, repetido: 0, decisao_sem_verbo: 0 },
        blocosNaoLidos: [{ primeira: 3, ultima: 9, motivo: "<b>429</b>" }],
        paginasSemTexto: [],
      },
      contradicoes: { contradicoes: [], lacunas: [], paginasQueImportam: [], removidas: { numero_inexistente: 0, mesmo_item: 0, numero_sem_apoio: 0, acima_do_teto: 0, repetido: 0 }, naoLido: null },
    });
    const html = documentoEmHtml(d, t, "Processo <x>");
    expect(html).not.toMatch(/<script|<img|<b>/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Processo &lt;x&gt;");
  });

  it("o que não foi lido aparece no topo, com a faixa e o motivo", () => {
    const d = montaDocumento({
      quemEQuem: { juizo: null, autor: null, classe: null, reu: null, valor_da_causa: null, advogados: [] },
      linhaDoTempo: { eventos: [], carimbos: 0, citacoes: 0 },
      alegacoes: {
        alegacoes: [],
        naoConsta: ["pedido", "causa_de_pedir", "defesa", "decisao"],
        descartados: [],
        removidas: { sem_pagina: 0, trecho_nao_literal: 0, tamanho_do_trecho: 0, numero_sem_apoio: 0, formato: 0, repetido: 0, decisao_sem_verbo: 0 },
        blocosNaoLidos: [{ primeira: 40, ultima: 90, motivo: "Error: 429" }],
        paginasSemTexto: [7],
      },
      contradicoes: { contradicoes: [], lacunas: [], paginasQueImportam: [], removidas: { numero_inexistente: 0, mesmo_item: 0, numero_sem_apoio: 0, acima_do_teto: 0, repetido: 0 }, naoLido: null },
    });
    const html = documentoEmHtml(d, t, "x");
    expect(html.indexOf("O que NÃO foi lido")).toBeLessThan(html.indexOf("Quem é quem"));
    expect(html).toContain("Páginas 40 a 90 não lidas: Error: 429");
    expect(html).toContain("não lidas: 7");
    expect(html).toContain("procuradas só nas páginas que foram lidas");
  });
});
