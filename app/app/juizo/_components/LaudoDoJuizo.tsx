"use client";

/*
 * THESIS: o perfil do juízo é um laudo de uma página — as frases que a trava da jurimetria
 * já aprovou, com os números em destaque dentro delas e a fonte no rodapé. Recusa o painel de
 * métricas (número grande, rótulo pequeno), que lê estatística como placar.
 * OWN-WORLD: o mundo do app (creme #faf9f6, folha branca, fio #e7e3da, texto #1c1a16,
 * sálvia #506d48 só na ação), Atkinson Hyperlegible, números tabulares em peso maior.
 * STORY: o advogado escolhe o recorte, lê como aquele órgão vem decidindo e quanto demora,
 * ao lado dos demais do tribunal, com o N em cada número — e entende que é passado, não aposta.
 * FIRST VIEWPORT: seletor de recorte no topo da coluna; abaixo, a folha central com o título
 * do recorte e a data da coleta, o parágrafo do órgão, o dos demais e a linha final do que o
 * laudo não é. Nada fora da coluna de leitura.
 * FORM: estrutura 2 da lista ordenada (laudo em texto), seed 6c9a76b1, code-led.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */

import { usePathname, useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";

import { useT } from "@/hooks/i18n/useT";

export type RecorteNaTela = {
  id: string;
  rotulo: string;
  tribunal: string;
  classe_codigo: number | null;
  assunto_codigo: number | null;
  orgao_julgador_codigo: number | null;
  ultima_coleta_em: string | null;
};

type Props = {
  recortes: RecorteNaTela[];
  escolhido: string | null;
  /** O texto de `textoDoPerfil`, já conferido pela trava. `null` quando não há o que mostrar. */
  texto: string | null;
  aviso: "sem_orgao" | "sem_coleta" | null;
  erroDeLeitura: boolean;
};

/**
 * Destaca só as MEDIDAS (percentual e dias) dentro da frase, sem reescrevê-la: o
 * texto é o que a trava aprovou. N, zeros e denominadores ficam em peso normal,
 * para a folha ler como laudo e não como placar.
 */
function comNumeros(linha: string): ReactNode[] {
  return linha.split(/(\d[\d.,]*%|\d+(?= dias)|\d+(?= e \d+ dias))/).map((pedaco, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold tabular-nums text-foreground">
        {pedaco}
      </strong>
    ) : (
      pedaco
    ),
  );
}

/** Separa o laudo em cabeçalho, um bloco por lado e a ressalva final. */
function partes(texto: string) {
  const linhas = texto.split("\n");
  const cabecalho = linhas[0] ?? "";
  const ressalva = linhas[linhas.length - 1] ?? "";
  const blocos: string[][] = [];
  for (const l of linhas.slice(1, -1)) {
    if (/^(Órgão|Demais) /.test(l)) blocos.push([l]);
    else blocos[blocos.length - 1]?.push(l);
  }
  return { cabecalho, blocos, ressalva };
}

export function LaudoDoJuizo({ recortes, escolhido, texto, aviso, erroDeLeitura }: Props) {
  const t = useT();
  const router = useRouter();
  const caminho = usePathname();
  const [trocando, comecaTroca] = useTransition();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Perfil do juízo")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Como um órgão julgador vem decidindo e quanto demora, ao lado dos demais do mesmo tribunal e classe, a partir do espelho do DataJud. Descreve o passado; não prevê o resultado de nenhum caso.")}
        </p>
      </header>

      {erroDeLeitura && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-card p-3 text-sm text-destructive">
          {t("Não foi possível ler os recortes agora. Recarregue a página; se continuar, avise o administrador.")}
        </p>
      )}

      {recortes.length === 0 ? (
        <section className="rounded-xl border bg-card px-6 py-8 sm:px-10" data-testid="sem-recortes">
          <p className="text-lg leading-relaxed">{t("Nenhum recorte do DataJud foi coletado ainda.")}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Um recorte é a pergunta que o escritório faz ao DataJud: tribunal, classe e órgão julgador. Depois da primeira coleta, o laudo aparece aqui.")}
          </p>
        </section>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="recorte" className="text-sm font-medium">
              {t("Recorte")}
            </label>
            <select
              id="recorte"
              value={escolhido ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                comecaTroca(() => router.push(`${caminho}?recorte=${encodeURIComponent(id)}`));
              }}
              className="h-11 rounded-md border bg-card px-3 text-base outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {recortes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.rotulo}
                </option>
              ))}
            </select>
          </div>

          {aviso === "sem_orgao" && (
            <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
              {t("Este recorte não fixa um órgão julgador, então não há órgão para comparar com os demais. Escolha um recorte de órgão.")}
            </p>
          )}
          {aviso === "sem_coleta" && (
            <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
              {t("Este recorte ainda não foi coletado do DataJud. O laudo aparece depois da primeira coleta.")}
            </p>
          )}

          {texto && (
            <div aria-busy={trocando} className={trocando ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <Laudo texto={texto} recorte={recortes.find((r) => r.id === escolhido) ?? null} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** "Recorte “X”: tribunal TJSP, classe Y. Coleta de 19/10/2026." -> "Tribunal TJSP, classe Y." */
function semRotuloNemData(cabecalho: string): string {
  const meio = cabecalho.replace(/^Recorte “[^”]*”: /, "").replace(/ Coleta de [\d/]+\.$/, "");
  return meio.charAt(0).toUpperCase() + meio.slice(1);
}

const dataBr = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

function Laudo({ texto, recorte }: { texto: string; recorte: RecorteNaTela | null }) {
  const t = useT();
  const { cabecalho, blocos, ressalva } = partes(texto);
  return (
    <article className="rounded-xl border bg-card px-6 py-8 sm:px-10 sm:py-10" data-testid="laudo">
      {recorte && (
        <header className="mb-2 space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{recorte.rotulo}</h2>
          {recorte.ultima_coleta_em && (
            <p className="text-sm text-muted-foreground">
              {t("Coleta do DataJud de {data}").replace("{data}", dataBr(recorte.ultima_coleta_em))}
            </p>
          )}
        </header>
      )}
      <p className="text-sm text-muted-foreground">{recorte ? semRotuloNemData(cabecalho) : cabecalho}</p>
      <div className="mt-6 space-y-8">
        {blocos.map(([abertura, ...linhas], i) => {
          // "Órgão X: 48 processos no espelho; …" vira título "Órgão X" e a primeira linha de medida.
          const corte = (abertura ?? "").indexOf(": ");
          const titulo = corte > 0 ? abertura!.slice(0, corte) : (abertura ?? "");
          const volume = corte > 0 ? abertura!.slice(corte + 2) : null;
          return (
          <section key={i} className="space-y-2">
            <h3 className="text-lg font-semibold leading-snug">{titulo}</h3>
            <ul className="space-y-1.5 text-base leading-relaxed text-muted-foreground">
              {volume && <li>{comNumeros(volume.charAt(0).toUpperCase() + volume.slice(1))}</li>}
              {linhas.map((l, j) => (
                <li key={j}>{comNumeros(l)}</li>
              ))}
            </ul>
          </section>
          );
        })}
      </div>
      <p className="mt-8 border-t pt-4 text-sm text-muted-foreground">{ressalva}</p>
      <p className="sr-only">{t("Fim do laudo.")}</p>
    </article>
  );
}
