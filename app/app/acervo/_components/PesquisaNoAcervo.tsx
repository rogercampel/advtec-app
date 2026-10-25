"use client";

/*
 * THESIS: cada tese do escritório lida como uma página de peça — o trecho literal no
 * centro, as fontes na margem esquerda, o desfecho na direita. Recusa a lista de
 * resultados de busca, em que trecho, fonte e desfecho viram três cartões iguais.
 * OWN-WORLD: o mundo do app (creme #faf9f6, folha branca, fio #e7e3da, texto #1c1a16,
 * sálvia #506d48 só no que é ação ou procedência), Atkinson Hyperlegible, números tabulares.
 * STORY: o advogado descreve o problema, lê a tese como leria um parecer, confere de onde
 * veio cada trecho e quantos processos do escritório terminaram como — e decide sozinho.
 * FIRST VIEWPORT: pergunta numa linha só com "Pesquisar"; abaixo, cabeçalho corrido com a
 * pergunta e "Tese 1 de N"; a folha ocupa o centro em largura de leitura, notas numeradas à
 * esquerda, régua de desfecho com N e data à direita; abas das teses no pé da folha.
 * FORM: estrutura 6 da lista ordenada (folha com notas de margem), seed 496c27ef, code-led.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import type { DesfechoDaTese } from "@/lib/acervo/desfecho-das-pecas";
import type { ResultadoDaPesquisa, TeseNaTela } from "@/lib/acervo/pesquisa";
import { useT } from "@/hooks/i18n/useT";

type Estado =
  | { fase: "parado" }
  | { fase: "pesquisando"; problema: string }
  | { fase: "pronto"; problema: string; resultado: Exclude<ResultadoDaPesquisa, { situacao: "falha" }> }
  | { fase: "erro"; problema: string; mensagem: string };

export function PesquisaNoAcervo({ podePesquisar }: { podePesquisar: boolean }) {
  const t = useT();
  const [problema, setProblema] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "parado" });

  async function pesquisa(e: FormEvent) {
    e.preventDefault();
    const texto = problema.trim();
    if (texto.length < 3) return;
    setEstado({ fase: "pesquisando", problema: texto });
    try {
      const r = await apiClient.post<{ data: ResultadoDaPesquisa }>("/api/v1/acervo/pesquisa", { problema: texto });
      if (r.data.situacao === "falha") setEstado({ fase: "erro", problema: texto, mensagem: t("Não foi possível pesquisar agora. Tente de novo.") });
      else setEstado({ fase: "pronto", problema: texto, resultado: r.data });
    } catch (err) {
      setEstado({ fase: "erro", problema: texto, mensagem: err instanceof Error ? err.message : t("Não foi possível pesquisar agora. Tente de novo.") });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Pesquisa no acervo")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Descreva o problema do caso. Aparecem os argumentos que o escritório já usou, cada trecho com a peça e a página de onde saiu. É o histórico do escritório, não a posição de um tribunal.")}
        </p>
      </header>

      <form onSubmit={pesquisa} className="flex max-w-3xl flex-col gap-2 sm:flex-row" role="search">
        <label htmlFor="problema" className="sr-only">
          {t("Problema do caso")}
        </label>
        <input
          id="problema"
          value={problema}
          onChange={(e) => setProblema(e.target.value)}
          maxLength={1000}
          disabled={!podePesquisar}
          placeholder={t("Ex.: cliente cobrado depois de cancelar o plano")}
          className="h-11 w-full rounded-md border bg-card px-3 sm:flex-1 text-base outline-hidden transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <Button type="submit" className="h-11 px-5" disabled={!podePesquisar || problema.trim().length < 3 || estado.fase === "pesquisando"}>
          {estado.fase === "pesquisando" ? t("Pesquisando…") : t("Pesquisar")}
        </Button>
      </form>
      {!podePesquisar && (
        <p className="text-sm text-muted-foreground">{t("Seu papel nesta organização pode ver, mas não pesquisar o acervo.")}</p>
      )}

      {estado.fase === "pesquisando" && <FolhaCarregando />}
      {estado.fase === "erro" && (
        <p role="alert" className="max-w-3xl rounded-md border border-destructive/40 bg-card p-4 text-sm text-destructive">
          {estado.mensagem}
        </p>
      )}
      {estado.fase === "pronto" &&
        (estado.resultado.situacao === "nada_no_acervo" ? (
          <Folha cabeca={estado.problema}>
            <p className="text-lg leading-relaxed" data-testid="nada-no-acervo">
              {t("Não há nada no acervo do escritório sobre isso.")}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("Nenhuma peça enviada trata deste problema. A pesquisa não inventa argumento para preencher o vazio.")}
            </p>
          </Folha>
        ) : (
          <Teses problema={estado.problema} teses={estado.resultado.teses} />
        ))}
    </div>
  );
}

function Teses({ problema, teses }: { problema: string; teses: TeseNaTela[] }) {
  const t = useT();
  // Sem reset por efeito: pesquisa nova passa por "pesquisando", que desmonta isto, e volta na tese 1.
  // O antigo useEffect(() => setAtual(0), [teses]) chegava depois do clique na CI lenta e o desfazia.
  const [atual, setAtual] = useState(0);
  const folha = useRef<HTMLDivElement>(null);
  const tese = teses[atual]!;

  // O único movimento da tela: a folha troca de tese deslizando 4px, a partir de um estado já legível.
  useEffect(() => {
    const el = folha.current;
    if (!el || typeof el.animate !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [{ opacity: 0.55, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
      { duration: 220, easing: "cubic-bezier(.16,1,.3,1)" },
    );
  }, [atual]);

  function teclado(e: KeyboardEvent) {
    if (e.key === "ArrowRight" && atual < teses.length - 1) setAtual(atual + 1);
    if (e.key === "ArrowLeft" && atual > 0) setAtual(atual - 1);
  }

  return (
    <section aria-label={t("Teses encontradas")} onKeyDown={teclado} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 text-sm text-muted-foreground">
        <span className="max-w-full truncate">
          {t("Sobre:")} <span className="text-foreground">“{problema}”</span>
        </span>
        <span className="tabular-nums" aria-live="polite">
          {t("Tese {i} de {n}").replace("{i}", String(atual + 1)).replace("{n}", String(teses.length))}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)_14rem] lg:gap-8">
        {/* A folha vem primeiro no DOM: no celular ela lidera, e as margens descem. */}
        <div ref={folha} className="order-1 lg:order-2">
          <article className="rounded-xl border bg-card px-6 py-8 sm:px-10 sm:py-10" data-testid="folha-da-tese">
            <blockquote className="max-w-[68ch] text-lg leading-relaxed sm:text-xl">
              <span aria-hidden className="-ml-[0.45em] text-muted-foreground">“</span>
              {tese.trecho}
              <span aria-hidden className="text-muted-foreground">”</span>
              <sup className="ml-1 align-super text-xs text-muted-foreground">
                {tese.fontes.map((_, i) => i + 1).join(",")}
              </sup>
            </blockquote>
          </article>
          {teses.length > 1 && (
            <nav aria-label={t("Outras teses")} className="mt-3 flex flex-wrap gap-1">
              {teses.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setAtual(i)}
                  aria-current={i === atual ? "page" : undefined}
                  className="h-9 min-w-9 rounded-md border px-3 text-sm tabular-nums transition-colors outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40 aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
                >
                  {i + 1}
                </button>
              ))}
            </nav>
          )}
        </div>

        <aside aria-label={t("Fontes do trecho")} className="order-2 lg:order-1">
          <h2 className="mb-2 text-sm font-medium">{t("Fontes")}</h2>
          <ol className="space-y-3 text-sm">
            {tese.fontes.map((f, i) => (
              <li key={i} className="grid grid-cols-[1.25rem_1fr] gap-x-1" data-testid="nota-de-margem">
                <span className="tabular-nums text-muted-foreground">{i + 1}</span>
                <span>
                  <span className="block break-words">{f.citacao}</span>
                  {f.processo && <span className="block whitespace-nowrap text-xs tabular-nums text-muted-foreground">{f.processo}</span>}
                </span>
              </li>
            ))}
          </ol>
        </aside>

        <aside aria-label={t("Desfecho")} className="order-3">
          <Desfecho d={tese.desfecho} />
        </aside>
      </div>
    </section>
  );
}

