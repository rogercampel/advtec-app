import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  calculaFunil,
  DIAS_DO_PAINEL,
  escolheHorario,
  lerDias,
  periodoDoFunil,
  type Aviso,
  type EtapaId,
  type LinhaDeCaso,
  type LinhaDeConsulta,
  type LinhaDeMensagem,
  type MotivoNaoMedido,
  type Passagem,
} from "@/lib/painel/funil";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Painel de medição" };

/** O PostgREST devolve no máximo ~1000 linhas por chamada; lemos em páginas e paramos no teto. */
const TAMANHO_DA_PAGINA = 1000;
const PAGINAS_NO_MAXIMO = 10;

type Pagina<T> = PromiseLike<{ data: T[] | null }>;

/** Lê tudo em páginas até acabar ou bater no teto; `truncado` diz se bateu (a contagem seria parcial). */
async function lerEmPaginas<T>(pagina: (de: number, ate: number) => Pagina<T>): Promise<{ linhas: T[]; truncado: boolean }> {
  const linhas: T[] = [];
  for (let i = 0; i < PAGINAS_NO_MAXIMO; i += 1) {
    const { data } = await pagina(i * TAMANHO_DA_PAGINA, (i + 1) * TAMANHO_DA_PAGINA - 1);
    const lote = data ?? [];
    linhas.push(...lote);
    if (lote.length < TAMANHO_DA_PAGINA) return { linhas, truncado: false };
  }
  return { linhas, truncado: true };
}

/**
 * PAINEL DE MEDIÇÃO — 0001.E5, critério 12. Os cinco números do funil, em lista, cada um
 * com a taxa de passagem e a definição ao lado. Lê com a SESSÃO (a RLS recorta) e filtra
 * pela organização ativa em toda consulta. As contas e as definições moram em `lib/painel/funil.ts`.
 */
