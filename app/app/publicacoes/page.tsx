import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import {
  CAMPO_DO_PROCESSO,
  COLUNAS_DA_PUBLICACAO,
  daLinha,
  montaCaixa,
  semRepetir,
  type LinhaDaPublicacao,
  type PublicacaoDaCaixa,
} from "@/lib/djen/caixa";
import { diaNoForo } from "@/lib/djen/coletar";
import { confereContagem } from "@/lib/djen/conferencia";
import { corteDoVencido, montaPauta } from "@/lib/djen/pauta";
import { createClient } from "@/lib/supabase/server";

import { ConferenciaDaContagem } from "./_components/ConferenciaDaContagem";
import { PautaDeHoje } from "./_components/PautaDeHoje";

import { PublicacoesClient, type NegocioParaLigar, type FunilParaCriar } from "./_components/PublicacoesClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Publicações" };

/** Teto da leitura: a caixa é de trabalho diário, não arquivo morto. */
const LIMITE = 300;

/**
 * PUBLICAÇÕES DO DJEN — spec 0009 (AdvTec): a caixa de não reconhecidas e as
 * três saídas dela (E2), a pauta de hoje (E3) e a confirmação de prazo (0006.E5).
 *
 * Lê com a sessão (RLS recorta a organização). `viewer` vê; agir é `agent`, e
 * quem cobra é cada rota — a tela esconder o botão é cortesia.
 */
export default async function PublicacoesPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const org = activeOrg.orgId;
  const podeAgir = (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent;

  const supabase = await createClient();
  const agora = new Date();
  const [pubs, confirmadas, conferidas, negocios, funis] = await Promise.all([
    supabase
      .from("djen_publicacoes")
      .select(COLUNAS_DA_PUBLICACAO)
      .eq("organization_id", org)
      .order("data_disponibilizacao", { ascending: false })
      .limit(LIMITE),
    // Prazo confirmado não cai fora pelo teto das recentes (spec 0006.E5).
    supabase
      .from("djen_publicacoes")
      .select(COLUNAS_DA_PUBLICACAO)
      .eq("organization_id", org)
      .gte("prazo_vence_em", corteDoVencido(agora))
      .order("prazo_vence_em")
      .limit(LIMITE),
    // Conferência da contagem (0006.E5): toda confirmação, inclusive de prazo já vencido.
    supabase
      .from("djen_publicacoes")
      .select(COLUNAS_DA_PUBLICACAO)
      .eq("organization_id", org)
      .not("prazo_confirmado_em", "is", null)
      .order("prazo_confirmado_em", { ascending: false })
      .limit(LIMITE),
    supabase
      .from("crm_leads")
      .select("id, organization_id, title, custom_fields")
      .eq("organization_id", org)
      .eq("status", "open")
      .order("updated_at", { ascending: false })
      .limit(LIMITE),
    supabase
      .from("crm_pipelines")
      .select("id, name, crm_stages!crm_stages_pipeline_id_fkey(id, name, position, is_won, is_lost, is_archived)")
      .eq("organization_id", org)
      .eq("is_archived", false)
      .order("position"),
  ]);

  const publicacoes: PublicacaoDaCaixa[] = semRepetir(
    (pubs.data ?? []) as LinhaDaPublicacao[],
    (confirmadas.data ?? []) as LinhaDaPublicacao[],
  ).map(daLinha);
  const caixa = montaCaixa(publicacoes, negocios.data ?? []);
  const pauta = montaPauta(publicacoes, negocios.data ?? [], agora);
  const conferencia = confereContagem(((conferidas.data ?? []) as LinhaDaPublicacao[]).map(daLinha), diaNoForo(agora));

  const paraLigar: NegocioParaLigar[] = (negocios.data ?? []).map((n) => ({
    id: n.id,
    titulo: n.title,
    numeroProcesso:
      typeof n.custom_fields?.[CAMPO_DO_PROCESSO] === "string" ? (n.custom_fields[CAMPO_DO_PROCESSO] as string) : null,
  }));
  const paraCriar: FunilParaCriar[] = (funis.data ?? []).map((f) => ({
    id: f.id,
    nome: f.name,
    etapas: (f.crm_stages ?? [])
      .filter((e) => !e.is_won && !e.is_lost && !e.is_archived)
      .sort((a, b) => a.position - b.position)
      .map((e) => ({ id: e.id, nome: e.name })),
  }));

  return (
    <PublicacoesClient
      podeAgir={podeAgir}
      naoReconhecidas={caixa.naoReconhecidas}
      totalReconhecidas={caixa.reconhecidas.length}
      descartadas={caixa.descartadas.length}
      erroDeLeitura={Boolean(pubs.error || confirmadas.error || conferidas.error || negocios.error || funis.error)}
      negocios={paraLigar}
      funis={paraCriar}
    >
      <PautaDeHoje
        hoje={pauta.hoje}
        venceHoje={pauta.venceHoje}
        venceNaSemana={pauta.venceNaSemana}
        venceDepois={pauta.venceDepois}
        venceu={pauta.venceu}
        podeAgir={podeAgir}
        chegouDesdeOntem={pauta.chegouDesdeOntem}
        pendentes={pauta.pendentes}
        cortada={(pubs.data?.length ?? 0) >= LIMITE}
      />
      <ConferenciaDaContagem conferencia={conferencia} />
    </PublicacoesClient>
  );
}
