"use client";

import { DIAS_EM_PARALELO, type Conferencia } from "@/lib/djen/conferencia";
import { useT } from "@/hooks/i18n/useT";

/** `YYYY-MM-DD` → `dd/mm/aaaa`, sem passar por fuso. */
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Conferência da contagem — 0006.E5 (#27) e 0009.E4 (#66). Cada data que o
 * escritório confirmou, contada no controle dele, contra a contagem sugerida.
 * É a medição dos 30 dias em paralelo: a tela mostra o número, nunca declara a
 * contagem confiável por conta própria.
 */
export function ConferenciaDaContagem({ conferencia: c }: { conferencia: Conferencia }) {
  const t = useT();
  const erros = c.divergencias.filter((d) => d.julgamento === "errou").length;
  const avisadas = c.divergencias.length - erros;
  return (
    <section aria-labelledby="t-conferencia" className="space-y-2" data-testid="conferencia-da-contagem">
      <h2 id="t-conferencia" className="text-lg font-medium">
        {t("Conferência da contagem")}
      </h2>
      {c.confirmadas === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("Nenhum prazo confirmado ainda. A conferência começa na primeira confirmação: cada data confirmada é comparada com a contagem sugerida.")}
        </p>
      ) : (
        <>
          <p className="text-sm">
            {t("{n} de {total} dias em paralelo ao controle do escritório, desde {data}.")
              .replace("{n}", String(Math.min(c.diasEmParalelo, DIAS_EM_PARALELO)))
              .replace("{total}", String(DIAS_EM_PARALELO))
              .replace("{data}", dataBr(c.desde!))}
          </p>
          <p className="text-sm">
            {t("{n} prazos confirmados: {a} iguais à sugestão, {e} com data errada sem aviso, {i} diferentes com aviso, {s} sem contagem possível.")
              .replace("{n}", String(c.confirmadas))
              .replace("{a}", String(c.acertos))
              .replace("{e}", String(erros))
              .replace("{i}", String(avisadas))
              .replace("{s}", String(c.semSugestao))}
          </p>
          {c.divergencias.length > 0 && (
            <ul className="space-y-1 text-sm">
              {c.divergencias.map((d) => (
                <li key={d.publicacao.id} data-testid="divergencia">
                  <span className="font-medium">{d.publicacao.numeroProcesso ?? t("processo sem número")}</span>
                  {" · "}
                  {t("sugerida {s}, confirmada {c} ({d} dias)")
                    .replace("{s}", dataBr(d.sugerida))
                    .replace("{c}", dataBr(d.confirmada))
                    .replace("{d}", d.diferenca > 0 ? `+${d.diferenca}` : String(d.diferenca))}
                  {" · "}
                  <span className={d.julgamento === "errou" ? "font-medium text-destructive" : "text-muted-foreground"}>
                    {d.julgamento === "errou" ? t("data errada sem aviso") : t("a sugestão avisava")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">
            {c.diasEmParalelo >= DIAS_EM_PARALELO && c.divergencias.length === 0
              ? t("{total} dias em paralelo sem divergência: o escritório pode começar a conversa sobre confiar na contagem.").replace(
                  "{total}",
                  String(DIAS_EM_PARALELO),
                )
              : t("Só depois de {total} dias em paralelo sem divergência se conversa sobre confiar na contagem. Continue com o seu controle atual.").replace(
                  "{total}",
                  String(DIAS_EM_PARALELO),
                )}
          </p>
        </>
      )}
    </section>
  );
}