export default async function PainelDeMedicao({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (s: string) => traduzir(s, user.idioma);
  const tag = tagDeIdioma(user.idioma);
  const org = activeOrg.orgId;
  const dias = lerDias((await searchParams).dias);

  const supabase = await createClient();
  const agora = new Date();

  const { data: organizacao } = await supabase.from("organizations").select("timezone").eq("id", org).maybeSingle();
  const periodo = periodoDoFunil(dias, agora, organizacao?.timezone);
  const desde = periodo.inicio.toISOString();

  async function horariosDosAgentes() {
    const { data: agentes } = await supabase
      .from("ai_agents")
      .select("id, name, created_at, published_version_id")
      .eq("organization_id", org)
      .is("archived_at", null)
      .not("published_version_id", "is", null);
    const lista = agentes ?? [];
    if (lista.length === 0) return [];
    const { data: linhas } = await supabase
      .from("ai_agent_versions")
      .select("id, trigger_config")
      .eq("organization_id", org)
      .in(
        "id",
        lista.map((a) => a.published_version_id as string),
      );
    const porVersao = new Map((linhas ?? []).map((v) => [v.id as string, v.trigger_config as unknown]));
    return lista.map((a) => ({ agente: a.name as string, criadoEm: a.created_at as string, trigger_config: porVersao.get(a.published_version_id as string) }));
  }

  const [mensagens, casos, consultas, versoes] = await Promise.all([
    lerEmPaginas<LinhaDeMensagem>((de, ate) =>
      supabase
        .from("messages")
        .select("conversation_id, created_at, direction, type")
        .eq("organization_id", org)
        .eq("direction", "inbound")
        .gte("created_at", desde)
        .order("created_at", { ascending: true })
        .range(de, ate),
    ),
    lerEmPaginas<LinhaDeCaso>((de, ate) =>
      supabase
        .from("crm_leads")
        .select("id, status, custom_fields, contact_id, created_at")
        .eq("organization_id", org)
        .gte("created_at", desde)
        .order("created_at", { ascending: true })
        .range(de, ate),
    ),
    lerEmPaginas<LinhaDeConsulta>((de, ate) =>
      supabase
        .from("calendar_appointments")
        .select("contact_id, status, starts_at")
        .eq("organization_id", org)
        .gte("created_at", desde)
        .order("created_at", { ascending: true })
        .range(de, ate),
    ),
    horariosDosAgentes(),
  ]);

  const horario = escolheHorario(versoes);
  const funil = calculaFunil({
    periodo,
    janela: horario.janela,
    mensagens: mensagens.linhas,
    casos: casos.linhas,
    consultas: consultas.linhas,
    truncado: { mensagens: mensagens.truncado, casos: casos.truncado, consultas: consultas.truncado },
    agora,
  });

  const dia = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(tag, { timeZone: "UTC", dateStyle: "short" });
  const diaDaSemana = (n: number) => new Date(Date.UTC(2023, 0, 1 + n)).toLocaleDateString(tag, { timeZone: "UTC", weekday: "short" });
  const rotuloDosDias: Record<number, string> = { 7: t("7 dias"), 30: t("30 dias"), 90: t("90 dias") };

  const NOME: Record<EtapaId, string> = {
    fora_do_horario: t("Atendimentos fora do horário"),
    triados: t("Triados"),
    agendados: t("Agendados"),
    compareceram: t("Compareceram"),
    clientes: t("Viraram cliente"),
  };
  const DEFINICAO: Record<EtapaId, string> = {
    fora_do_horario: t("Conversas cuja primeira mensagem do cliente no período chegou fora do horário comercial do escritório."),
    triados: t("Casos abertos no período com a área do direito preenchida pela triagem."),
    agendados: t("Desses casos, os que têm consulta marcada na agenda e não cancelada."),
    compareceram: t("Desses casos, os que têm consulta registrada como realizada."),
    clientes: t("Desses casos, os que foram ganhos no funil."),
  };
  const motivo = (m: MotivoNaoMedido): string => {
    if (m === "sem_horario_configurado") return t("Não medido: nenhum agente publicado tem horário de funcionamento configurado.");
    if (m === "sem_registro_de_comparecimento") return t("Não medido: há consultas que já passaram, mas ninguém registrou se o cliente compareceu.");
    return t("Não medido: as consultas marcadas ainda não aconteceram.");
  };
  const textoDaPassagem = (p: Passagem): string | null => {
    if (p.tipo === "primeira") return null;
    if (p.tipo === "outra_unidade") return t("Sem taxa: conversas e casos são unidades diferentes.");
    if (p.tipo === "sem_base") return t("Sem taxa: a etapa anterior não foi medida ou é zero.");
    return null;
  };
  const aviso = (a: Aviso): string => {
    if (a === "leitura_parcial_mensagens") return t("Leitura parcial das mensagens: o limite de linhas lidas foi atingido, e os atendimentos podem estar abaixo do real.");
    if (a === "leitura_parcial_casos") return t("Leitura parcial dos casos: o limite de linhas lidas foi atingido, e os números podem estar abaixo do real.");
    return t("Leitura parcial das consultas: o limite de linhas lidas foi atingido, e os números podem estar abaixo do real.");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Painel de medição")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Do atendimento fora do horário ao cliente fechado: os cinco números que dizem se o sistema está funcionando para o escritório.")}
        </p>
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("Período")}>
          <span className="text-muted-foreground">{t("Período")}:</span>
          {DIAS_DO_PAINEL.map((d) => (
            <Link
              key={d}
              href={`/app/painel?dias=${d}`}
              aria-current={d === dias ? "page" : undefined}
              className={d === dias ? "rounded-md border bg-accent px-2 py-1 font-medium" : "rounded-md border px-2 py-1 underline-offset-2 hover:underline"}
            >
              {rotuloDosDias[d]}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-muted-foreground" data-testid="periodo-do-painel">
          {dia(funil.periodo.de)} – {dia(funil.periodo.ate)} · {funil.periodo.fuso}
        </p>
      </header>

      {funil.avisos.map((a) => (
        <p key={a} role="alert" className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
          {aviso(a)}
        </p>
      ))}

      <ol className="divide-y rounded-md border bg-card">
        {funil.etapas.map((etapa, i) => {
          const foraDoHorario = etapa.id === "fora_do_horario";
          const denominador = foraDoHorario ? funil.totalDeAtendimentos : funil.casosAbertos;
          const semPassagem = textoDaPassagem(etapa.passagem);
          return (
            <li key={etapa.id} className="space-y-1 px-4 py-4" data-testid={`etapa-${etapa.id}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-medium">
                  {i + 1}. {NOME[etapa.id]}
                </h2>
                {etapa.medida.medido ? (
                  <p className="text-2xl font-semibold tabular-nums" data-testid={`numero-${etapa.id}`}>
                    {etapa.medida.valor}
                  </p>
                ) : (
                  <p className="text-sm font-medium text-muted-foreground" data-testid={`numero-${etapa.id}`}>
                    {t("não medido")}
                  </p>
                )}
              </div>
              {etapa.medida.medido ? (
                <p className="text-sm text-muted-foreground">
                  {etapa.medida.valor} {t("de")} {denominador} {foraDoHorario ? t("atendimentos no período") : t("casos abertos no período")}
                  {etapa.passagem.tipo === "taxa" ? ` · ${etapa.passagem.percentual}% ${t("da etapa anterior")}` : ""}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{motivo(etapa.medida.motivo)}</p>
              )}
              {semPassagem ? <p className="text-xs text-muted-foreground">{semPassagem}</p> : null}
              {etapa.passagem.tipo === "taxa" && etapa.passagem.acimaDaAnterior ? (
                <p className="text-xs text-muted-foreground">{t("Acima da etapa anterior: nem todo caso passou por ela, e o painel mostra o número como é.")}</p>
              ) : null}
              {etapa.id === "triados" && etapa.medida.medido && etapa.medida.valor === 0 && funil.casosAbertos > 0 ? (
                <p className="text-xs text-muted-foreground">{t("A triagem ainda não grava a área do direito nos casos.")}</p>
              ) : null}
              {etapa.id === "compareceram" && etapa.medida.medido && funil.agendadosSemDesfecho > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {funil.agendadosSemDesfecho} {t("casos agendados com consulta já passada e sem desfecho registrado.")}
                </p>
              ) : null}
              {foraDoHorario && horario.janela ? (
                <p className="text-xs text-muted-foreground" data-testid="horario-usado">
                  {t("Horário usado")}: {horario.agente} · {[...horario.janela.weekdays].sort((a, b) => a - b).map(diaDaSemana).join(", ")} · {horario.janela.start}–{horario.janela.end} ({horario.janela.timezone})
                  {horario.divergentes ? ` · ${t("Há agentes com horários diferentes; vale o do mais antigo.")}` : ""}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{DEFINICAO[etapa.id]}</p>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-muted-foreground">
        {t("Triados, agendados, compareceram e clientes contam os casos abertos no período e podem não ser subconjuntos uns dos outros; nada é estimado onde o dado não existe.")}
      </p>
    </div>
  );
}
