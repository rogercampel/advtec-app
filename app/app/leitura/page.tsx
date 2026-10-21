import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

import { LeituraDeProcesso, type LeituraNaLista } from "./_components/LeituraDeProcesso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leitura de processo" };

/**
 * LEITURA DE PROCESSO — spec 0003.E6 (#41, AdvTec). O advogado envia o PDF, vê a
 * estimativa, confirma, e a leitura roda em `POST /api/v1/acervo/leituras`.
 * Lê a lista com a sessão (RLS recorta a organização). Ler um processo gasta
 * modelo: `agent` em diante, como a pesquisa no acervo — e a rota cobra de novo.
 */
export default async function LeituraPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const podeLer = (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent;

  const supabase = await createClient();
  const { data } = await supabase
    .from("acervo_leituras")
    .select("id, nome_do_arquivo, total_de_paginas, estado, motivo_da_falha, created_at")
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false })
    .limit(30);

  const leituras: LeituraNaLista[] = (data ?? []).map((l) => ({
    id: l.id,
    arquivo: l.nome_do_arquivo,
    paginas: l.total_de_paginas,
    estado: l.estado as LeituraNaLista["estado"],
    motivo: l.motivo_da_falha,
    criadaEm: l.created_at,
  }));
  return <LeituraDeProcesso podeLer={podeLer} leituras={leituras} />;
}
