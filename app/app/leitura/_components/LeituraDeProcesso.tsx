"use client";

/*
 * THESIS: a leitura de um processo como um protocolo de entrega — o advogado
 * entrega o PDF, vê o que a leitura vai custar ANTES, confirma, e acompanha.
 * OWN-WORLD: o mundo do app (creme, folha branca, fio #e7e3da, texto #1c1a16,
 * sálvia #506d48 só no que é ação), números tabulares, como a pesquisa no acervo.
 * STORY: escolher o PDF → ver páginas, minutos e custo → "Ler o processo" → a
 * leitura aparece "lendo" na lista e vira "pronta" sozinha; falha diz o motivo.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

export type LeituraNaLista = {
  id: string;
  arquivo: string;
  paginas: number;
  estado: "lendo" | "pronta" | "falhou";
  motivo: string | null;
  criadaEm: string;
};

type Estimativa = { paginas: number; minutos: number; dolaresPelaChave: number | null; paginasSemTexto: number[] };
type Fase =
  | { fase: "parado" }
  | { fase: "estimando" }
  | { fase: "estimado"; estimativa: Estimativa }
  | { fase: "enviando"; estimativa: Estimativa }
  | { fase: "erro"; mensagem: string };

/** Enquanto houver leitura em andamento, a lista se atualiza sozinha. */
const ATUALIZA_A_CADA_MS = 10_000;

async function envia(arquivo: File, confirmar: boolean): Promise<{ ok: true; data: { estimativa: Estimativa; id?: string } } | { ok: false; mensagem: string }> {
  const form = new FormData();
  form.append("arquivo", arquivo);
  if (confirmar) form.append("confirmar", "1");
  const res = await fetch("/api/v1/acervo/leituras", { method: "POST", body: form });
  const json = (await res.json().catch(() => ({}))) as { data?: { estimativa: Estimativa; id?: string }; error?: { message?: string } };
  if (!res.ok || !json.data) return { ok: false, mensagem: json.error?.message ?? "" };
  return { ok: true, data: json.data };
}

export function LeituraDeProcesso({ podeLer, leituras }: { podeLer: boolean; leituras: LeituraNaLista[] }) {
  const t = useT();
  const router = useRouter();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [estado, setEstado] = useState<Fase>({ fase: "parado" });

  const lendo = leituras.some((l) => l.estado === "lendo");
  useEffect(() => {
    if (!lendo) return;
    const id = setInterval(() => router.refresh(), ATUALIZA_A_CADA_MS);
    return () => clearInterval(id);
  }, [lendo, router]);

  async function escolhe(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setArquivo(f);
    if (!f) return setEstado({ fase: "parado" });
    setEstado({ fase: "estimando" });
    const r = await envia(f, false);
    setEstado(r.ok ? { fase: "estimado", estimativa: r.data.estimativa } : { fase: "erro", mensagem: r.mensagem || t("Não foi possível ler este PDF.") });
  }

  async function confirma() {
    if (!arquivo || estado.fase !== "estimado") return;
    setEstado({ fase: "enviando", estimativa: estado.estimativa });
    const r = await envia(arquivo, true);
    if (!r.ok) return setEstado({ fase: "erro", mensagem: r.mensagem || t("Não foi possível começar a leitura.") });
    setArquivo(null);
    setEstado({ fase: "parado" });
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Leitura de processo")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Envie o PDF do processo. Sai um documento com quem é quem, a linha do tempo, o que cada lado alega, as contradições e as páginas que você precisa ler inteiras — toda afirmação com a página dos autos. Ele aponta onde ler; não substitui a leitura.")}
        </p>
      </header>

      <section aria-labelledby="t-novo" className="max-w-3xl space-y-3 rounded-md border bg-card p-4">
        <h2 id="t-novo" className="font-medium">
          {t("Novo processo")}
        </h2>
        <label className="block space-y-1 text-sm">
          <span className="block">{t("PDF do processo (até 40 MB)")}</span>
          <input
            type="file"
            accept="application/pdf"
            disabled={!podeLer || estado.fase === "estimando" || estado.fase === "enviando"}
            onChange={escolhe}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5"
          />
        </label>
        {!podeLer && <p className="text-sm text-muted-foreground">{t("Seu papel nesta organização pode ver as leituras, mas não ler processos novos.")}</p>}
        {estado.fase === "estimando" && <p className="text-sm text-muted-foreground">{t("Contando as páginas…")}</p>}
        {(estado.fase === "estimado" || estado.fase === "enviando") && (
          <div className="space-y-3" data-testid="estimativa">
            <p className="text-sm tabular-nums">
              {t("{p} páginas · cerca de {m} min").replace("{p}", String(estado.estimativa.paginas)).replace("{m}", String(estado.estimativa.minutos))}
              {estado.estimativa.dolaresPelaChave !== null &&
                ` · ${t("até US$ {d} pela chave de API (pela assinatura do ChatGPT, conta no limite de uso)").replace("{d}", estado.estimativa.dolaresPelaChave.toFixed(2))}`}
            </p>
            {estado.estimativa.paginasSemTexto.length > 0 && (
              <p className="text-sm text-amber-800">
                {t("Folhas digitalizadas sem texto não serão lidas: {l}.").replace("{l}", estado.estimativa.paginasSemTexto.join(", "))}
              </p>
            )}
            <Button onClick={confirma} disabled={estado.fase === "enviando"}>
              {estado.fase === "enviando" ? t("Começando…") : t("Ler o processo")}
            </Button>
          </div>
        )}
        {estado.fase === "erro" && (
          <p role="alert" className="text-sm text-destructive">
            {estado.mensagem}
          </p>
        )}
      </section>

      <section aria-labelledby="t-lista" className="space-y-2">
        <h2 id="t-lista" className="font-medium">
          {t("Leituras do escritório")}
        </h2>
        {leituras.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhum processo lido ainda.")}</p>
        ) : (
          <ul className="divide-y rounded-md border bg-card">
            {leituras.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm" data-testid="leitura-na-lista">
                <span className="font-medium">
                  {l.estado === "pronta" ? <Link className="underline-offset-2 hover:underline" href={`/app/leitura/${l.id}`}>{l.arquivo}</Link> : l.arquivo}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {t("{p} páginas").replace("{p}", String(l.paginas))} ·{" "}
                  {l.estado === "lendo"
                    ? t("lendo…")
                    : l.estado === "pronta"
                      ? t("pronta")
                      : `${t("falhou")}: ${l.motivo ?? ""}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