const fmtData = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

function Desfecho({ d }: { d: DesfechoDaTese }) {
  const t = useT();
  if (d.n === 0) {
    return (
      <div className="space-y-2 text-sm" data-testid="desfecho">
        <h2 className="font-medium">{t("Desfecho")}</h2>
        <p className="text-muted-foreground">{t("Nenhum processo destas peças com desfecho no espelho do DataJud.")}</p>
        <div className="text-xs text-muted-foreground"><ForaDaConta d={d} /></div>
      </div>
    );
  }
  const partes = [
    { chave: "procedencia", rotulo: t("procedência"), c: d.procedencia, cor: "bg-primary" },
    { chave: "parcial", rotulo: t("em parte"), c: d.procedencia_parcial, cor: "bg-[var(--color-warning)]" },
    { chave: "improcedencia", rotulo: t("improcedência"), c: d.improcedencia, cor: "bg-muted-foreground/40" },
  ];
  return (
    <div className="space-y-3 text-sm" data-testid="desfecho">
      <h2 className="font-medium">{t("Desfecho dos processos destas peças")}</h2>
      <p className="text-base tabular-nums">
        {t("{p} de {n} terminaram em procedência.").replace("{p}", String(d.procedencia.n)).replace("{n}", String(d.n))}
      </p>
      {/* A barra é proporção desenhada: só aparece quando a amostra sustenta percentual. */}
      {!d.casosInsuficientes && (
        <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={partes.map((p) => `${p.rotulo}: ${p.c.n} de ${d.n}`).join("; ")}>
          {partes.map((p) => (p.c.n ? <span key={p.chave} className={p.cor} style={{ width: `${(p.c.n / d.n) * 100}%` }} /> : null))}
        </div>
      )}
      <ul className="space-y-1 tabular-nums text-muted-foreground">
        {partes.map((p) => (
          <li key={p.chave}>
            {p.rotulo}: {p.c.n} {t("de")} {d.n}
            {p.c.percentual !== null ? ` · ${p.c.percentual}%` : ""}
          </li>
        ))}
      </ul>
      {d.casosInsuficientes && <p className="text-muted-foreground">{t("Casos insuficientes para percentual: só a contagem.")}</p>}
      <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
        {d.consultadoEm && <p>{t("Consulta ao DataJud de {data}.").replace("{data}", fmtData(d.consultadoEm.ate))}</p>}
        <ForaDaConta d={d} />
        <p>{t("Descreve processos já encerrados; não diz nada sobre um caso novo.")}</p>
      </div>
    </div>
  );
}

