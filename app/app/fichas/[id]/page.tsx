import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { escreveComoPlatformAdmin, ROLE_RANK } from "@/lib/auth/types";
import { MENSAGENS_NA_FICHA, montaFicha, type MensagemDaFicha } from "@/lib/casos/ficha";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

import { AgendarConsulta } from "../_components/AgendarConsulta";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ficha do caso" };

const COLUNAS_DA_MENSAGEM = "id, conversation_id, direction, body, media_mime, media_size_bytes, created_at, type";

/**
 * A FICHA DO CASO — 0001.E4 (#18). O caso é o negócio do funil (ADR 0003). Lê com
 * a SESSÃO e filtra pela organização ativa em toda consulta: caso de outro
 * escritório é 404, sem dizer se existe. Abrir a ficha é de quem vê o negócio no
 * funil; agendar é `agent` em diante (a rota da agenda cobra de novo).
 *
 * Mensagens, documentos e compromissos são do CONTATO, não do negócio: dois casos
 * do mesmo cliente mostram o mesmo histórico. E o histórico é o que o RLS deixa
 * esta pessoa ver: um `agent` em modo "só os meus" não vê conversa de colega.
 */
export default async function FichaDoCaso({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const t = (s: string) => traduzir(s, user.idioma);
  const org = activeOrg.orgId;

  const supabase = await createClient();
  const { data: caso } = await supabase
    .from("crm_leads")
    .select("id, title, custom_fields, created_at, contact_id")
    .eq("organization_id", org)
    .eq("id", id)
    .maybeSingle();
  if (!caso) notFound();

  const contatoId = caso.contact_id;
  const [contato, recentes, comArquivo, compromissos, tipos, organizacao] = await Promise.all([
    contatoId
      ? supabase.from("contacts").select("id, name, display_name, phone_number").eq("organization_id", org).eq("id", contatoId).maybeSingle()
      : Promise.resolve({ data: null }),
    contatoId
      ? supabase
          .from("messages")
          .select(COLUNAS_DA_MENSAGEM, { count: "exact" })
          .eq("organization_id", org)
          .eq("contact_id", contatoId)
          .order("created_at", { ascending: false })
          .limit(MENSAGENS_NA_FICHA)
      : Promise.resolve({ data: [], count: 0 }),
    // Documento antigo não pode sumir só porque o histórico tem teto.
    contatoId
      ? supabase
          .from("messages")
          .select(COLUNAS_DA_MENSAGEM)
          .eq("organization_id", org)
          .eq("contact_id", contatoId)
          .eq("direction", "inbound")
          .not("media_mime", "is", null)
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] }),
    contatoId
      ? supabase
          .from("calendar_appointments")
          .select("id, title, starts_at, status")
          .eq("organization_id", org)
          .eq("contact_id", contatoId)
          .order("starts_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
    supabase.from("calendar_event_types").select("id, name").eq("organization_id", org).eq("is_active", true).order("name"),
    supabase.from("organizations").select("timezone").eq("id", org).maybeSingle(),
  ]);

  const porId = new Map<string, MensagemDaFicha>();
  for (const m of [...((recentes.data ?? []) as MensagemDaFicha[]), ...((comArquivo.data ?? []) as MensagemDaFicha[])]) porId.set(m.id, m);
  const ficha = montaFicha({
    caso,
    contato: contato.data ?? null,
    mensagens: [...porId.values()],
    compromissos: compromissos.data ?? [],
    agora: new Date(),
  });
  const total = "count" in recentes && typeof recentes.count === "number" ? recentes.count : ficha.historico.length;
  const fora = Math.max(0, total - ficha.historico.length);

  const fuso = organizacao.data?.timezone || "America/Sao_Paulo";
  const tag = tagDeIdioma(user.idioma);
  const data = (iso: string) => new Date(iso).toLocaleString(tag, { timeZone: fuso, dateStyle: "short", timeStyle: "short" });
  // `is_platform_admin` sozinho deixaria o suporte só-leitura ver o formulário (ver `escreveComoPlatformAdmin`).
  const podeAgendar = (escreveComoPlatformAdmin(user) && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent;
  const conversa = ficha.historico.at(-1)?.conversa ?? null;
  const aDefinir = t("a definir pela triagem jurídica");

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <nav className="text-sm">
        <Link href="/app/fichas" className="underline-offset-2 hover:underline">
          ← {t("Fichas dos casos")}
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{ficha.caso.titulo}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Aberto em")} {data(ficha.caso.abertoEm)}
        </p>
      </header>

      <section aria-labelledby="f-quem" className="grid gap-3 rounded-md border bg-card p-4 sm:grid-cols-2">
        <h2 id="f-quem" className="sr-only">
          {t("Resumo do caso")}
        </h2>
        <div>
          <p className="text-xs uppercase text-muted-foreground">{t("Quem")}</p>
          <p data-testid="ficha-quem">{ficha.quem ? `${ficha.quem.nome}${ficha.quem.telefone ? ` · ${ficha.quem.telefone}` : ""}` : t("Caso sem contato")}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">{t("Área")}</p>
          <p data-testid="ficha-area">{ficha.area ?? <span className="text-muted-foreground">{aDefinir}</span>}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs uppercase text-muted-foreground">{t("Resumo")}</p>
          <p data-testid="ficha-resumo">{ficha.resumo ?? <span className="text-muted-foreground">{aDefinir}</span>}</p>
        </div>
        <div className="sm:col-span-2" data-testid="ficha-urgencia">
          <p className="text-xs uppercase text-muted-foreground">{t("Urgência")}</p>
          {ficha.urgenciaDaTriagem ? (
            <p className="font-medium text-destructive" data-testid="ficha-urgencia-da-triagem">
              {ficha.urgenciaDaTriagem}
            </p>
          ) : ficha.triagemRodou && ficha.urgenciasNoHistorico.length === 0 ? (
            <p className="text-muted-foreground">{t("A triagem não encontrou urgência no que o cliente escreveu.")}</p>
          ) : (
            <p className="text-muted-foreground">{aDefinir}</p>
          )}
          {ficha.urgenciasNoHistorico.length > 0 && (
            <ul className="mt-1 space-y-1 text-sm" data-testid="ficha-urgencias-no-historico">
              {ficha.urgenciasNoHistorico.map((u, i) => (
                <li key={`${u.id}-${i}`}>
                  <span className="font-medium text-destructive">{t("O cliente descreveu uma urgência jurídica")}</span> ({u.rotulo}, {data(u.em)}): “{u.trecho}”
                </li>
              ))}
            </ul>
          )}
          {ficha.palavrasDeUrgencia.length > 0 && (
            <ul className="mt-1 space-y-1 text-sm">
              {ficha.palavrasDeUrgencia.map((u) => (
                <li key={u.id}>
                  <span className="text-amber-800">{t("O cliente escreveu palavra de urgência")}</span> ({data(u.em)}): “{u.trecho}”
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="f-agenda" className="space-y-3 rounded-md border bg-card p-4">
        <h2 id="f-agenda" className="font-medium">
          {t("Compromissos")}
        </h2>
        {ficha.compromissos.proximos.length === 0 && ficha.compromissos.passados.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhum compromisso com este cliente.")}</p>
        ) : (
          <ul className="space-y-1 text-sm" data-testid="ficha-compromissos">
            {[...ficha.compromissos.proximos, ...ficha.compromissos.passados].map((c) => (
              <li key={c.id}>
                {data(c.starts_at)} — {c.title}
              </li>
            ))}
          </ul>
        )}
        {ficha.quem && podeAgendar && (
          <AgendarConsulta contatoId={caso.contact_id!} conversaId={conversa} titulo={`${t("Consulta")} — ${ficha.quem.nome}`} tipos={tipos.data ?? []} />
        )}
      </section>

      <section aria-labelledby="f-docs" className="space-y-2 rounded-md border bg-card p-4">
        <h2 id="f-docs" className="font-medium">
          {t("Documentos enviados")}
        </h2>
        {ficha.documentos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhum documento enviado na conversa.")}</p>
        ) : (
          <ul className="space-y-1 text-sm" data-testid="ficha-documentos">
            {ficha.documentos.map((d) => (
              <li key={d.id}>
                {data(d.em)} — {t(d.tipo)}
                {d.tamanhoKb !== null && ` · ${d.tamanhoKb} KB`} ·{" "}
                <Link href={`/app/inbox?id=${d.conversa}`} className="underline-offset-2 hover:underline">
                  {t("abrir na conversa")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="f-hist" className="space-y-2 rounded-md border bg-card p-4">
        <h2 id="f-hist" className="font-medium">
          {t("Histórico da conversa")}
        </h2>
        {fora > 0 && (
          <p className="text-sm text-muted-foreground">
            {t("Mensagens mais antigas ficaram na caixa de entrada:")} {fora}
          </p>
        )}
        {ficha.historico.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhuma mensagem com este cliente.")}</p>
        ) : (
          <ol className="space-y-2 text-sm" data-testid="ficha-historico">
            {ficha.historico.map((h) => (
              <li key={h.id} className={h.de === "cliente" ? "" : "pl-6 text-muted-foreground"}>
                <span className="text-xs text-muted-foreground">
                  {data(h.em)} · {h.de === "cliente" ? t("Cliente") : t("Escritório")}
                </span>
                <p className="whitespace-pre-wrap">{h.texto}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
