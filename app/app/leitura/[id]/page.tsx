import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { CSS_DO_DOCUMENTO, documentoEmHtml } from "@/lib/acervo/documento-em-html";
import type { DocumentoDeLeitura } from "@/lib/acervo/documento-de-leitura";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leitura de processo" };

/**
 * O documento de uma leitura (spec 0003.E6). Lê com a sessão: a RLS só devolve a
 * leitura do escritório de quem pede — a de outro escritório é 404. O HTML vem
 * do mesmo renderizador da versão de impressão, que escapa todo texto dos autos.
 */
export default async function LeituraDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const t = (s: string) => traduzir(s, user.idioma);

  const supabase = await createClient();
  const { data } = await supabase
    .from("acervo_leituras")
    .select("nome_do_arquivo, estado, documento, motivo_da_falha")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <nav className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link href="/app/leitura" className="underline-offset-2 hover:underline">
          ← {t("Leituras do escritório")}
        </Link>
        {data.estado === "pronta" && (
          <a href={`/api/v1/acervo/leituras/${id}/imprimir`} target="_blank" rel="noopener" className="font-medium underline-offset-2 hover:underline">
            {t("Versão para imprimir")}
          </a>
        )}
      </nav>
      {data.estado === "lendo" && <p className="text-sm text-muted-foreground">{t("Ainda lendo este processo. A lista avisa quando ficar pronto.")}</p>}
      {data.estado === "falhou" && (
        <p role="alert" className="text-sm text-destructive">
          {t("A leitura falhou")}: {data.motivo_da_falha}
        </p>
      )}
      {data.estado === "pronta" && data.documento && (
        <div className="rounded-md border bg-card p-6">
          <style>{CSS_DO_DOCUMENTO}</style>
          <div
            // O renderizador escapa todo texto que vem dos autos e do modelo (ver o teste).
            dangerouslySetInnerHTML={{ __html: documentoEmHtml(data.documento as DocumentoDeLeitura, t, `${t("Leitura de")} ${data.nome_do_arquivo}`) }}
          />
        </div>
      )}
    </div>
  );
}