/** O que ficou de fora da contagem, motivo por motivo — nunca um número sem nome. */
function ForaDaConta({ d }: { d: DesfechoDaTese }) {
  const t = useT();
  const um = (n: number, s: string, p: string) => (n === 1 ? s : p);
  const itens = [
    [d.fora.pecasSemProcesso, um(d.fora.pecasSemProcesso, t("{n} peça sem número de processo"), t("{n} peças sem número de processo"))],
    [d.fora.semEspelho, um(d.fora.semEspelho, t("{n} processo ainda fora do espelho do DataJud"), t("{n} processos ainda fora do espelho do DataJud"))],
    [d.fora.descartados, um(d.fora.descartados, t("{n} processo em sigilo ou com data inválida"), t("{n} processos em sigilo ou com data inválida"))],
    [d.fora.semDesfecho, um(d.fora.semDesfecho, t("{n} processo sem sentença no espelho"), t("{n} processos sem sentença no espelho"))],
  ] as const;
  const presentes = itens.filter(([n]) => n > 0);
  if (presentes.length === 0) return null;
  return (
    <ul>
      {presentes.map(([n, rotulo]) => (
        <li key={rotulo}>{rotulo.replace("{n}", String(n))}</li>
      ))}
    </ul>
  );
}

function Folha({ cabeca, children }: { cabeca: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <section className="space-y-3">
      <div className="border-b pb-2 text-sm text-muted-foreground">
        {t("Sobre:")} <span className="text-foreground">“{cabeca}”</span>
      </div>
      <article className="mx-auto max-w-3xl rounded-xl border bg-card px-6 py-8 sm:px-10">{children}</article>
    </section>
  );
}

function FolhaCarregando() {
  const t = useT();
  return (
    <div className="mx-auto max-w-3xl space-y-3 rounded-xl border bg-card px-10 py-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("Pesquisando no acervo…")}</span>
      {[92, 100, 84, 60].map((w) => (
        <div key={w} className="h-4 animate-pulse rounded-sm bg-muted" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}
