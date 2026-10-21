/**
 * O documento da leitura em HTML — ticket 0003.E6 (#41). "Uma página só,
 * legível, imprimível."
 *
 * Um renderizador só, para a tela e para a impressão: duas versões do mesmo
 * documento acabam dizendo coisas diferentes. Todo texto que vem do processo ou
 * do modelo passa por `escapa` — o documento é HTML montado no servidor, e trecho
 * de autos não pode virar marcação.
 *
 * O que o documento mostra de toda afirmação: a frase, "p. N" e o trecho
 * literal entre aspas. A frase é leitura do modelo; o trecho é dos autos; a
 * página é onde conferir.
 */
import type { Afirmacao, DocumentoDeLeitura } from "./documento-de-leitura";

type T = (s: string) => string;

export function escapa(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function afirmacao(a: Afirmacao, t: T, opcoes: { semTrecho?: boolean } = {}): string {
  const trecho = a.trecho && !opcoes.semTrecho && a.trecho !== a.texto ? `<q>${escapa(a.trecho)}</q>` : "";
  return `<span class="frase">${escapa(a.texto)}</span> <span class="pg">${escapa(t("p."))} ${a.pagina}</span>${trecho ? ` ${trecho}` : ""}`;
}

/** O conteúdo (sem `<html>`): a tela o põe dentro do app; a impressão, numa página própria. */
export function documentoEmHtml(d: DocumentoDeLeitura, t: T, titulo: string): string {
  const partes: string[] = [];
  partes.push(`<header><h1>${escapa(titulo)}</h1><p class="aviso">${escapa(t(d.aviso))}</p></header>`);

  if (d.naoLido.paginasSemTexto.length > 0 || d.naoLido.trechos.length > 0) {
    const itens = [
      ...(d.naoLido.paginasSemTexto.length > 0
        ? [`<li>${escapa(t("Folhas sem texto (digitalizadas), não lidas:"))} ${d.naoLido.paginasSemTexto.join(", ")}</li>`]
        : []),
      ...d.naoLido.trechos.map(
        (b) => `<li>${escapa(t("Páginas {a} a {b} não lidas:").replace("{a}", String(b.primeira)).replace("{b}", String(b.ultima)))} ${escapa(b.motivo)}</li>`,
      ),
    ];
    partes.push(`<section class="nao-lido"><h2>${escapa(t("O que NÃO foi lido"))}</h2><ul>${itens.join("")}</ul></section>`);
  }

  const quem = d.quemEQuem
    .map((c) => `<dt>${escapa(t(c.rotulo))}</dt><dd>${c.afirmacao ? afirmacao(c.afirmacao, t, { semTrecho: true }) : `<span class="vazio">${escapa(t("não identificado nos autos"))}</span>`}</dd>`)
    .join("");
  const advogados = d.advogados.length > 0 ? `<dt>${escapa(t("Advogados"))}</dt><dd>${d.advogados.map((a) => afirmacao(a, t, { semTrecho: true })).join("<br>")}</dd>` : "";
  partes.push(`<section><h2>${escapa(t("Quem é quem"))}</h2><dl>${quem}${advogados}</dl></section>`);

  partes.push(
    `<section><h2>${escapa(t("Linha do tempo"))}</h2>${
      d.linhaDoTempo.length === 0
        ? `<p class="vazio">${escapa(t("Nenhum fato datado nos autos lidos."))}</p>`
        : `<ol class="tempo">${d.linhaDoTempo.map((e) => `<li><time>${dataBr(e.data)}</time> ${afirmacao(e, t)}</li>`).join("")}</ol>`
    }</section>`,
  );

  const secoes = d.alegacoes
    .map((s) => {
      const corpo =
        s.estado === "itens"
          ? `<ul>${s.itens.map((i) => `<li>${afirmacao(i, t)}</li>`).join("")}</ul>`
          : s.estado === "descartado"
            ? `<p class="vazio">${escapa(t("O modelo indicou itens, mas nenhum com trecho que prove — confira nos autos."))}</p>`
            : `<p class="vazio">${escapa(t("Não consta nos autos lidos."))}</p>`;
      return `<h3>${escapa(t(s.rotulo))}</h3>${corpo}`;
    })
    .join("");
  partes.push(`<section><h2>${escapa(t("O que cada lado alega"))}</h2>${secoes}</section>`);

  const c = d.contradicoes;
  const estado =
    c.estado === "nao_procurado"
      ? `<p class="alerta">${escapa(t("Contradições e lacunas não foram procuradas:"))} ${escapa(c.motivo ?? "")}</p>`
      : c.estado === "parcial"
        ? `<p class="alerta">${escapa(t("Contradições e lacunas procuradas só nas páginas que foram lidas."))}</p>`
        : "";
  const contradicoes =
    c.estado === "nao_procurado"
      ? ""
      : c.itens.length === 0
        ? `<p class="vazio">${escapa(t("Nenhuma contradição entre os trechos lidos."))}</p>`
        : `<ul>${c.itens.map((x) => `<li><span class="frase">${escapa(x.explicacao)}</span><ul><li>${afirmacao(x.lados[0], t)}</li><li>${afirmacao(x.lados[1], t)}</li></ul></li>`).join("")}</ul>`;
  const lacunas =
    c.lacunas.length === 0
      ? ""
      : `<h3>${escapa(t("Alegado, sem prova nos trechos lidos — confira"))}</h3><ul>${c.lacunas.map((l) => `<li>${escapa(l.falta)}<br>${afirmacao(l.afirmacao, t)}</li>`).join("")}</ul>`;
  partes.push(`<section><h2>${escapa(t("Contradições e lacunas"))}</h2><p class="nota">${escapa(t("Leitura do modelo sobre os trechos acima: confira nas duas páginas antes de usar."))}</p>${estado}${contradicoes}${lacunas}</section>`);

  partes.push(
    `<section><h2>${escapa(t("Páginas para ler inteiras"))}</h2>${
      d.paginasQueImportam.length === 0
        ? `<p class="vazio">${escapa(t("Nenhuma página apontada."))}</p>`
        : `<ul>${d.paginasQueImportam.map((p) => `<li><span class="pg">${escapa(t("p."))} ${p.pagina}</span> — ${p.motivos.map((m) => escapa(m)).join("; ")}</li>`).join("")}</ul>`
    }</section>`,
  );

  return `<article class="documento-de-leitura">${partes.join("")}</article>`;
}

/** O estilo do documento, escopado: serve dentro do app e na página de impressão. */
export const CSS_DO_DOCUMENTO = `
.documento-de-leitura{max-width:46rem;margin:0 auto;color:#1c1a16;font:15px/1.55 "Atkinson Hyperlegible",system-ui,sans-serif;font-variant-numeric:tabular-nums}
.documento-de-leitura h1{font-size:1.4rem;margin:0 0 .5rem}
.documento-de-leitura h2{font-size:1.05rem;margin:1.6rem 0 .5rem;padding-bottom:.25rem;border-bottom:1px solid #e7e3da}
.documento-de-leitura h3{font-size:.95rem;margin:1rem 0 .3rem}
.documento-de-leitura .aviso{margin:0;padding:.6rem .8rem;border-left:3px solid #506d48;background:#f3f1ec}
.documento-de-leitura .nao-lido{margin-top:1rem;padding:.6rem .8rem;border:1px solid #c9a227;background:#fbf6e6}
.documento-de-leitura .nao-lido h2{margin-top:0;border:0}
.documento-de-leitura .alerta{color:#7a5a00}
.documento-de-leitura .nota,.documento-de-leitura .vazio{color:#6b665c;font-size:.9rem}
.documento-de-leitura dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;margin:0}
.documento-de-leitura dt{font-weight:600}
.documento-de-leitura dd{margin:0}
.documento-de-leitura ul,.documento-de-leitura ol{margin:.3rem 0;padding-left:1.2rem}
.documento-de-leitura li{margin:.35rem 0}
.documento-de-leitura .tempo{list-style:none;padding-left:0}
.documento-de-leitura time{display:inline-block;min-width:6.2rem;font-weight:600}
.documento-de-leitura .pg{white-space:nowrap;font-weight:600;color:#506d48}
.documento-de-leitura q{display:block;margin:.15rem 0 0;color:#4a463e;font-style:italic;quotes:"“" "”"}
@media print{.documento-de-leitura{max-width:none;font-size:11pt}.documento-de-leitura h2{break-after:avoid}.documento-de-leitura li{break-inside:avoid}}
`;
