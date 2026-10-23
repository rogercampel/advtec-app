import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  calculaFunil,
  DIAS_DO_PAINEL,
  elegiveisDoFunil,
  escolheHorario,
  lerDias,
  periodoDoFunil,
  type Aviso,
  type EtapaId,
  type Fonte,
  type LeituraDoHorario,
  type LinhaDeCaso,
  type LinhaDeConsulta,
  type LinhaDeConversa,
  type LinhaDeMensagem,
  type LinhaDeVinculo,
  type Medida,
  type Passagem,
} from "@/lib/painel/funil";
import { lerEmPaginas, lerPorLotes, leituraVazia, type Leitura } from "@/lib/painel/leitura";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Painel de medição" };

/** Quantos ids vão num `in (...)` por consulta: a URL do PostgREST tem limite. */
const IDS_POR_LOTE = 100;

/**
 * PAINEL DE MEDIÇÃO — 0001.E5, critério 12. Os cinco números do funil, em lista, cada um
 * com a taxa de passagem e a definição ao lado. Lê com a SESSÃO (a RLS recorta) e filtra
 * pela organização ativa em toda consulta. As contas e as definições moram em `lib/painel/funil.ts`;
 * erro, paginação e teto de leitura, em `lib/painel/leitura.ts` (leitura com erro ou parcial
 * NUNCA vira número: a etapa diz "não medido").
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

  // O fuso é o que corta o período. Sem ele (erro ou linha invisível) NADA é medido: o corte seria um palpite.
  const { data: organizacao, error: erroDoFuso } = await supabase.from("organizations").select("timezone").eq("id", org).maybeSingle();
  const fusoLido = !erroDoFuso && organizacao != null;
  const periodo = periodoDoFunil(dias, agora, organizacao?.timezone);
  const desde = periodo.inicio.toISOString();

  async function horariosDosAgentes(): Promise<LeituraDoHorario> {
    const { data: agentes, error } = await supabase
      .from("ai_agents")
      .select("id, name, created_at, published_version_id")
      .eq("organization_id", org)
      .is("archived_at", null)
      .not("published_version_id", "is", null);
    if (error || agentes === null) return { ...escolheHorario([]), estado: "erro" };
    if (agentes.length === 0) return { ...escolheHorario([]), estado: "ok" };
    const { data: linhas, error: erroDasVersoes } = await supabase
      .from("ai_agent_versions")
      .select("id, trigger_config")
      .eq("organization_id", org)
      .in(
        "id",
        agentes.map((a) => a.published_version_id as string),
      );
    if (erroDasVersoes || linhas === null) return { ...escolheHorario([]), estado: "erro" };
    const porVersao = new Map(linhas.map((v) => [v.id as string, v.trigger_config as unknown]));
    const versoes = agentes.map((a) => ({
      agente: a.name as string,
      criadoEm: a.created_at as string,
      trigger_config: porVersao.get(a.published_version_id as string),
    }));
    return { ...escolheHorario(versoes), estado: "ok" };
  }

  let conversas: Leitura<LinhaDeConversa> = leituraVazia();
  let mensagens: Leitura<LinhaDeMensagem> = leituraVazia();
  let casos: Leitura<LinhaDeCaso> = leituraVazia();
  let vinculos: Leitura<LinhaDeVinculo> = leituraVazia();
  let consultas: Leitura<LinhaDeConsulta> = leituraVazia();
  let horario: LeituraDoHorario = { ...escolheHorario([]), estado: "ok" };

  if (fusoLido) {
    // Ordem total (created_at, id): paginar por `range` sobre ordem com empate repete ou pula linha.
    [conversas, casos, horario] = await Promise.all([
      lerEmPaginas<LinhaDeConversa>((de, ate) =>
        supabase
          .from("conversations")
          .select("id, created_at, is_group", { count: "exact" })
          .eq("organization_id", org)
          .eq("is_group", false)
          .gte("created_at", desde)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate),
      ),
      lerEmPaginas<LinhaDeCaso>((de, ate) =>
        supabase
          .from("crm_leads")
          .select("id, status, custom_fields, created_at", { count: "exact" })
          .eq("organization_id", org)
          // o caso entra pela data em que a triagem o registrou, não pela de criação
          .gte("custom_fields->>triagem_em", desde)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate),
      ),
      horariosDosAgentes(),
    ]);

    // As mensagens são lidas só das conversas novas (a primeira fala de TODA a história delas).
    if (conversas.estado === "ok") {
      mensagens = await lerPorLotes<LinhaDeMensagem>(
        conversas.linhas.map((c) => c.id),
        IDS_POR_LOTE,
        (lote) =>
          lerEmPaginas<LinhaDeMensagem>((de, ate) =>
            supabase
              .from("messages")
              .select("id, conversation_id, created_at, direction, type", { count: "exact" })
              .eq("organization_id", org)
              .eq("direction", "inbound")
              .in("conversation_id", lote)
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .range(de, ate),
          ),
      );
    }

    // Consultas: só as VINCULADAS aos casos que seguem no funil (triados não recusados).
    if (casos.estado === "ok") {
      const elegiveis = elegiveisDoFunil(casos.linhas, periodo);
      vinculos = await lerPorLotes<LinhaDeVinculo>(
        elegiveis.map((c) => c.id),
        IDS_POR_LOTE,
        (lote) =>
          lerEmPaginas<LinhaDeVinculo>((de, ate) =>
            supabase
              .from("crm_lead_links")
              .select("id, lead_id, target_id", { count: "exact" })
              .eq("organization_id", org)
              .eq("target_kind", "appointment")
              .in("lead_id", lote)
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .range(de, ate),
          ),
      );
      if (vinculos.estado === "ok") {
        consultas = await lerPorLotes<LinhaDeConsulta>(
          vinculos.linhas.map((v) => v.target_id),
          IDS_POR_LOTE,
          (lote) =>
            lerEmPaginas<LinhaDeConsulta>((de, ate) =>
              supabase
                .from("calendar_appointments")
                .select("id, status, starts_at", { count: "exact" })
                .eq("organization_id", org)
                .in("id", lote)
                .order("starts_at", { ascending: true })
                .order("id", { ascending: true })
                .range(de, ate),
            ),
        );
      }
    }
  }

  const funil = calculaFunil({ periodo, fusoLido, horario, conversas, mensagens, casos, vinculos, consultas, agora });

  const dia = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(tag, { timeZone: "UTC", dateStyle: "short" });
  const diaDaSemana = (n: number) => new Date(Date.UTC(2023, 0, 1 + n)).toLocaleDateString(tag, { timeZone: "UTC", weekday: "short" });
  const rotuloDosDias: Record<number, string> = { 7: t("7 dias"), 30: t("30 dias"), 90: t("90 dias") };

  const NOME: Record<EtapaId, string> = {
    fora_do_horario: t("Primeiros contatos fora do horário"),
    triados: t("Triados"),
    agendados: t("Agendados"),
    compareceram: t("Compareceram"),
    clientes: t("Viraram cliente"),
  };
  const DEFINICAO: Record<EtapaId, string> = {
    fora_do_horario: t(
      "Conversas novas no período (a primeira mensagem do cliente, em toda a história, caiu no período), fora de grupos, que chegaram fora do horário comercial do escritório.",
    ),
    triados: t("Casos que a triagem registrou no período, com a área do direito preenchida. Conta só casos que a triagem registrou."),
    agendados: t("Dos triados não recusados, os que têm consulta vinculada ao caso na agenda e não cancelada."),
    compareceram: t("Dos agendados com consulta já passada, os que têm consulta registrada como realizada. Consultas que ainda vão acontecer ficam fora."),
    clientes: t("Dos que compareceram, os que foram ganhos no funil."),
  };
  const UNIDADE: Partial<Record<EtapaId, string>> = {
    fora_do_horario: t("primeiros contatos no período"),
    agendados: t("triados não recusados"),
    compareceram: t("casos agendados com consulta já passada"),
    clientes: t("casos que compareceram"),
  };
  const FONTE: Record<Fonte, string> = {
    conversas: t("as conversas"),
    mensagens: t("as mensagens"),
    casos: t("os casos"),
    vinculos: t("os vínculos entre consultas e casos"),
    consultas: t("as consultas"),
    horario: t("o horário do agente"),
    fuso: t("o fuso da organização"),
  };
  const motivo = (m: Extract<Medida, { medido: false }>): string => {
    switch (m.motivo) {
      case "sem_horario_configurado":
        return t("Não medido: nenhum agente publicado tem horário de funcionamento configurado.");
      case "horario_atravessa_meia_noite":
        return t("Não medido: horário que atravessa a meia-noite não é suportado. Configure o horário do agente dentro do mesmo dia.");
      case "erro_ao_ler":
        return t("Não medido: erro ao ler os dados desta etapa (veja o aviso acima).");
      case "leitura_parcial":
        return t("Não medido: leitura parcial, o limite de linhas lidas foi atingido (veja o aviso acima).");
      case "sem_registro_de_comparecimento":
        return `${t("Não medido: falta registrar o desfecho de")} ${m.faltam ?? 0} ${t("consultas que já passaram.")}`;
      case "consultas_ainda_no_futuro":
        return t("Não medido: as consultas marcadas ainda não aconteceram.");
      case "etapa_anterior_nao_medida":
        return t("Não medido: depende da etapa anterior, que não foi medida.");
    }
  };
  const textoDaPassagem = (p: Passagem): string | null => {
    if (p.tipo === "outra_unidade") return t("Sem taxa: conversas e casos são unidades diferentes.");
    if (p.tipo === "sem_base") return t("Sem taxa: a etapa anterior não foi medida ou é zero.");
    return null;
  };
  const aviso = (a: Aviso): string =>
    a.tipo === "erro"
      ? `${t("Erro ao ler")} ${FONTE[a.fonte]}. ${t("As etapas que dependem disso aparecem como não medidas.")}`
      : `${t("Leitura parcial:")} ${FONTE[a.fonte]}. ${t("O limite de linhas lidas foi atingido; as etapas que dependem disso aparecem como não medidas.")}`;

  const d = funil.desdobramento;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Painel de medição")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Do atendimento fora do horário ao cliente fechado: os cinco números que dizem se o sistema está funcionando para o escritório.")}
        </p>
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("Período")}>
          <span className="text-muted-foreground">{t("Período")}:</span>
          {DIAS_DO_PAINEL.map((n) => (
            <Link
              key={n}
              href={`/app/painel?dias=${n}`}
              aria-current={n === dias ? "page" : undefined}
              className={n === dias ? "rounded-md border bg-accent px-2 py-1 font-medium" : "rounded-md border px-2 py-1 underline-offset-2 hover:underline"}
            >
              {rotuloDosDias[n]}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-muted-foreground" data-testid="periodo-do-painel">
          {dia(funil.periodo.de)} – {dia(funil.periodo.ate)} · {funil.periodo.fuso}
        </p>
      </header>

      {funil.avisos.map((a) => (
        <p key={`${a.fonte}-${a.tipo}`} role="alert" className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
          {aviso(a)}
        </p>
      ))}
      {funil.fusosDiferem && horario.janela ? (
        <p role="status" data-testid="aviso-fusos" className="rounded-md border px-3 py-2 text-sm">
          {t("O fuso do escritório")} ({funil.periodo.fuso}) {t("é diferente do fuso do horário do agente")} ({horario.janela.timezone}).{" "}
          {t("O período usa o do escritório; o “fora do horário” usa o do agente.")}
        </p>
      ) : null}

      <ol className="divide-y rounded-md border bg-card">
        {funil.etapas.map((etapa, i) => {
          const unidade = UNIDADE[etapa.id];
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
                  {etapa.id === "triados"
                    ? `${etapa.medida.valor} ${t("casos triados no período")}`
                    : `${etapa.medida.valor} ${t("de")} ${etapa.de ?? 0} ${unidade ?? ""}`}
                  {etapa.passagem.tipo === "taxa" ? ` · ${etapa.passagem.percentual}% ${t("da etapa anterior")}` : ""}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{motivo(etapa.medida)}</p>
              )}
              {semPassagem ? <p className="text-xs text-muted-foreground">{semPassagem}</p> : null}
              {etapa.id === "triados" && d ? (
                <p className="text-xs text-muted-foreground" data-testid="desdobramento-da-triagem">
                  {t("Seguiram")}: {d.seguiu} · {t("Recusados")}: {d.recusou} · {t("Passaram ao advogado")}: {d.passouAoAdvogado}
                  {d.semDecisao > 0 ? ` · ${t("Sem decisão registrada")}: ${d.semDecisao}` : ""}
                </p>
              ) : null}
              {etapa.id === "compareceram" && funil.aindaPorAcontecer !== null && funil.aindaPorAcontecer > 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="ainda-por-acontecer">
                  {funil.aindaPorAcontecer} {t("casos agendados com consulta ainda por acontecer (fora desta conta).")}
                </p>
              ) : null}
              {etapa.id === "clientes" && funil.ganhos && funil.ganhos.total > 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="ganhos-sem-consulta">
                  {funil.ganhos.semConsultaRealizada !== null
                    ? `${t("Ganhos sem consulta realizada")}: ${funil.ganhos.semConsultaRealizada} ${t("de")} ${funil.ganhos.total} ${t("ganhos entre os triados não recusados.")}`
                    : `${funil.ganhos.total} ${t("ganhos entre os triados não recusados; sem 'Compareceram' medido, não dá para separar quem teve consulta realizada.")}`}
                </p>
              ) : null}
              {etapa.id === "fora_do_horario" && horario.janela ? (
                <p className="text-xs text-muted-foreground" data-testid="horario-usado">
                  {t("Horário usado")}: {horario.agente} · {[...horario.janela.weekdays].sort((a, b) => a - b).map(diaDaSemana).join(", ")} · {horario.janela.start}–{horario.janela.end} ({horario.janela.timezone}) ·{" "}
                  {t("é o horário publicado hoje e vale para o período inteiro")}
                  {horario.divergentes ? ` · ${t("Há agentes com horários diferentes; vale o do mais antigo.")}` : ""}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{DEFINICAO[etapa.id]}</p>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-muted-foreground">
        {t(
          "Cada etapa parte da anterior e cada caso conta uma vez; casos recusados pela triagem não entram nas etapas seguintes. As consultas entram pelo vínculo com o caso na agenda e de qualquer categoria (consulta, reunião, call…): o painel não filtra por categoria. Nada é estimado onde o dado não existe.",
        )}
      </p>
    </div>
  );
}
