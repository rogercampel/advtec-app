import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fichas dos casos" };

/** Quantos casos a lista mostra: os mais recentes. O funil continua sendo o lugar de procurar. */
const CASOS_NA_LISTA = 50;

/**
 * FICHAS DOS CASOS — 0001.E4 (#18). A porta para a ficha: os casos (negócios do
 * funil, ADR 0003) mais recentes do escritório, cada um com o cliente. Lê com a
 * sessão e filtra pela organização ativa.
 */
export default async function FichasDosCasos() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (s: string) => traduzir(s, user.idioma);

  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_leads")
    .select("id, title, created_at, contacts:contact_id(name, display_name)")
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false })
    .limit(CASOS_NA_LISTA);

  const casos = (data ?? []).map((c) => {
    const contato = (Array.isArray(c.contacts) ? c.contacts[0] : c.contacts) as { name: string | null; display_name: string | null } | null;
    return { id: c.id, titulo: c.title?.trim() || t("Caso sem título"), cliente: nomeDoContato(contato), em: c.created_at };
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Fichas dos casos")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Cada caso com quem é o cliente, o histórico da conversa, os documentos enviados e os compromissos — sem abrir a conversa.")}
        </p>
      </header>
      {casos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Nenhum caso ainda.")}</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {casos.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm" data-testid="caso-na-lista">
              <Link href={`/app/fichas/${c.id}`} className="font-medium underline-offset-2 hover:underline">
                {c.titulo}
              </Link>
              <span className="text-muted-foreground">
                {c.cliente ?? t("Caso sem contato")} · {new Date(c.em).toLocaleDateString(tagDeIdioma(user.idioma), { timeZone: "America/Sao_Paulo" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
